// GET /api/admin/scorecard?applicationIds=id1,id2 — skor wawancara tertimbang per lamaran.
// Kontrak NR44: rata tertimbang dari scorecard hasil wawancara memakai bobot kriteria
// posisi (Position.interviewCriteriaWeights). Bila posisi tanpa bobot -> fallback rata
// biasa (covered=false). Dipakai dialog bandingkan pelamar & dialog detail lamaran.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  averageScoresAcrossSessions,
  parseCriteriaWeights,
  weightedAverage,
} from "@/lib/scorecard";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

type ScoreResult = { value: number | null; covered: boolean; hasWeights: boolean };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const ids = (req.nextUrl.searchParams.get("applicationIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 25);
    if (ids.length === 0) {
      return NextResponse.json({ scores: {} });
    }

    const apps = await db.application.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true,
        position: { select: { interviewCriteriaWeights: true } },
        interviews: { select: { scores: true } },
      },
    });

    const scores: Record<string, ScoreResult> = {};
    for (const app of apps) {
      const weights = parseCriteriaWeights(app.position?.interviewCriteriaWeights ?? null);
      const hasWeights = Object.keys(weights).length > 0;
      const merged = averageScoresAcrossSessions(
        app.interviews.map((i) => {
          try {
            const parsed: unknown = i.scores ? JSON.parse(i.scores) : null;
            return parsed && typeof parsed === "object" && !Array.isArray(parsed)
              ? (parsed as Record<string, number>)
              : null;
          } catch {
            return null;
          }
        }),
      );
      const result = weightedAverage(merged, hasWeights ? weights : null);
      scores[app.id] = { ...result, hasWeights };
    }

    return NextResponse.json({ scores });
  } catch (error) {
    console.error("[GET /api/admin/scorecard]", error);
    return NextResponse.json({ error: "Gagal menghitung skor scorecard." }, { status: 500 });
  }
}
