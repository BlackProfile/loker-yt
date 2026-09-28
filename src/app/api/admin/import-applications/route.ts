// POST /api/admin/import-applications — impor lamaran massal (OWNER/HR).
// Body: { rows: [{ name, email, phone, positionTitle, experience, motivation }] }
// - Posisi dicocokkan dari `positionTitle` (case-insensitive, di-trim).
// - Tiap baris valid dibuat sebagai Application baru: kode tracking unik,
//   status "NEW", experience/motivation default "-" bila kosong.
// - Tiap lamaran dicatat sebagai ActivityLog "IMPORT_BULK" + sinyal realtime.
// Return: { created, skipped: [{ row, reason }] } — `row` indeks baris (0-based
// mengikuti array `rows` yang dikirim klien).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { generateUniqueTrackingCode } from "@/lib/tracking";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 1000;
const MAX_TEXT = 5000;

type ImportRow = {
  name: string;
  email: string;
  phone: string;
  positionTitle: string;
  experience: string;
  motivation: string;
};

/** Ambil teks aman dari field body (string saja, di-trim, dibatasi panjang). */
function pickText(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
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
      return NextResponse.json(
        { error: `Maksimal ${MAX_ROWS} baris per impor.` },
        { status: 400 },
      );
    }

    // Posisi dimuat sekali; dicocokkan by title (case-insensitive).
    const positions = await db.position.findMany({
      select: { id: true, title: true },
    });
    const byTitle = new Map<string, { id: string; title: string }>();
    for (const position of positions) {
      byTitle.set(position.title.trim().toLowerCase(), position);
    }

    const skipped: { row: number; reason: string }[] = [];
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
          actor: session.name,
          action: "IMPORT_BULK",
          detail: `Impor massal baris ${index + 1} untuk posisi ${position.title} (kode ${trackingCode}).`,
        },
      });

      created += 1;
    }

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
