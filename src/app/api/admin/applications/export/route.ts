// GET /api/admin/applications/export — unduh data lamaran (OWNER/HR).
// XL-BE — param `entity` memilih jenis ekspor (default "applications", perilaku
// lama CSV/xlsx TIDAK berubah kecuali sheet Interview & autofilter yang ditambah):
//   applications    -> CSV (lama) ATAU ?format=xlsx workbook 3 sheet:
//        "Lamaran"   : kolom CSV + "Status Offer" + autofilter
//        "Interview" : semua sesi wawancara multi-ronde (XL-BE baru)
//        "Ringkasan" : rekap per status & per posisi
//   form-answers    -> ?positionId=<id> XLSX jawaban Form Builder posisi:
//                      satu kolom per pertanyaan (field aktif + field pensiun)
//   analytics       -> XLSX rekap analitik: funnel per posisi + metrik
//                      (skor AI, offer, wawancara, time-to-hire)
//   template-import -> XLSX template impor lamaran resmi (3 sheet)
//   template-status -> XLSX template update tahap massal (3 sheet)
// Filter untuk entity applications/form-answers/analytics sama dengan
// GET /api/admin/applications (parseApplicationFilters) + from/to (XL-BE).
// Setiap ekspor tercatat sebagai ActivityLog "EXPORT_EXCEL"/"EXPORT_CSV" (audit).
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, parseApplicationFilters } from "@/lib/seed";
import { DEFAULT_STAGES, stageLabel, stagesForPosition } from "@/lib/stages";
import { formatAnswerValue, type FormSchema } from "@/lib/form-schema";
import {
  AI_RECOMMENDATION_LABELS,
  OFFER_STATUS_LABELS,
  type AiRecommendation,
  type OfferStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ExportApplication = Prisma.ApplicationGetPayload<{
  include: typeof APPLICATION_INCLUDE;
}>;

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDateId(value: Date | null): string {
  if (!value) return "";
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/** Tanggal lokal hari ini YYYY-MM-DD (untuk nama file unduhan). */
function todayFileStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Label status offer atau kosong bila belum ada offer. */
function offerStatusLabel(status: string | null): string {
  if (!status) return "";
  return (OFFER_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/** Header kolom dasar — identik dengan CSV lama. */
function buildHeader(): string[] {
  return [
    "Kode",
    "Nama",
    "Email",
    "WhatsApp",
    "Posisi",
    "Status",
    "Skor AI",
    "Rekomendasi AI",
    "Rating",
    "Tags",
    "Talent Pool",
    "Jadwal Wawancara",
    "Link Portofolio",
    "Tanggal Daftar",
  ];
}

/** Sel satu baris lamaran — perlakuan PII identik dengan CSV lama (reuse logika). */
function buildCells(row: ExportApplication): string[] {
  const recommendation =
    row.aiRecommendation && row.aiRecommendation in AI_RECOMMENDATION_LABELS
      ? AI_RECOMMENDATION_LABELS[row.aiRecommendation as AiRecommendation]
      : "";
  const tags = (() => {
    try {
      const parsed: unknown = JSON.parse(row.tags);
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string").join("; ") : "";
    } catch {
      return "";
    }
  })();
  return [
    row.trackingCode ?? "",
    row.name,
    row.email,
    row.phone,
    row.position?.title ?? "",
    stageLabel(row.status.trim() || "NEW"),
    row.aiScore === null ? "" : String(row.aiScore),
    recommendation,
    String(row.rating),
    tags,
    row.talentPool ? "Ya" : "Tidak",
    formatDateId(row.interviewAt),
    row.portfolioUrl ?? "",
    formatDateId(row.createdAt),
  ];
}

/* ----------------------- XL-BE — label wawancara ----------------------- */

const INTERVIEW_MODE_LABELS: Record<string, string> = {
  ONLINE: "Daring",
  ONSITE: "On-site",
};

const INTERVIEW_PLATFORM_LABELS: Record<string, string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  WHATSAPP: "WhatsApp",
  TELEPON: "Telepon",
  LAINNYA: "Lainnya",
};

const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Terjadwal",
  CONFIRMED: "Dikonfirmasi",
  RESCHEDULE_REQUESTED: "Minta Ubah Jadwal",
  COMPLETED: "Selesai",
  NO_SHOW: "Tidak Hadir",
  CANCELLED: "Dibatalkan",
};

const INTERVIEW_RECO_LABELS: Record<string, string> = {
  LANJUT: "Lanjut",
  CADANGAN: "Cadangan",
  TOLAK: "Tolak",
};

function labelOf(map: Record<string, string>, raw: string): string {
  return map[raw] ?? raw;
}

/** Rentang autofilter "A1:<kolom><baris>" untuk sheet ber-header di baris 1. */
function autofilterRef(columnCount: number, rowCount: number): string {
  const lastCol = XLSX.utils.encode_col(Math.max(0, columnCount - 1));
  return `A1:${lastCol}${Math.max(1, rowCount)}`;
}

/* ------------------- XL-BE — sheet Interview (multi-ronde) ------------------- */

type InterviewWithApplication = Prisma.InterviewGetPayload<{
  include: { application: { include: { position: true } } };
}>;

const INTERVIEW_HEADER = [
  "Kandidat",
  "Posisi",
  "Ronde",
  "Mode",
  "Platform",
  "Link / Lokasi",
  "Jadwal",
  "Durasi (menit)",
  "Pewawancara",
  "Status",
  "Rekomendasi",
  "Catatan",
];

function interviewCells(iv: InterviewWithApplication): (string | number)[] {
  const link = iv.mode === "ONSITE" ? (iv.address ?? "") : (iv.meetingLink ?? "");
  let interviewers = "";
  try {
    const parsed: unknown = JSON.parse(iv.interviewers);
    interviewers = Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === "string").join("; ")
      : "";
  } catch {
    interviewers = "";
  }
  return [
    iv.application?.name ?? "",
    iv.application?.position?.title ?? "(tanpa posisi)",
    iv.round,
    labelOf(INTERVIEW_MODE_LABELS, iv.mode),
    labelOf(INTERVIEW_PLATFORM_LABELS, iv.platform),
    link,
    formatDateId(iv.scheduledAt),
    iv.durationMin,
    interviewers,
    labelOf(INTERVIEW_STATUS_LABELS, iv.status),
    iv.recommendation ? labelOf(INTERVIEW_RECO_LABELS, iv.recommendation) : "",
    iv.notes ?? "",
  ];
}

/* ------------------- XL-BE — util Form Builder ------------------- */

/** Parse JSON string Position.formSchema menjadi FormSchema (null bila tidak valid/klasik). */
function parseFormSchema(raw: string | null): FormSchema | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const schema = parsed as FormSchema;
    if (!Array.isArray(schema.sections) || !Array.isArray(schema.fields)) return null;
    return {
      version: typeof schema.version === "number" ? schema.version : 2,
      sections: schema.sections,
      fields: schema.fields,
      retiredFields: Array.isArray(schema.retiredFields) ? schema.retiredFields : [],
    };
  } catch {
    return null;
  }
}

/** Sheet ringkas "Petunjuk" untuk kedua template. */
function buildPetunjukSheet(lines: string[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [["Petunjuk Pengisian"]];
  for (const line of lines) aoa.push([line]);
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = [{ wch: 110 }];
  return sheet;
}

/* --------------------------------- Handler --------------------------------- */

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") ?? "csv").toLowerCase();
    const entity = (searchParams.get("entity") ?? "applications").toLowerCase();

    // userId diteruskan agar filter starred (bintang personal) tahu admin yang login.
    const { where, orderBy, valid } = parseApplicationFilters(searchParams, session.id);
    if (!valid) {
      return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
    }
    // Lamaran di tong sampah tidak pernah diekspor.
    const baseWhere: Prisma.ApplicationWhereInput = { ...where, deletedAt: null };

    /* ===================== entity=form-answers ===================== */
    if (entity === "form-answers") {
      const positionId = searchParams.get("positionId")?.trim();
      if (!positionId) {
        return NextResponse.json({ error: "Pilih posisi terlebih dahulu." }, { status: 400 });
      }
      const position = await db.position.findUnique({ where: { id: positionId } });
      if (!position) {
        return NextResponse.json({ error: "Posisi tidak ditemukan." }, { status: 404 });
      }
      const schema = parseFormSchema(position.formSchema);
      if (!schema) {
        return NextResponse.json(
          { error: "Posisi ini memakai formulir klasik (tanpa Form Builder) sehingga tidak punya jawaban form." },
          { status: 400 },
        );
      }

      // Kolom = field aktif (urut skema) + field pensiun (jawaban lama tetap tampil).
      const columns: { id: string; label: string }[] = [];
      const seen = new Set<string>();
      for (const field of [...schema.fields, ...schema.retiredFields]) {
        if (seen.has(field.id)) continue;
        seen.add(field.id);
        columns.push({ id: field.id, label: field.label });
      }

      const rows = await db.application.findMany({
        where: { ...baseWhere, positionId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: APPLICATION_INCLUDE,
      });

      const header = ["Kode", "Nama", "Email", "WhatsApp", "Status", "Tanggal Daftar", ...columns.map((c) => c.label)];
      const aoa: (string | number)[][] = [header];
      for (const row of rows) {
        let answers: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(row.formAnswers ?? "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            answers = parsed as Record<string, unknown>;
          }
        } catch {
          answers = {};
        }
        aoa.push([
          row.trackingCode ?? "",
          row.name,
          row.email,
          row.phone,
          stageLabel(row.status.trim() || "NEW"),
          formatDateId(row.createdAt),
          ...columns.map((c) => formatAnswerValue(answers[c.id] as never)),
        ]);
      }

      const sheet = XLSX.utils.aoa_to_sheet(aoa);
      sheet["!cols"] = header.map((title) => ({ wch: Math.max(12, Math.min(42, title.length + 6)) }));
      sheet["!autofilter"] = { ref: autofilterRef(header.length, aoa.length) };
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "Jawaban Form");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const stamp = todayFileStamp(new Date());
      const slugPart = (position.slug ?? position.id).slice(0, 40);
      await db.activityLog.create({
        data: {
          actor: session.name,
          action: "EXPORT_EXCEL",
          detail: `Ekspor jawaban form posisi "${position.title}" (${rows.length} lamaran, ${columns.length} kolom).`,
        },
      });
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": XLSX_MIME,
          "Content-Disposition": `attachment; filename="jawaban-form-${encodeURIComponent(slugPart)}-${stamp}.xlsx"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    /* ===================== entity=analytics ===================== */
    if (entity === "analytics") {
      const positions = await db.position.findMany({
        where: { deletedAt: null },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { id: true, title: true, stages: true },
      });
      const rows = await db.application.findMany({
        where: baseWhere,
        select: {
          positionId: true,
          status: true,
          aiScore: true,
          hiredAt: true,
          createdAt: true,
          offerStatus: true,
        },
      });
      // Wawancara selesai per posisi — ambil ringan dengan relasi minimal.
      const interviewsForCount = await db.interview.findMany({
        where: { status: "COMPLETED", application: baseWhere },
        select: { applicationId: true, application: { select: { positionId: true } } },
      });
      const interviewDoneByPosition = new Map<string, number>();
      for (const iv of interviewsForCount) {
        const pid = iv.application?.positionId ?? "(tanpa)";
        interviewDoneByPosition.set(pid, (interviewDoneByPosition.get(pid) ?? 0) + 1);
      }

      type PosStat = {
        total: number;
        accepted: number;
        rejected: number;
        offerSent: number;
        offerAccepted: number;
        offerDeclined: number;
        offerExpired: number;
        interviewDone: number;
        aiSum: number;
        aiCount: number;
        hireDaysSum: number;
        hireCount: number;
        funnel: Map<string, number>;
      };
      const stats = new Map<string, PosStat>();
      const ensure = (pid: string): PosStat => {
        let s = stats.get(pid);
        if (!s) {
          s = {
            total: 0,
            accepted: 0,
            rejected: 0,
            offerSent: 0,
            offerAccepted: 0,
            offerDeclined: 0,
            offerExpired: 0,
            interviewDone: interviewDoneByPosition.get(pid) ?? 0,
            aiSum: 0,
            aiCount: 0,
            hireDaysSum: 0,
            hireCount: 0,
            funnel: new Map<string, number>(),
          };
          stats.set(pid, s);
        }
        return s;
      };

      const positionById = new Map(positions.map((p) => [p.id, p]));
      const stageListByPosition = new Map<string, string[]>();
      for (const p of positions) {
        stageListByPosition.set(p.id, stagesForPosition(p.stages).map((s) => stageLabel(s)));
      }

      for (const row of rows) {
        const pid = row.positionId ?? "(tanpa)";
        const s = ensure(pid);
        s.total += 1;
        if (row.status === "ACCEPTED") s.accepted += 1;
        if (row.status === "REJECTED") s.rejected += 1;
        if (row.offerStatus) {
          s.offerSent += 1;
          if (row.offerStatus === "ACCEPTED") s.offerAccepted += 1;
          if (row.offerStatus === "DECLINED") s.offerDeclined += 1;
          if (row.offerStatus === "EXPIRED") s.offerExpired += 1;
        }
        if (row.aiScore !== null) {
          s.aiSum += row.aiScore;
          s.aiCount += 1;
        }
        if (row.hiredAt) {
          s.hireDaysSum += Math.max(0, Math.round((row.hiredAt.getTime() - row.createdAt.getTime()) / 86_400_000));
          s.hireCount += 1;
        }
        const stages = row.positionId ? (stageListByPosition.get(row.positionId) ?? []) : [];
        const label = stages.includes(row.status.trim()) ? row.status.trim() : stageLabel(row.status.trim() || "NEW");
        s.funnel.set(label, (s.funnel.get(label) ?? 0) + 1);
      }

      // Sheet "Metrik" — satu baris per posisi + baris TOTAL.
      const metricHeader = [
        "Posisi",
        "Total Lamaran",
        "Diterima",
        "Ditolak",
        "Offer Terkirim",
        "Offer Diterima",
        "Offer Ditolak",
        "Offer Kedaluwarsa",
        "Wawancara Selesai",
        "Rata-rata Skor AI",
        "Rata-rata Hari sampai Diterima",
      ];
      const metricAoa: (string | number)[][] = [metricHeader];
      const aggregate = (): PosStat => {
        const acc: PosStat = {
          total: 0, accepted: 0, rejected: 0, offerSent: 0, offerAccepted: 0,
          offerDeclined: 0, offerExpired: 0, interviewDone: 0, aiSum: 0, aiCount: 0,
          hireDaysSum: 0, hireCount: 0, funnel: new Map<string, number>(),
        };
        for (const s of stats.values()) {
          acc.total += s.total; acc.accepted += s.accepted; acc.rejected += s.rejected;
          acc.offerSent += s.offerSent; acc.offerAccepted += s.offerAccepted;
          acc.offerDeclined += s.offerDeclined; acc.offerExpired += s.offerExpired;
          acc.interviewDone += s.interviewDone; acc.aiSum += s.aiSum; acc.aiCount += s.aiCount;
          acc.hireDaysSum += s.hireDaysSum; acc.hireCount += s.hireCount;
        }
        return acc;
      };
      const metricRow = (title: string, s: PosStat): (string | number)[] => [
        title,
        s.total,
        s.accepted,
        s.rejected,
        s.offerSent,
        s.offerAccepted,
        s.offerDeclined,
        s.offerExpired,
        s.interviewDone,
        s.aiCount > 0 ? Math.round(s.aiSum / s.aiCount) : "",
        s.hireCount > 0 ? Math.round((s.hireDaysSum / s.hireCount) * 10) / 10 : "",
      ];
      const ordered = [...positionById.keys()]
        .filter((pid) => stats.has(pid))
        .map((pid) => metricRow(positionById.get(pid)?.title ?? "(posisi terhapus)", stats.get(pid)!));
      const noPosition = stats.get("(tanpa)");
      if (noPosition) ordered.push(metricRow("(tanpa posisi)", noPosition));
      for (const r of ordered) metricAoa.push(r);
      metricAoa.push(metricRow("TOTAL", aggregate()));

      const sheetMetrik = XLSX.utils.aoa_to_sheet(metricAoa);
      sheetMetrik["!cols"] = metricHeader.map((title) => ({ wch: Math.max(14, Math.min(34, title.length + 4)) }));
      sheetMetrik["!autofilter"] = { ref: autofilterRef(metricHeader.length, metricAoa.length) };

      // Sheet "Funnel" — format panjang: Posisi | Tahap | Jumlah.
      const funnelAoa: (string | number)[][] = [["Posisi", "Tahap", "Jumlah"]];
      for (const [pid, s] of stats) {
        const title = pid === "(tanpa)" ? "(tanpa posisi)" : (positionById.get(pid)?.title ?? "(posisi terhapus)");
        const stages = stageListByPosition.get(pid) ?? [];
        const orderedFunnel = [
          ...stages.filter((label) => s.funnel.has(label)),
          ...[...s.funnel.keys()].filter((label) => !stages.includes(label)),
        ];
        for (const label of orderedFunnel) {
          funnelAoa.push([title, label, s.funnel.get(label) ?? 0]);
        }
      }
      const sheetFunnel = XLSX.utils.aoa_to_sheet(funnelAoa);
      sheetFunnel["!cols"] = [{ wch: 32 }, { wch: 24 }, { wch: 10 }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheetMetrik, "Metrik");
      XLSX.utils.book_append_sheet(workbook, sheetFunnel, "Funnel");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const stamp = todayFileStamp(new Date());
      await db.activityLog.create({
        data: {
          actor: session.name,
          action: "EXPORT_EXCEL",
          detail: `Ekspor rekap analitik (${rows.length} lamaran, ${positions.length} posisi).`,
        },
      });
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": XLSX_MIME,
          "Content-Disposition": `attachment; filename="rekap-analitik-lumina-${stamp}.xlsx"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    /* ===================== entity=template-import ===================== */
    if (entity === "template-import") {
      const positions = await db.position.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { title: true, type: true },
      });

      const dataHeader = ["Nama", "Email", "WhatsApp", "Posisi", "Pengalaman", "Motivasi"];
      const dataAoa: (string | number)[][] = [
        dataHeader,
        ["Budi Santoso", "budi@mail.com", "6281234567890", positions[0]?.title ?? "Video Editor", "3 tahun editing YouTube", "Mau bergabung dengan tim kreatif"],
        ["Sari Dewi", "sari@mail.com", "6289876543210", positions[1]?.title ?? "Desainer Grafis", "2 tahun desain sosial media", "Ingin berkembang di studio kreatif"],
      ];
      const sheetData = XLSX.utils.aoa_to_sheet(dataAoa);
      sheetData["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 16 }, { wch: 28 }, { wch: 30 }, { wch: 40 }];

      const posHeader = ["Posisi (salin persis ke kolom Posisi)", "Jenis"];
      const posAoa: (string | number)[][] = [posHeader];
      for (const p of positions) posAoa.push([p.title, p.type]);
      if (positions.length === 0) posAoa.push(["(belum ada posisi aktif)", ""]);
      const sheetPosisi = XLSX.utils.aoa_to_sheet(posAoa);
      sheetPosisi["!cols"] = [{ wch: 42 }, { wch: 16 }];

      const sheetPetunjuk = buildPetunjukSheet([
        "1. Isi data lamaran pada sheet 'Lamaran Baru' mulai baris kedua (baris pertama adalah header — jangan diubah).",
        "2. Kolom Nama, Email, WhatsApp, dan Posisi WAJIB diisi; Posisi harus sama persis dengan daftar di sheet 'Daftar Posisi'.",
        "3. Kolom Pengalaman dan Motivasi boleh dikosongkan (otomatis '-' di sistem).",
        "4. Simpan file sebagai .xlsx lalu unggah di menu Data > Impor Lamaran Massal (CSV / Excel).",
        "5. Sistem akan menampilkan pratinjau validasi sebelum data benar-benar disimpan; email yang sudah melamar posisi yang sama akan ditandai duplikat.",
      ]);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheetData, "Lamaran Baru");
      XLSX.utils.book_append_sheet(workbook, sheetPosisi, "Daftar Posisi");
      XLSX.utils.book_append_sheet(workbook, sheetPetunjuk, "Petunjuk");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": XLSX_MIME,
          "Content-Disposition": `attachment; filename="template-impor-lamaran.xlsx"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    /* ===================== entity=template-status ===================== */
    if (entity === "template-status") {
      const positions = await db.position.findMany({
        where: { deletedAt: null },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: { title: true, stages: true },
      });

      const dataHeader = ["Kode Tracking", "Tahap Baru", "Catatan (opsional)"];
      const dataAoa: (string | number)[][] = [
        dataHeader,
        ["LM-XXXXXX", stageLabel(DEFAULT_STAGES[1] ?? "REVIEWED"), "Contoh: lolos seleksi CV"],
      ];
      const sheetData = XLSX.utils.aoa_to_sheet(dataAoa);
      sheetData["!cols"] = [{ wch: 18 }, { wch: 24 }, { wch: 40 }];

      const stageHeader = ["Tahap Bawaan (posisi tanpa tahap kustom)"];
      const stageAoa: (string | number)[][] = [stageHeader];
      for (const stage of DEFAULT_STAGES) stageAoa.push([stageLabel(stage)]);
      stageAoa.push([]);
      stageAoa.push(["Posisi dengan tahap kustom", "Daftar tahap (salin persis satu nilai ke kolom 'Tahap Baru')"]);
      let customCount = 0;
      for (const p of positions) {
        let raw: unknown = [];
        try {
          raw = JSON.parse(p.stages || "[]");
        } catch {
          raw = [];
        }
        if (!Array.isArray(raw) || raw.length === 0) continue;
        const labels = stagesForPosition(raw as string[]).map((s) => stageLabel(s));
        if (labels.join("|") === DEFAULT_STAGES.map((s) => stageLabel(s)).join("|")) continue;
        customCount += 1;
        stageAoa.push([p.title, labels.join(" | ")]);
      }
      if (customCount === 0) stageAoa.push(["(semua posisi memakai tahap bawaan)", ""]);
      const sheetTahap = XLSX.utils.aoa_to_sheet(stageAoa);
      sheetTahap["!cols"] = [{ wch: 36 }, { wch: 90 }];

      const sheetPetunjuk = buildPetunjukSheet([
        "1. Kolom 'Kode Tracking' diisi kode lamaran (kolom 'Kode' pada Unduh Excel Pelamar), satu kode per baris.",
        "2. Kolom 'Tahap Baru' diisi nama tahap TUJUAN — harus salah satu dari daftar tahap posisi terkait (lihat sheet 'Daftar Tahap').",
        "3. Kolom 'Catatan (opsional)' disimpan sebagai catatan pada riwayat perubahan tahap.",
        "4. Hanya lamaran aktif (tidak dihapus) yang bisa diperbarui; kode yang tidak ditemukan ditandai pada pratinjau.",
        "5. Simpan sebagai .xlsx lalu unggah di menu Data > Update Status Massal (Excel). Pratinjau validasi muncul sebelum konfirmasi.",
        "6. Update massal HANYA memindahkan tahap pipeline — tidak mengubah status offer, penolakan terstruktur, atau data lain.",
      ]);

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheetData, "Update Status");
      XLSX.utils.book_append_sheet(workbook, sheetTahap, "Daftar Tahap");
      XLSX.utils.book_append_sheet(workbook, sheetPetunjuk, "Petunjuk");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": XLSX_MIME,
          "Content-Disposition": `attachment; filename="template-update-status.xlsx"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    /* ===================== entity=applications (default) ===================== */
    const rows = await db.application.findMany({
      where: baseWhere,
      orderBy,
      include: APPLICATION_INCLUDE,
    });

    /* ----------------------------- Mode XLSX ----------------------------- */
    if (format === "xlsx") {
      const baseHeader = buildHeader();
      const dataHeader = [...baseHeader, "Status Offer"];
      const dataAoa: (string | number)[][] = [dataHeader];
      for (const row of rows) {
        dataAoa.push([...buildCells(row), offerStatusLabel(row.offerStatus)]);
      }
      const sheetLamaran = XLSX.utils.aoa_to_sheet(dataAoa);
      sheetLamaran["!cols"] = dataHeader.map((title, index) => ({
        wch: index === 0 ? 14 : Math.max(12, Math.min(42, title.length + 6)),
      }));
      sheetLamaran["!autofilter"] = { ref: autofilterRef(dataHeader.length, dataAoa.length) };

      // XL-BE — sheet "Interview": seluruh sesi wawancara lamaran hasil filter.
      const interviews = await db.interview.findMany({
        where: { application: baseWhere },
        orderBy: [{ scheduledAt: "desc" }, { id: "desc" }],
        include: { application: { include: { position: true } } },
      });
      const ivAoa: (string | number)[][] = [INTERVIEW_HEADER];
      for (const iv of interviews) ivAoa.push(interviewCells(iv));
      const sheetInterview = XLSX.utils.aoa_to_sheet(ivAoa);
      sheetInterview["!cols"] = INTERVIEW_HEADER.map((title) => ({ wch: Math.max(12, Math.min(38, title.length + 6)) }));
      sheetInterview["!autofilter"] = { ref: autofilterRef(INTERVIEW_HEADER.length, ivAoa.length) };

      // Sheet "Ringkasan": rekap per status + per posisi (dari data yang diekspor).
      const statusCounts = new Map<string, number>();
      const positionStats = new Map<string, { total: number; accepted: number }>();
      for (const row of rows) {
        const statusName = stageLabel(row.status.trim() || "NEW");
        statusCounts.set(statusName, (statusCounts.get(statusName) ?? 0) + 1);
        const positionTitle = row.position?.title ?? "(tanpa posisi)";
        const stat = positionStats.get(positionTitle) ?? { total: 0, accepted: 0 };
        stat.total += 1;
        if (row.status === "ACCEPTED") stat.accepted += 1;
        positionStats.set(positionTitle, stat);
      }

      const summaryAoa: (string | number)[][] = [["Rekap per Status"], ["Status", "Jumlah"]];
      for (const [statusName, count] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
        summaryAoa.push([statusName, count]);
      }
      summaryAoa.push(["Total", rows.length]);
      summaryAoa.push([]);
      summaryAoa.push(["Rekap per Posisi"], ["Posisi", "Jumlah Lamaran", "Diterima"]);
      for (const [positionTitle, stat] of [...positionStats.entries()].sort((a, b) => b[1].total - a[1].total)) {
        summaryAoa.push([positionTitle, stat.total, stat.accepted]);
      }
      const sheetRingkasan = XLSX.utils.aoa_to_sheet(summaryAoa);
      sheetRingkasan["!cols"] = [{ wch: 34 }, { wch: 16 }, { wch: 12 }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheetLamaran, "Lamaran");
      XLSX.utils.book_append_sheet(workbook, sheetInterview, "Interview");
      XLSX.utils.book_append_sheet(workbook, sheetRingkasan, "Ringkasan");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const fileName = `lamaran-lumina-${todayFileStamp(new Date())}.xlsx`;
      await db.activityLog.create({
        data: {
          actor: session.name,
          action: "EXPORT_EXCEL",
          detail: `Ekspor Excel ${rows.length} lamaran (${interviews.length} sesi wawancara).`,
        },
      });
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": XLSX_MIME,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    /* ------------------------------ Mode CSV ------------------------------ */
    const lines = [buildHeader().map(csvCell).join(",")];
    for (const row of rows) {
      lines.push(buildCells(row).map(csvCell).join(","));
    }

    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
    await db.activityLog.create({
      data: {
        actor: session.name,
        action: "EXPORT_CSV",
        detail: `Ekspor CSV ${rows.length} lamaran.`,
      },
    });
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lamaran-lumina.csv"`,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/applications/export]", error);
    return NextResponse.json({ error: "Gagal mengekspor lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
