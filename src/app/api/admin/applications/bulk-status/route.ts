// POST /api/admin/applications/bulk-status — update tahap pipeline massal via
// Excel (XL-BE, OWNER/HR). File dibuat dari template "Update Status" (menu
// Data > Excel & Pendataan > Unduh Template Update Status):
//   kolom "Kode Tracking", "Tahap Baru", "Catatan (opsional)".
// DUA mode via field multipart `mode`:
//   preview -> validasi semua baris TANPA mengubah data:
//       { ok, preview:true, totalRows, validCount, issueCount,
//         rows: [{ row, trackingCode, newStageLabel, note, found,
//                  currentStage, valid, error }] }
//   commit  -> terapkan baris valid:
//       { ok, updated, skipped: [{ row, reason }] }
// Aturan:
// - Hanya lamaran aktif (deletedAt null) yang boleh diperbarui.
// - "Tahap Baru" harus salah satu tahap posisi terkait (bawaan ATAU kustom,
//   pencocokan label tidak peka huruf besar/kecil).
// - Kode ganda dalam satu file: baris kedua dst. ditandai error.
// - Commit HANYA memindahkan tahap: status + stageHistory + stageUpdatedAt;
//   tidak menyentuh offer/penolakan/data lain. Tiap perubahan dicatat
//   ActivityLog STATUS_CHANGE (aktor = admin yang login) + sinyal realtime.
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { can } from "@/lib/permissions";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { stageLabel, stagesForPosition } from "@/lib/stages";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const MAX_ROWS = 500;
const MAX_NOTE = 300;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EXT_RE = /\.(csv|xlsx|xls)$/i;

type BulkRow = {
  row: number;
  trackingCode: string;
  newStageLabel: string;
  note: string;
  found: boolean;
  currentStage: string;
  valid: boolean;
  error: string;
};

/** Ambil teks aman dari sel (string, trim, batas panjang). */
function cellText(value: unknown, maxLen: number): string {
  if (value === null || value === undefined) return "";
  return String(value).trim().slice(0, maxLen);
}

/**
 * Parse buffer CSV/Excel menjadi baris mentah {trackingCode, stage, note}.
 * Baris pertama = header; kolom dikenali dari kata kunci (kode/tahap/catatan).
 * Baris yang seluruhnya kosong dilewati senyap.
 */
function parseBulkFile(buffer: Buffer): { trackingCode: string; stage: string; note: string }[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch {
    throw new Error("File tidak dapat dibaca. Pastikan format .xlsx atau .csv.");
  }
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("File tidak memuat sheet data apa pun.");
  const records = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (records.length === 0) return [];

  const headerRow = records[0].map((cell) => (typeof cell === "string" ? cell : String(cell ?? "")));
  const colCode = headerRow.findIndex((h) => h.toLowerCase().includes("kode"));
  const colStage = headerRow.findIndex((h) => h.toLowerCase().includes("tahap"));
  const colNote = headerRow.findIndex((h) => h.toLowerCase().includes("catatan"));

  const rows: { trackingCode: string; stage: string; note: string }[] = [];
  for (const record of records.slice(1)) {
    const trackingCode = cellText(colCode >= 0 ? record[colCode] : "", 30);
    const stage = cellText(colStage >= 0 ? record[colStage] : "", 40);
    const note = cellText(colNote >= 0 ? record[colNote] : "", MAX_NOTE);
    if (!trackingCode && !stage && !note) continue; // baris kosong
    rows.push({ trackingCode, stage, note });
  }
  return rows;
}

/** Selesaikan label tahap menjadi nilai status yang disimpan (StageKey/label kustom). */
function resolveStage(stages: string[], label: string): string | null {
  const wanted = label.trim().toLowerCase();
  const match = stages.find((stage) => stageLabel(stage).toLowerCase() === wanted);
  return match ?? null;
}

/** Validasi seluruh baris (dipakai preview & commit agar hasil identik). */
async function validateRows(
  rawRows: { trackingCode: string; stage: string; note: string }[]
): Promise<{ rows: BulkRow[]; validRows: { row: BulkRow; applicationId: string; targetStage: string }[] }> {
  const seen = new Map<string, number>();
  const rows: BulkRow[] = [];
  const validRows: { row: BulkRow; applicationId: string; targetStage: string }[] = [];

  for (let index = 0; index < rawRows.length; index++) {
    const raw = rawRows[index];
    const rowNumber = index + 1;
    let error = "";
    let found = false;
    let currentStage = "";
    let targetStage: string | null = null;
    let applicationId = "";

    if (!raw.trackingCode) {
      error = "Kode Tracking kosong.";
    } else if (!raw.stage) {
      error = "Tahap Baru kosong.";
    } else {
      const firstSeen = seen.get(raw.trackingCode.toLowerCase());
      if (firstSeen !== undefined) {
        error = `Kode duplikat dalam file (baris ${firstSeen}).`;
      } else {
        seen.set(raw.trackingCode.toLowerCase(), rowNumber);
        const application = await db.application.findFirst({
          where: { trackingCode: raw.trackingCode, deletedAt: null },
          include: { position: { select: { title: true, stages: true } } },
        });
        if (!application) {
          error = `Kode tidak ditemukan (atau lamaran sudah dihapus): ${raw.trackingCode}`;
        } else {
          found = true;
          applicationId = application.id;
          currentStage = stageLabel(application.status.trim() || "NEW");
          let rawStages: string[] | null = null;
          try {
            const parsedStages: unknown = JSON.parse(application.position?.stages || "[]");
            if (Array.isArray(parsedStages)) {
              rawStages = parsedStages.filter((s): s is string => typeof s === "string");
            }
          } catch {
            rawStages = null;
          }
          const stages = stagesForPosition(rawStages);
          targetStage = resolveStage(stages, raw.stage);
          if (!targetStage) {
            error = `Tahap "${raw.stage}" tidak ada pada posisi ${application.position?.title ?? "(tanpa posisi)"} (pilihan: ${stages.map((s) => stageLabel(s)).join(", ")})`;
          } else if (application.status.trim() === targetStage) {
            error = `Lamaran sudah berada di tahap "${currentStage}" — tidak ada perubahan.`;
          }
        }
      }
    }

    const bulkRow: BulkRow = {
      row: rowNumber,
      trackingCode: raw.trackingCode,
      newStageLabel: raw.stage,
      note: raw.note,
      found,
      currentStage,
      valid: error === "",
      error,
    };
    rows.push(bulkRow);
    if (error === "" && targetStage && applicationId) {
      validRows.push({ row: bulkRow, applicationId, targetStage });
    }
  }

  return { rows, validRows };
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
    // NR46 — matriks izin: kelola lamaran (ubah status massal).
    if (!(await can(session.role, "kelola_lamaran"))) {
      return NextResponse.json(
        { error: "Aksi ini tidak diizinkan untuk role Anda — lihat Matriks Izin di Pengaturan." },
        { status: 403 },
      );
    }

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Body harus multipart/form-data dengan field 'file'." },
        { status: 400 },
      );
    }
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
        { error: "File wajib diunggah pada field 'file' (.xlsx/.csv)." },
        { status: 400 },
      );
    }
    if (file.size <= 0) {
      return NextResponse.json({ error: "File kosong." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Ukuran file melebihi batas 5 MB." }, { status: 400 });
    }
    if (!ALLOWED_EXT_RE.test(file.name)) {
      return NextResponse.json(
        { error: "Format file tidak didukung. Gunakan .xlsx atau .csv." },
        { status: 400 },
      );
    }

    const mode = String(form.get("mode") ?? "").trim().toLowerCase();
    const buffer = Buffer.from(await file.arrayBuffer());

    let rawRows: { trackingCode: string; stage: string; note: string }[];
    try {
      rawRows = parseBulkFile(buffer);
    } catch (error) {
      const message = error instanceof Error ? error.message : "File tidak dapat dibaca.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (rawRows.length === 0) {
      return NextResponse.json(
        { error: "Tidak ada baris data yang bisa dibaca (pastikan memakai kolom template: Kode Tracking, Tahap Baru)." },
        { status: 400 },
      );
    }
    if (rawRows.length > MAX_ROWS) {
      return NextResponse.json({ error: `Maksimal ${MAX_ROWS} baris per file.` }, { status: 400 });
    }

    const { rows, validRows } = await validateRows(rawRows);
    const validCount = rows.filter((r) => r.valid).length;

    // Mode pratinjau — tidak mengubah data.
    if (mode === "preview") {
      return NextResponse.json({
        ok: true,
        preview: true,
        totalRows: rows.length,
        validCount,
        issueCount: rows.length - validCount,
        rows,
      });
    }

    // Mode commit — terapkan baris valid.
    const skipped: { row: number; reason: string }[] = [];
    let updated = 0;
    const now = new Date();
    for (const { row, applicationId, targetStage } of validRows) {
      const application = await db.application.findUnique({
        where: { id: applicationId },
        select: { status: true, stageHistory: true },
      });
      if (!application) {
        skipped.push({ row: row.row, reason: "Lamaran tidak ditemukan saat penyimpanan." });
        continue;
      }
      let history: { status: string; at: string }[] = [];
      try {
        const parsed: unknown = JSON.parse(application.stageHistory || "[]");
        if (Array.isArray(parsed)) {
          history = parsed.filter(
            (item): item is { status: string; at: string } =>
              !!item && typeof item === "object" && typeof (item as { status?: unknown }).status === "string",
          );
        }
      } catch {
        history = [];
      }
      history.push({ status: targetStage, at: now.toISOString() });

      await db.application.update({
        where: { id: applicationId },
        data: {
          status: targetStage,
          stageUpdatedAt: now,
          stageHistory: JSON.stringify(history),
        },
      });
      await db.activityLog.create({
        data: {
          applicationId,
          actor: session.name,
          action: "STATUS_CHANGE",
          detail: `Update massal via Excel: ${stageLabel(application.status.trim() || "NEW")} -> ${stageLabel(targetStage)}${row.note ? ` (${row.note})` : ""}`,
        },
      });
      updated += 1;
    }
    // Baris tidak valid dilaporkan sebagai skipped agar admin tahu apa yang tidak jadi.
    for (const row of rows) {
      if (!row.valid) skipped.push({ row: row.row, reason: row.error });
    }

    if (updated > 0) {
      void emitRealtime(REALTIME_EVENTS.applications);
    }
    return NextResponse.json({ ok: true, updated, skipped });
  } catch (error) {
    console.error("[POST /api/admin/applications/bulk-status]", error);
    return NextResponse.json(
      { error: "Gagal memperbarui status massal. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
