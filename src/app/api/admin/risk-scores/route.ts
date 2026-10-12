// NR49 Paket C fitur 2 — Skor Risiko (GET, semua role login).
// Deteksi kandidat berisiko:
//   - Wawancara: status SCHEDULED|CONFIRMED|RESCHEDULE_REQUESTED, terjadwal <= 7 hari.
//   - Offer: offerStatus PENDING dan (deadline <= 14 hari ATAU terkirim >= 3 hari
//     lalu tanpa jawaban).
// Skor 0-100 DETERMINISTIK (heuristik transparan, tanpa LLM). Urut skor desc,
// maksimal 12 item. Penjelasan naratif via POST /api/admin/risk-explain.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { errorMessage } from "@/lib/ai-json";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export type RiskItem = {
  kind: "interview" | "offer";
  id: string; // interviewId / applicationId
  name: string;
  positionTitle: string | null;
  when: string | null; // ISO — jadwal wawancara / batas jawaban offer
  score: number;
  reasons: string[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const now = new Date();
    const in7Days = new Date(now.getTime() + 7 * DAY_MS);
    const in14Days = new Date(now.getTime() + 14 * DAY_MS);
    const threeDaysAgo = new Date(now.getTime() - 3 * DAY_MS);
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const in3Days = new Date(now.getTime() + 3 * DAY_MS);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const interviews = await db.interview.findMany({
      where: {
        status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"] },
        scheduledAt: { gte: now, lte: in7Days },
      },
      include: {
        application: {
          select: {
            id: true,
            name: true,
            createdAt: true,
            candidateSeenCount: true,
            position: { select: { title: true } },
          },
        },
      },
      orderBy: { scheduledAt: "asc" },
    });

    const offers = await db.application.findMany({
      where: {
        deletedAt: null,
        offerStatus: "PENDING",
        OR: [
          { offerDeadline: { lte: in14Days } },
          { offerSentAt: { lte: threeDaysAgo }, offerRespondedAt: null },
        ],
      },
      select: {
        id: true,
        name: true,
        createdAt: true,
        candidateSeenCount: true,
        offerSentAt: true,
        offerDeadline: true,
        offerRespondedAt: true,
        position: { select: { title: true } },
      },
    });

    const items: RiskItem[] = [];

    for (const iv of interviews) {
      const score = 25;
      const reasons: string[] = [];
      if (iv.status === "RESCHEDULE_REQUESTED") {
        reasons.push("Pernah minta ubah jadwal");
      }
      if (iv.status === "SCHEDULED" && iv.scheduledAt <= in48Hours) {
        reasons.push("Belum mengonfirmasi kehadiran dan wawancara kurang dari 48 jam lagi");
      }
      if (iv.application.candidateSeenCount <= 0) {
        reasons.push("Belum pernah membuka halaman status lamaran");
      }
      if (iv.application.createdAt <= thirtyDaysAgo) {
        reasons.push("Lamaran sudah masuk lebih dari 30 hari");
      }
      items.push({
        kind: "interview",
        id: iv.id,
        name: iv.application.name,
        positionTitle: iv.application.position?.title ?? null,
        when: iv.scheduledAt.toISOString(),
        score: clampScore(score),
        reasons,
      });
    }

    for (const app of offers) {
      const score = 25;
      const reasons: string[] = [];
      if (app.offerSentAt && app.offerSentAt <= sevenDaysAgo) {
        reasons.push("Offer belum dijawab lebih dari 7 hari sejak dikirim");
      }
      if (!app.offerRespondedAt && app.offerDeadline && app.offerDeadline <= in3Days) {
        reasons.push("Batas jawaban kurang dari 3 hari lagi");
      }
      if (app.candidateSeenCount <= 0) {
        reasons.push("Belum pernah membuka halaman status lamaran");
      }
      items.push({
        kind: "offer",
        id: app.id,
        name: app.name,
        positionTitle: app.position?.title ?? null,
        when: (app.offerDeadline ?? app.offerSentAt)?.toISOString() ?? null,
        score: clampScore(score),
        reasons,
      });
    }

    items.sort((a, b) => b.score - a.score);
    return NextResponse.json({ items: items.slice(0, 12) });
  } catch (error) {
    console.error("[GET /api/admin/risk-scores]", errorMessage(error));
    return NextResponse.json({ error: "Gagal memuat skor risiko." }, { status: 500 });
  }
}
