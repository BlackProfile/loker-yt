// GET /api/admin/analytics — agregat analitik rekrutmen (semua role).
// Sumber: Application + Interview. Semua angka dihitung server-side (SQLite).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseScoreRecord, parseTags } from "@/lib/seed";
import { dashboardBucket } from "@/lib/stages";
import { REJECTION_REASON_LABELS, type AnalyticsResponse, type RejectionReason } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Silakan login terlebih dahulu." }, { status: 401 });
    }

    const [applications, interviews] = await Promise.all([
      db.application.findMany({
        select: {
          status: true,
          rejectionReason: true,
          rejectedAt: true,
          hiredAt: true,
          offerStatus: true,
          createdAt: true,
        },
      }),
      db.interview.findMany({
        select: {
          status: true,
          scores: true,
          recommendation: true,
          interviewers: true,
        },
      }),
    ]);

    // Bucket funnel konsisten dengan dashboard (5 bawaan + CUSTOM)
    const funnelMap = new Map<string, number>();
    for (const app of applications) {
      const bucket = dashboardBucket(app.status);
      funnelMap.set(bucket, (funnelMap.get(bucket) ?? 0) + 1);
    }
    const FUNNEL_ORDER = ["NEW", "REVIEWED", "INTERVIEW", "ACCEPTED", "REJECTED", "CUSTOM"];
    const funnel = FUNNEL_ORDER.filter((s) => (funnelMap.get(s) ?? 0) > 0).map((stage) => ({
      stage,
      count: funnelMap.get(stage) ?? 0,
    }));

    // Alasan penolakan
    const reasonMap = new Map<string, number>();
    for (const app of applications) {
      if (app.status === "REJECTED" && app.rejectionReason) {
        reasonMap.set(app.rejectionReason, (reasonMap.get(app.rejectionReason) ?? 0) + 1);
      }
    }
    const rejectionReasons = Array.from(reasonMap.entries())
      .map(([reason, count]) => ({
        reason,
        label: REJECTION_REASON_LABELS[reason as RejectionReason] ?? reason,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    // Rata-rata waktu (hari)
    const now = Date.now();
    const rejectDays = applications
      .filter((a) => a.rejectedAt)
      .map((a) => (a.rejectedAt!.getTime() - a.createdAt.getTime()) / DAY_MS);
    const hireDays = applications
      .filter((a) => a.hiredAt)
      .map((a) => (a.hiredAt!.getTime() - a.createdAt.getTime()) / DAY_MS);
    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null;

    // Offer
    const offersSent = applications.filter((a) => a.offerStatus !== null).length;
    const offersAccepted = applications.filter((a) => a.offerStatus === "ACCEPTED").length;

    // Wawancara
    const completed = interviews.filter((i) => i.status === "COMPLETED");
    const passed = completed.filter((i) => i.recommendation === "LANJUT").length;
    const scoreVals: number[] = [];
    for (const i of completed) {
      const scores = parseScoreRecord(i.scores);
      if (scores && Object.keys(scores).length > 0) {
        const vals = Object.values(scores);
        scoreVals.push(vals.reduce((s, v) => s + v, 0) / vals.length);
      }
    }

    // Beban pewawancara
    const loadMap = new Map<string, number>();
    for (const i of interviews) {
      if (i.status === "CANCELLED") continue;
      for (const name of parseTags(i.interviewers)) {
        loadMap.set(name, (loadMap.get(name) ?? 0) + 1);
      }
    }
    const interviewerLoad = Array.from(loadMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // 6 bulan terakhir: applications & hires
    const monthly: { month: string; applications: number; hires: number }[] = [];
    const monthKeys: string[] = [];
    const base = new Date();
    base.setDate(1);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    for (const key of monthKeys) {
      monthly.push({ month: key, applications: 0, hires: 0 });
    }
    const monthIndex = new Map(monthKeys.map((k, idx) => [k, idx]));
    for (const app of applications) {
      const created = app.createdAt;
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}`;
      const idx = monthIndex.get(key);
      if (idx !== undefined) monthly[idx].applications += 1;
      if (app.hiredAt) {
        const hireKey = `${app.hiredAt.getFullYear()}-${String(app.hiredAt.getMonth() + 1).padStart(2, "0")}`;
        const hireIdx = monthIndex.get(hireKey);
        if (hireIdx !== undefined) monthly[hireIdx].hires += 1;
      }
    }

    const body: AnalyticsResponse = {
      totals: {
        applications: applications.length,
        rejected: applications.filter((a) => a.status === "REJECTED").length,
        hired: applications.filter((a) => a.hiredAt).length,
        offersSent,
        offersAccepted,
        interviewsCompleted: completed.length,
        noShows: interviews.filter((i) => i.status === "NO_SHOW").length,
      },
      funnel,
      rejectionReasons,
      timeToRejectAvgDays: avg(rejectDays),
      timeToHireAvgDays: avg(hireDays),
      offerAcceptanceRate: offersSent > 0 ? Math.round((offersAccepted / offersSent) * 100) : null,
      interviewPassRate: completed.length > 0 ? Math.round((passed / completed.length) * 100) : null,
      avgInterviewScore:
        scoreVals.length > 0
          ? Math.round((scoreVals.reduce((s, v) => s + v, 0) / scoreVals.length) * 10) / 10
          : null,
      interviewerLoad,
      monthly,
    };
    void now;
    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/admin/analytics]", error);
    return NextResponse.json({ error: "Gagal memuat analitik. Coba lagi nanti." }, { status: 500 });
  }
}
