// GET /api/admin/reports/candidate-survey — rekap survei pengalaman kandidat:
// rata-rata, distribusi 1-5, jumlah terjawab, dan komentar terbaru.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.candidateSurvey.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        score: true,
        comment: true,
        createdAt: true,
        application: { select: { position: { select: { title: true } } } },
      },
    });

    const answered = rows.filter((row) => row.score > 0);
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const row of answered) {
      distribution[row.score] = (distribution[row.score] ?? 0) + 1;
      sum += row.score;
    }
    const avgScore = answered.length > 0 ? Math.round((sum / answered.length) * 10) / 10 : null;

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      sent: rows.length, // token dibuat = email survei terkirim (score 0 = belum diisi)
      answered: answered.length,
      avgScore,
      distribution,
      recent: answered.slice(0, 10).map((row) => ({
        score: row.score,
        comment: row.comment,
        createdAt: row.createdAt.toISOString(),
        positionTitle: row.application?.position?.title ?? null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/reports/candidate-survey]", error);
    return NextResponse.json({ error: "Gagal memuat rekap survei. Coba lagi nanti." }, { status: 500 });
  }
}
