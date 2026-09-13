// GET /api/admin/reports/ai-validation — validasi akurasi skor AI (semua role).
// Ambil lamaran dengan aiScore tidak null DAN status final (ACCEPTED/REJECTED —
// termasuk tahap kustom yang dikategorikan ACCEPTED/REJECTED), lalu hitung:
// - total dianalisis + rata-rata skor yang diterima vs ditolak
// - akurasi rule sederhana: aiScore >= 60 diprediksi diterima -> accuracyPct benar/salah
// - matriks 2x2 (benar-positif, false-positive, false-negative, benar-negatif)
// - 5 "miss" terbesar: ditolak tapi skor tinggi, diterima tapi skor rendah.
// Catatan: metrik indikatif — keputusan akhir tetap manusia.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { categoryForStage, isBuiltInStage } from "@/lib/stages";
import { parseStageCategories } from "@/lib/seed";
import type { StageCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const THRESHOLD = 60;

type Outcome = "DITERIMA" | "DITOLAK";

/** Hasil akhir lamaran: tahap bawaan langsung; tahap kustom lewat kategorinya. */
function finalOutcome(status: string, cats: Record<string, StageCategory>): Outcome | null {
  if (isBuiltInStage(status)) {
    if (status === "ACCEPTED") return "DITERIMA";
    if (status === "REJECTED") return "DITOLAK";
    return null;
  }
  const cat = categoryForStage(status, cats);
  if (cat === "ACCEPTED") return "DITERIMA";
  if (cat === "REJECTED") return "DITOLAK";
  return null;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.application.findMany({
      where: { aiScore: { not: null } },
      select: {
        id: true,
        name: true,
        aiScore: true,
        status: true,
        position: { select: { title: true, stageCategories: true } },
      },
    });

    let totalAnalyzed = 0;
    let notFinal = 0;
    let sumAccepted = 0;
    let nAccepted = 0;
    let sumRejected = 0;
    let nRejected = 0;
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;
    const misses: {
      id: string;
      name: string;
      positionTitle: string | null;
      aiScore: number;
      outcome: Outcome;
      kind: "tinggi_ditolak" | "rendah_diterima";
      gap: number;
    }[] = [];

    for (const row of rows) {
      const cats = parseStageCategories(row.position?.stageCategories ?? "{}");
      const outcome = finalOutcome(row.status, cats);
      if (!outcome) {
        notFinal += 1; // skor AI ada tapi lamaran belum berakhir (masih diproses)
        continue;
      }
      const score = row.aiScore ?? 0;
      totalAnalyzed += 1;
      const predictedAccepted = score >= THRESHOLD;

      if (outcome === "DITERIMA") {
        sumAccepted += score;
        nAccepted += 1;
        if (predictedAccepted) {
          tp += 1; // prediksi diterima, kenyataan diterima
        } else {
          fn += 1; // prediksi ditolak, kenyataan diterima
          misses.push({
            id: row.id,
            name: row.name,
            positionTitle: row.position?.title ?? null,
            aiScore: score,
            outcome,
            kind: "rendah_diterima",
            gap: THRESHOLD - score,
          });
        }
      } else {
        sumRejected += score;
        nRejected += 1;
        if (predictedAccepted) {
          fp += 1; // prediksi diterima, kenyataan ditolak
          misses.push({
            id: row.id,
            name: row.name,
            positionTitle: row.position?.title ?? null,
            aiScore: score,
            outcome,
            kind: "tinggi_ditolak",
            gap: score - THRESHOLD,
          });
        } else {
          tn += 1; // prediksi ditolak, kenyataan ditolak
        }
      }
    }

    misses.sort((a, b) => b.gap - a.gap);

    return NextResponse.json({
      totalAnalyzed,
      notFinal,
      avgScoreAccepted: nAccepted > 0 ? Math.round((sumAccepted / nAccepted) * 10) / 10 : null,
      avgScoreRejected: nRejected > 0 ? Math.round((sumRejected / nRejected) * 10) / 10 : null,
      accuracyPct: totalAnalyzed > 0 ? Math.round(((tp + tn) / totalAnalyzed) * 100) : null,
      threshold: THRESHOLD,
      matrix: { tp, fp, fn, tn },
      misses: misses.slice(0, 5),
    });
  } catch (error) {
    console.error("[GET /api/admin/reports/ai-validation]", error);
    return NextResponse.json(
      { error: "Gagal memuat validasi akurasi AI. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
