// Rekap bulanan rekrutmen — snapshot statistik satu bulan (ide: "rekap PDF bulanan").
// SERVER-ONLY. Dipakai oleh cron (tanggal 1, jam 07:00 — bulan sebelumnya) dan oleh
// admin (generate/regenerate manual dari tab Laporan). Snapshot disimpan di tabel
// MonthlyReport (month unik, data JSON string).

import { db } from "@/lib/db";

export type MonthlyReportData = {
  month: string; // "YYYY-MM"
  activePositions: number;
  newApplications: number;
  interviewsScheduled: number;
  offersSent: number;
  offersAccepted: number;
  hired: number;
  rejected: number;
  topSources: { source: string; count: number }[];
  avgSurveyScore: number | null;
  surveyCount: number;
};

/** Kunci bulan sebelumnya dari sebuah tanggal, format "YYYY-MM". */
export function previousMonthKey(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Rentang [start, end) untuk kunci "YYYY-MM". Null bila format salah. */
export function monthRange(monthKey: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end };
}

/** Hitung snapshot satu bulan dari database (baca-saja, tidak pernah melempar). */
export async function buildMonthlySnapshot(monthKey: string): Promise<MonthlyReportData> {
  const range = monthRange(monthKey) ?? monthRange(previousMonthKey(new Date()))!;
  const inMonth = { gte: range.start, lt: range.end };

  const [activePositions, newApplications, interviewsScheduled, offersSent, offersAccepted, hired, rejected, sourceRows, surveys] =
    await Promise.all([
      db.position.count({ where: { isActive: true, deletedAt: null } }),
      db.application.count({ where: { createdAt: inMonth } }),
      db.interview.count({ where: { createdAt: inMonth } }),
      db.application.count({ where: { offerSentAt: inMonth } }),
      db.application.count({ where: { offerStatus: "ACCEPTED", offerRespondedAt: inMonth } }),
      db.application.count({ where: { hiredAt: inMonth } }),
      db.application.count({ where: { rejectedAt: inMonth } }),
      db.application.groupBy({
        by: ["source"],
        where: { createdAt: inMonth, source: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { source: "desc" } },
        take: 5,
      }),
      db.candidateSurvey.findMany({
        where: { createdAt: inMonth, score: { gt: 0 } },
        select: { score: true },
      }),
    ]);

  const topSources = sourceRows
    .filter((row) => typeof row.source === "string" && row.source.trim().length > 0)
    .map((row) => ({ source: String(row.source), count: row._count._all }));

  const surveyCount = surveys.length;
  const avgScore =
    surveyCount > 0
      ? Math.round((surveys.reduce((acc, row) => acc + row.score, 0) / surveyCount) * 10) / 10
      : null;

  return {
    month: monthKey,
    activePositions,
    newApplications,
    interviewsScheduled,
    offersSent,
    offersAccepted,
    hired,
    rejected,
    topSources,
    avgSurveyScore: avgScore,
    surveyCount,
  };
}

/**
 * Pastikan snapshot bulan tertentu ada (idempoten — cron aman dipanggil tiap menit).
 * Return true bila snapshot baru dibuat, false bila sudah ada / gagal.
 */
export async function ensureMonthlyReport(monthKey: string): Promise<boolean> {
  try {
    const existing = await db.monthlyReport.findUnique({ where: { month: monthKey } });
    if (existing) return false;
    const data = await buildMonthlySnapshot(monthKey);
    await db.monthlyReport.create({
      data: { month: monthKey, data: JSON.stringify(data) },
    });
    return true;
  } catch (error) {
    console.error(
      "[monthly-report] ensureMonthlyReport gagal:",
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}
