// NR70 (Fitur #3) — Statistik program referral untuk admin (OWNER/HR).
// GET /api/admin/referrals -> { total, used, conversionPct, recent: [...] }
//
// Statistik hanya: kode yang sudah dipakai (usedAt != null) & kode terbaru.
// Data pribadi perujuk (email/nama) tetap tampil utk admin — pakai bijaksana.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const RECENT_LIMIT = 20;

export type ReferralRowDto = {
  id: string;
  code: string;
  referrerName: string | null;
  referrerEmail: string;
  applicationId: string | null;
  createdAt: string;
  usedAt: string | null;
  rewardedAt: string | null;
};

export type ReferralsStatsResponse = {
  total: number;
  used: number;
  rewarded: number;
  conversionPct: number; // 0-100, round
  recent: ReferralRowDto[];
};

export async function GET() {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const [total, used, rewarded, recentRows] = await Promise.all([
      db.referralCode.count(),
      db.referralCode.count({ where: { usedAt: { not: null } } }),
      db.referralCode.count({ where: { rewardedAt: { not: null } } }),
      db.referralCode.findMany({
        orderBy: { createdAt: "desc" },
        take: RECENT_LIMIT,
        select: {
          id: true,
          code: true,
          referrerName: true,
          referrerEmail: true,
          applicationId: true,
          createdAt: true,
          usedAt: true,
          rewardedAt: true,
        },
      }),
    ]);

    const conversionPct = total > 0 ? Math.round((used / total) * 100) : 0;

    const recent: ReferralRowDto[] = recentRows.map((r) => ({
      id: r.id,
      code: r.code,
      referrerName: r.referrerName,
      referrerEmail: r.referrerEmail,
      applicationId: r.applicationId,
      createdAt: r.createdAt.toISOString(),
      usedAt: r.usedAt ? r.usedAt.toISOString() : null,
      rewardedAt: r.rewardedAt ? r.rewardedAt.toISOString() : null,
    }));

    const body: ReferralsStatsResponse = {
      total,
      used,
      rewarded,
      conversionPct,
      recent,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/admin/referrals]", error);
    return NextResponse.json(
      { error: "Gagal memuat statistik referral. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
