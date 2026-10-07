// POST /api/admin/import-applications — impor lamaran massal (OWNER/HR).
// DUA mode (NR-19-b):
//   1. JSON body (mode lama, tidak berubah):
//      { rows: [{ name, email, phone, positionTitle, experience, motivation }] }
//      -> { ok, created, skipped: [{ row, reason }] }
//   2. multipart/form-data field "file" (.csv/.xlsx/.xls, maks 5MB):
//      diparse via SheetJS (xlsx), baris pertama dianggap header, kolom dipetakan
//      fleksibel (nama/nama lengkap, email, telepon/wa/whatsapp, posisi/lowongan,
//      pengalaman, motivasi/alasan). Baris tanpa name+email+positionTitle dilewati
//      dan dilaporkan.
//      -> { ok, created, skipped, parsedRows, skippedRows }
// - Posisi dicocokkan dari `positionTitle` (case-insensitive, di-trim).
// - Tiap baris valid dibuat sebagai Application baru: kode tracking unik,
//   status "NEW", experience/motivation default "-" bila kosong.
// - Tiap lamaran dicatat sebagai ActivityLog "IMPORT_BULK" + sinyal realtime.
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { generateUniqueTrackingCode } from "@/lib/tracking";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
// NR41-SEC-B (F7): verifikasi magic bytes berkas impor.
import { verifyMagicBytes } from "@/lib/verify-upload";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 1000;
const MAX_TEXT = 5000;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXT_RE = /\.(csv|xlsx|xls)$/i;

type ImportRow = {
  name: string;
  email: string;
  phone: string;
  positionTitle: string;
  experience: string;
  motivation: string;
};

type SkipEntry = { row: number; reason: string };

/** Ambil teks aman dari field body (string saja, di-trim, dibatasi panjang). */
function pickText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

/* ------------------------- Parsing file CSV/Excel ------------------------- */

type ImportField = keyof ImportRow;

/**
 * Petakan satu sel header ke field impor (pencocokan "mengandung", alias
 * spesifik dicek lebih dulu). Null bila kolom tidak dikenali (diabaikan).
 */
function mapHeaderField(rawHeader: string): ImportField | null {
  const h = rawHeader.toLowerCase().trim();
  if (!h) return null;
  if (h.includes("email")) return "email";
  if (h.includes("whatsapp") || /\bwa\b/.test(h)) return "phone";
  if (
    h.includes("telepon") ||
    h.includes("telp") ||
    h.includes("phone") ||
    /\bhp\b/.test(h)
  ) {
    return "phone";
  }
  if (
    h.includes("posisi") ||
    h.includes("lowongan") ||
    h.includes("jabatan") ||
    h.includes("position")
  ) {
    return "positionTitle";
  }
  if (h.includes("pengalaman") || h.includes("experience")) return "experience";
  if (h.includes("motivasi") || h.includes("alasan") || h.includes("motivation")) {
    return "motivation";
  }
  if (h.includes("nama") || h.includes("name")) return "name";
  return null;
}

/**
 * Parse buffer CSV/Excel menjadi daftar baris impor.
 * Baris pertama dianggap header (sheet_to_json header:1); kolom dipetakan
 * fleksibel via mapHeaderField. Baris yang seluruh selnya kosong dilewati senyap.
 * Melempar Error dengan pesan Indonesia bila file tidak bisa dibaca.
 */
function parseImportFile(buffer: Buffer): ImportRow[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new Error("File tidak dapat dibaca. Pastikan format .csv, .xlsx, atau .xls.");
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("File tidak memuat sheet data apa pun.");
  }
  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (records.length === 0) return [];

  // Baris pertama = header -> petakan indeks kolom ke field.
  const headerRow = records[0].map((cell) => (typeof cell === "string" ? cell : String(cell ?? "")));
  const columnFields = headerRow.map((cell) => mapHeaderField(cell));

  const rows: ImportRow[] = [];
  for (const record of records.slice(1)) {
    const item: ImportRow = {
      name: "",
      email: "",
      phone: "",
      positionTitle: "",
      experience: "",
      motivation: "",
    };
    let hasContent = false;
    record.forEach((cell, index) => {
      const value = typeof cell === "string" ? cell : String(cell ?? "");
      if (value.trim() !== "") hasContent = true;
      const field = columnFields[index] ?? null;
      if (field && !item[field]) item[field] = value.trim().slice(0, MAX_TEXT);
    });
    if (!hasContent) continue; // baris kosong — lewati senyap
    rows.push(item);
  }
  return rows;
}

/* ------------------------- Pipeline inti (2 mode) ------------------------- */

/**
 * Proses daftar baris impor: validasi, cocokkan posisi, buat Application.
 * Dipakai mode JSON & mode file agar perilaku validasi identik.
 */
async function processImportRows(
  rawRows: unknown[],
  actorName: string,
): Promise<{ created: number; skipped: SkipEntry[] }> {
  // Posisi dimuat sekali; dicocokkan by title (case-insensitive).
  const positions = await db.position.findMany({
    select: { id: true, title: true },
  });
  const byTitle = new Map<string, { id: string; title: string }>();
  for (const position of positions) {
    byTitle.set(position.title.trim().toLowerCase(), position);
  }

  const skipped: SkipEntry[] = [];
  let created = 0;

  for (let index = 0; index < rawRows.length; index++) {
    const raw = rawRows[index];
    const row = (raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw
      : {}) as Record<string, unknown>;

    const item: ImportRow = {
      name: pickText(row.name, 120),
      email: pickText(row.email, 200),
      phone: pickText(row.phone, 40),
      positionTitle: pickText(row.positionTitle, 120),
      experience: pickText(row.experience, MAX_TEXT),
      motivation: pickText(row.motivation, MAX_TEXT),
    };

    const fail = (reason: string) => skipped.push({ row: index, reason });

    if (!item.name) {
      fail("Nama kosong.");
      continue;
    }
    if (!item.email) {
      fail(`${item.name || "Baris " + (index + 1)}: email kosong.`);
      continue;
    }
    if (!EMAIL_RE.test(item.email)) {
      fail(`Email tidak valid: ${item.email}`);
      continue;
    }
    if (!item.phone) {
      fail(`${item.name}: nomor telepon kosong.`);
      continue;
    }
    if (!item.positionTitle) {
      fail(`${item.name}: posisi kosong.`);
      continue;
    }
    const position = byTitle.get(item.positionTitle.toLowerCase());
    if (!position) {
      fail(`Posisi tidak ditemukan: ${item.positionTitle}`);
      continue;
    }

    const trackingCode = await generateUniqueTrackingCode();
    const application = await db.application.create({
      data: {
        name: item.name,
        email: item.email,
        phone: item.phone,
        positionId: position.id,
        experience: item.experience || "-",
        motivation: item.motivation || "-",
        status: "NEW",
        trackingCode,
        source: "Import CSV",
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: actorName,
        action: "IMPORT_BULK",
        detail: `Impor massal baris ${index + 1} untuk posisi ${position.title} (kode ${trackingCode}).`,
      },
    });

    created += 1;
  }

  return { created, skipped };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const contentType = req.headers.get("content-type") ?? "";

    /* ----------------------- Mode 2: unggah file ----------------------- */
    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return NextResponse.json(
          { error: "Body harus multipart/form-data dengan field 'file'." },
          { status: 400 },
        );
      }
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "File wajib diunggah pada field 'file' (.csv/.xlsx/.xls)." },
          { status: 400 },
        );
      }
      if (file.size <= 0) {
        return NextResponse.json({ error: "File kosong." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "Ukuran file melebihi batas 5 MB." },
          { status: 400 },
        );
      }
      if (!ALLOWED_EXT_RE.test(file.name)) {
        return NextResponse.json(
          { error: "Format file tidak didukung. Gunakan .csv, .xlsx, atau .xls." },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      // NR41-SEC-B (F7): verifikasi magic bytes (XLSX=PK\x03\x04, XLS=OLE2, CSV=teks bersih).
      const importMime =
        file.type ||
        (file.name.toLowerCase().endsWith(".xlsx")
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : file.name.toLowerCase().endsWith(".xls")
            ? "application/vnd.ms-excel"
            : "text/csv");
      const importVerdict = verifyMagicBytes(buffer, importMime);
      if (!importVerdict.ok) {
        return NextResponse.json(
          { error: "Tipe file tidak valid (berkas rusak atau palsu)" },
          { status: 400 },
        );
      }

      const parsedRows = parseImportFile(buffer);
      if (parsedRows.length === 0) {
        return NextResponse.json(
          { error: "Tidak ada baris data yang bisa dibaca dari file (pastikan baris pertama berisi header)." },
          { status: 400 },
        );
      }
      if (parsedRows.length > MAX_ROWS) {
        return NextResponse.json({ error: `Maksimal ${MAX_ROWS} baris per impor.` }, { status: 400 });
      }

      const { created, skipped } = await processImportRows(parsedRows, session.name);
      void emitRealtime(REALTIME_EVENTS.applications);
      return NextResponse.json({
        ok: true,
        created,
        skipped,
        parsedRows: parsedRows.length,
        skippedRows: skipped.length,
      });
    }

    /* ----------------------- Mode 1: JSON (lama) ----------------------- */
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const rawRows = (body as Record<string, unknown>).rows;
    if (!Array.isArray(rawRows) || rawRows.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada baris lamaran yang dikirim (field 'rows' wajib berupa array)." },
        { status: 400 },
      );
    }
    if (rawRows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Maksimal ${MAX_ROWS} baris per impor.` }, { status: 400 });
    }

    const { created, skipped } = await processImportRows(rawRows, session.name);

    // Realtime: daftar lamaran & dashboard admin berubah.
    void emitRealtime(REALTIME_EVENTS.applications);

    return NextResponse.json({ ok: true, created, skipped });
  } catch (error) {
    console.error("[POST /api/admin/import-applications]", error);
    return NextResponse.json(
      { error: "Gagal mengimpor lamaran. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
