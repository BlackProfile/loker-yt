// SERVER-ONLY — NR49 Paket B: pengumpul konteks ringkas untuk Copilot Admin.
// Pola mengikuti /api/admin/ask-data (agregasi kecil via groupBy/count) namun
// berupa SNAPSHOT JSON terstruktur (bukan teks) agar route copilot bisa
// menyisipkannya ke system prompt secara konsisten.
//
// Prinsip: ringkas dan murah — total ±9 query kecil, tanpa full-scan berat.
import { db } from "@/lib/db";
import { parseStarredBy, parseStageCategories } from "@/lib/seed";
import { stagesForCategory, stagesForPosition, stageLabel } from "@/lib/stages";
import { REJECTION_REASON_LABELS, STATUS_LABELS } from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_POSITIONS = 25;

export type CopilotContextApplication = {
  id: string;
  name: string;
  positionTitle: string | null;
  status: string;
  statusLabel: string;
  validStages: string[];
  daysWaiting: number;
};

export type CopilotContextPosition = {
  id: string;
  title: string;
  isActive: boolean;
  applications7d: number;
};

export type CopilotContext = {
  generatedAt: string;
  /** Jumlah lamaran aktif (belum dihapus) per tahap bawaan. */
  applicationsPerStatus: Record<string, number>;
  /** 5 lamaran berstatus Baru (NEW) paling lama belum diproses. */
  oldestNewApplications: CopilotContextApplication[];
  /** Daftar posisi (aktif lebih dulu) + jumlah lamaran 7 hari terakhir. */
  positions: CopilotContextPosition[];
  /** Wawancara 7 hari ke depan: total + per status. */
  interviewsNext7d: { total: number; perStatus: Record<string, number> };
  /** Offer menunggu jawaban: jumlah + usia terlama (hari). */
  offersPending: { count: number; oldestDays: number | null };
  /** Lamaran NEW yang belum pernah dilihat admin (adminSeenAt null). */
  unseenNewCount: number;
  /** Penolakan 7 hari terakhir per alasan. */
  rejections7d: Record<string, number>;
};

const INTERVIEW_STATUS_KEYS = [
  "SCHEDULED",
  "CONFIRMED",
  "RESCHEDULE_REQUESTED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
] as const;

const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Terjadwal",
  CONFIRMED: "Dikonfirmasi",
  RESCHEDULE_REQUESTED: "Minta Ubah Jadwal",
  COMPLETED: "Selesai",
  NO_SHOW: "Tidak Hadir",
  CANCELLED: "Dibatalkan",
};

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));
}

/** Parse JSON string[] stages posisi secara aman (pola bulk-status). */
function parsePositionStages(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === "string");
    }
  } catch {
    // biarkan null -> default
  }
  return null;
}

/**
 * Kumpulkan snapshot ringkas data rekrutmen untuk konteks Copilot.
 * Semua agregasi dibatasi agar tetap ringan (maks ±9 query kecil).
 */
export async function gatherCopilotContext(): Promise<CopilotContext> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);
  const nextWeek = new Date(now.getTime() + 7 * DAY_MS);

  const [
    statusRows,
    oldestNew,
    positions,
    apps7dRows,
    interviewRows,
    pendingOfferCount,
    oldestPendingOffer,
    unseenNewCount,
    rejectionRows,
  ] = await Promise.all([
    // 1) jumlah lamaran per status bawaan (lamaran aktif, bukan tong sampah)
    db.application.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    // 2) lamaran NEW terlama (5)
    db.application.findMany({
      where: { status: "NEW", deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: {
        id: true,
        name: true,
        createdAt: true,
        status: true,
        position: { select: { title: true, stages: true, stageCategories: true } },
      },
    }),
    // 3) daftar posisi
    db.position.findMany({
      select: { id: true, title: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      take: MAX_POSITIONS,
    }),
    // 4) lamaran 7 hari terakhir per posisi
    db.application.groupBy({
      by: ["positionId"],
      where: { createdAt: { gte: weekAgo }, deletedAt: null, positionId: { not: null } },
      _count: { _all: true },
    }),
    // 5) wawancara 7 hari ke depan per status
    db.interview.groupBy({
      by: ["status"],
      where: { scheduledAt: { gte: now, lte: nextWeek } },
      _count: { _all: true },
    }),
    // 6) jumlah offer PENDING
    db.application.count({ where: { offerStatus: "PENDING", deletedAt: null } }),
    // 7) offer PENDING terlama
    db.application.findFirst({
      where: { offerStatus: "PENDING", deletedAt: null },
      orderBy: { offerSentAt: "asc" },
      select: { offerSentAt: true, createdAt: true },
    }),
    // 8) lamaran NEW yang belum pernah dilihat admin
    db.application.count({
      where: { status: "NEW", adminSeenAt: null, deletedAt: null },
    }),
    // 9) penolakan 7 hari terakhir per alasan
    db.application.groupBy({
      by: ["rejectionReason"],
      where: { rejectedAt: { gte: weekAgo }, deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  const applicationsPerStatus: Record<string, number> = {};
  for (const key of Object.keys(STATUS_LABELS)) applicationsPerStatus[key] = 0;
  for (const row of statusRows) {
    const key = row.status.trim() || "NEW";
    if (key in applicationsPerStatus) applicationsPerStatus[key] += row._count._all;
  }

  const apps7dByPosition = new Map<string, number>();
  for (const row of apps7dRows) {
    if (row.positionId) apps7dByPosition.set(row.positionId, row._count._all);
  }

  const oldestNewApplications: CopilotContextApplication[] = oldestNew.map((app) => {
    const rawStages = parsePositionStages(app.position?.stages);
    const validStages = stagesForPosition(rawStages);
    return {
      id: app.id,
      name: app.name,
      positionTitle: app.position?.title ?? null,
      status: app.status,
      statusLabel: stageLabel(app.status.trim() || "NEW"),
      validStages: validStages.map((s) => stageLabel(s)),
      daysWaiting: daysBetween(app.createdAt, now),
    };
  });

  const positionsOut: CopilotContextPosition[] = positions.map((p) => ({
    id: p.id,
    title: p.title,
    isActive: p.isActive,
    applications7d: apps7dByPosition.get(p.id) ?? 0,
  }));

  const interviewsPerStatus: Record<string, number> = {};
  for (const key of INTERVIEW_STATUS_KEYS) interviewsPerStatus[key] = 0;
  let interviewsTotal = 0;
  for (const row of interviewRows) {
    if (row.status in interviewsPerStatus) interviewsPerStatus[row.status] += row._count._all;
    interviewsTotal += row._count._all;
  }

  const oldestOfferRef =
    oldestPendingOffer?.offerSentAt ?? oldestPendingOffer?.createdAt ?? null;

  const rejections7d: Record<string, number> = {};
  for (const key of Object.keys(REJECTION_REASON_LABELS)) rejections7d[key] = 0;
  for (const row of rejectionRows) {
    if (row.rejectionReason && row.rejectionReason in rejections7d) {
      rejections7d[row.rejectionReason] += row._count._all;
    }
  }

  return {
    generatedAt: now.toISOString(),
    applicationsPerStatus,
    oldestNewApplications,
    positions: positionsOut,
    interviewsNext7d: { total: interviewsTotal, perStatus: interviewsPerStatus },
    offersPending: {
      count: pendingOfferCount,
      oldestDays: oldestOfferRef ? daysBetween(oldestOfferRef, now) : null,
    },
    unseenNewCount,
    rejections7d,
  };
}

/**
 * Versi teks ringkas konteks untuk disisipkan ke system prompt LLM.
 * Tidak menyertakan id panjang untuk data yang tidak relevan bagi aksi.
 */
export function formatCopilotContext(ctx: CopilotContext): string {
  const statusLines = Object.entries(ctx.applicationsPerStatus)
    .map(([key, count]) => `- ${STATUS_LABELS[key as keyof typeof STATUS_LABELS]} (${key}): ${count}`)
    .join("\n");

  const oldestLines =
    ctx.oldestNewApplications.length > 0
      ? ctx.oldestNewApplications
          .map(
            (app) =>
              `- id=${app.id} | ${app.name} | posisi: ${app.positionTitle ?? "(tanpa posisi)"} | ` +
              `menunggu ${app.daysWaiting} hari | tahap sah posisi ini: ${app.validStages.join(", ")}`
          )
          .join("\n")
      : "- (tidak ada lamaran berstatus Baru)";

  const positionLines =
    ctx.positions.length > 0
      ? ctx.positions
          .map(
            (p) =>
              `- id=${p.id} | ${p.title} | ${p.isActive ? "AKTIF" : "DITUTUP"} | ${p.applications7d} lamaran 7 hari`
          )
          .join("\n")
      : "- (belum ada posisi)";

  const interviewLines = Object.entries(ctx.interviewsNext7d.perStatus)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `- ${INTERVIEW_STATUS_LABELS[key] ?? key}: ${count}`)
    .join("\n");

  const rejectionLines = Object.entries(ctx.rejections7d)
    .filter(([, count]) => count > 0)
    .map(
      ([key, count]) =>
        `- ${REJECTION_REASON_LABELS[key as keyof typeof REJECTION_REASON_LABELS]} (${key}): ${count}`
    )
    .join("\n");

  return [
    `Waktu snapshot: ${ctx.generatedAt}`,
    "",
    "LAMARAN PER STATUS (bawaan):",
    statusLines,
    "",
    `LAMARAN BARU BELUM DILIHAT ADMIN (adminSeenAt kosong): ${ctx.unseenNewCount}`,
    "",
    "LAMARAN NEW TERLAMA (kandidat aksi set_application_status / bulk_reject_stale):",
    oldestLines,
    "",
    "DAFTAR POSISI (maks 25, aktif lebih dulu):",
    positionLines,
    "",
    `WAWANCARA 7 HARI KE DEPAN: total ${ctx.interviewsNext7d.total}`,
    interviewLines || "- (tidak ada)",
    "",
    `OFFER MENUNGGU JAWABAN (PENDING): ${ctx.offersPending.count} | terlama ${ctx.offersPending.oldestDays ?? "-"} hari`,
    "",
    "PENOLAKAN 7 HARI TERAKHIR PER ALASAN:",
    rejectionLines || "- (tidak ada)",
  ].join("\n");
}

/** Hitung tahap penolakan yang sah untuk satu posisi (dipakai eksekusi massal). */
export function rejectionStageForPosition(
  rawStages: string | null | undefined,
  rawCategories: string | null | undefined,
): string | null {
  const stages = stagesForPosition(parsePositionStages(rawStages));
  const rejectedStages = stagesForCategory(stages, parseStageCategories(rawCategories), "REJECTED");
  if (rejectedStages.length > 0) return rejectedStages[0] as string;
  if (stages.includes("REJECTED")) return "REJECTED";
  return null;
}
