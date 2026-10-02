// GET /api/admin/overview — ringkasan dashboard: statistik status, grafik harian,
// wawancara mendatang, lamaran stale, jumlah subscriber, rata-rata skor AI.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  closeExpiredPositions,
  ensureSeeded,
  serializeApplication,
} from "@/lib/seed";
import { isBuiltInStage } from "@/lib/stages";
import { readStatusCheckStats } from "@/lib/status-stats";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 7 * DAY_MS;

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Median daftar angka (rata-rata dua nilai tengah bila jumlah genap). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Kesehatan halaman Cek Status (NR-15, idea 14):
 * - checksToday/loginsToday: penghitung harian dari site.statusCheckStats.
 * - avgViewDelayHours: rata-rata jeda "tahap berubah -> dilihat pelamar"
 *   (stageUpdatedAt 7 hari terakhir, candidateSeenAt > stageUpdatedAt).
 * - mostStalledStage: tahap aktif dengan waktu tunggu median terlama
 *   (minimal 3 lamaran per tahap).
 */
type StatusHealth = {
  checksToday: number;
  loginsToday: number;
  avgViewDelayHours: number | null;
  mostStalledStage: { label: string; medianDays: number } | null;
};

async function computeStatusHealth(now: Date): Promise<StatusHealth> {
  const [stats, delayRows, activeRows] = await Promise.all([
    readStatusCheckStats(),
    db.application.findMany({
      where: {
        deletedAt: null,
        stageUpdatedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
        candidateSeenAt: { not: null },
      },
      select: { stageUpdatedAt: true, candidateSeenAt: true },
    }),
    db.application.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ["ACCEPTED", "REJECTED"] },
      },
      select: { status: true, stageUpdatedAt: true, createdAt: true },
    }),
  ]);

  // Rata-rata jeda tampil (jam, 1 desimal) — hanya sampel positif.
  const delays: number[] = [];
  for (const row of delayRows) {
    if (!row.stageUpdatedAt || !row.candidateSeenAt) continue;
    const delayMs = row.candidateSeenAt.getTime() - row.stageUpdatedAt.getTime();
    if (delayMs <= 0) continue;
    delays.push(delayMs / (60 * 60 * 1000));
  }
  const avgDelay =
    delays.length === 0
      ? null
      : Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10;

  // Median waktu menginap per tahap aktif (hari) — ambil yang terlama (min 3 sampel).
  const buckets = new Map<string, number[]>();
  for (const row of activeRows) {
    const stage = row.status.trim() || "NEW";
    const base = (row.stageUpdatedAt ?? row.createdAt).getTime();
    const waitDays = (now.getTime() - base) / DAY_MS;
    if (waitDays < 0) continue;
    const list = buckets.get(stage) ?? [];
    list.push(waitDays);
    buckets.set(stage, list);
  }
  let mostStalled: { label: string; medianDays: number } | null = null;
  for (const [stage, list] of buckets) {
    if (list.length < 3) continue;
    const med = median(list);
    if (med === null) continue;
    if (!mostStalled || med > mostStalled.medianDays) {
      mostStalled = {
        label: isBuiltInStage(stage) ? STATUS_LABELS[stage as ApplicationStatus] : stage,
        medianDays: Math.round(med * 10) / 10,
      };
    }
  }

  return {
    checksToday: stats.checks,
    loginsToday: stats.logins,
    avgViewDelayHours: avgDelay,
    mostStalledStage: mostStalled,
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    await ensureSeeded();
    await closeExpiredPositions();

    const now = new Date();
    const startOfRange = new Date(now);
    startOfRange.setDate(startOfRange.getDate() - 29);
    startOfRange.setHours(0, 0, 0, 0);
    const staleBefore = new Date(now.getTime() - STALE_MS);

    const [total, statusGroups, recentRows, dailyRows, upcomingRows, staleRows, subscriberCount, aiAgg] =
      await Promise.all([
        db.application.count(),
        db.application.groupBy({ by: ["status"], _count: { _all: true } }),
        db.application.findMany({
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 5,
          include: APPLICATION_INCLUDE,
        }),
        db.application.findMany({
          where: { createdAt: { gte: startOfRange } },
          select: { createdAt: true },
        }),
        db.application.findMany({
          where: { interviewAt: { gte: now } },
          orderBy: [{ interviewAt: "asc" }],
          take: 5,
          include: APPLICATION_INCLUDE,
        }),
        db.application.findMany({
          where: { status: { in: ["NEW", "REVIEWED"] }, updatedAt: { lt: staleBefore } },
          orderBy: [{ updatedAt: "asc" }],
          take: 5,
          include: APPLICATION_INCLUDE,
        }),
        db.subscriber.count(),
        db.application.aggregate({ _avg: { aiScore: true } }),
      ]);

    const stats = {
      total,
      NEW: 0,
      REVIEWED: 0,
      INTERVIEW: 0,
      ACCEPTED: 0,
      REJECTED: 0,
      CUSTOM: 0, // lamaran pada tahap kustom (di luar 5 status bawaan)
    };
    for (const group of statusGroups) {
      if ((APPLICATION_STATUSES as string[]).includes(group.status)) {
        stats[group.status as ApplicationStatus] = group._count._all;
      } else {
        stats.CUSTOM += group._count._all;
      }
    }

    // Grafik harian 30 hari terakhir (termasuk tanggal kosong dengan count 0)
    const countsByDate = new Map<string, number>();
    for (const row of dailyRows) {
      const key = dateKey(row.createdAt);
      countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
    }
    const daily: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now.getTime() - i * DAY_MS);
      const key = dateKey(day);
      daily.push({ date: key, count: countsByDate.get(key) ?? 0 });
    }

    const avgAiScore =
      aiAgg._avg.aiScore === null || aiAgg._avg.aiScore === undefined
        ? null
        : Math.round(aiAgg._avg.aiScore);

    // Kesehatan halaman Cek Status (NR-15) — kegagalan tidak boleh menggagalkan overview.
    let statusHealth: Awaited<ReturnType<typeof computeStatusHealth>> | undefined;
    try {
      statusHealth = await computeStatusHealth(now);
    } catch {
      statusHealth = undefined;
    }

    return NextResponse.json({
      stats,
      recent: recentRows.map(serializeApplication),
      daily,
      upcomingInterviews: upcomingRows.map(serializeApplication),
      stale: staleRows.map(serializeApplication),
      subscriberCount,
      avgAiScore,
      ...(statusHealth ? { statusHealth } : {}),
    });
  } catch (error) {
    console.error("[GET /api/admin/overview]", error);
    return NextResponse.json({ error: "Gagal memuat ringkasan. Coba lagi nanti." }, { status: 500 });
  }
}
