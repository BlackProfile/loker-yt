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
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/types";

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
    };
    for (const group of statusGroups) {
      if ((APPLICATION_STATUSES as string[]).includes(group.status)) {
        stats[group.status as ApplicationStatus] = group._count._all;
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

    return NextResponse.json({
      stats,
      recent: recentRows.map(serializeApplication),
      daily,
      upcomingInterviews: upcomingRows.map(serializeApplication),
      stale: staleRows.map(serializeApplication),
      subscriberCount,
      avgAiScore,
    });
  } catch (error) {
    console.error("[GET /api/admin/overview]", error);
    return NextResponse.json({ error: "Gagal memuat ringkasan. Coba lagi nanti." }, { status: 500 });
  }
}
