// GET /api/admin/position-stats — statistik per posisi: views, lamaran, konversi,
// rata-rata skor AI, funnel tahap, dan sumber pelamar (semua role admin).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseRequirements } from "@/lib/seed";
import { stagesForPosition } from "@/lib/stages";
import type { AdminPositionStatsResponse, PositionStatsRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const [positions, applications] = await Promise.all([
      db.position.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
      db.application.findMany({
        select: { positionId: true, status: true, aiScore: true, source: true },
      }),
    ]);

    const rows: PositionStatsRow[] = positions.map((position) => {
      const apps = applications.filter((a) => a.positionId === position.id);

      // Konversi: lamaran per 100 view.
      const conversion =
        position.views > 0 ? Math.round((apps.length / position.views) * 100) : null;

      // Rata-rata skor AI (hanya lamaran yang sudah dianalisis), 1 desimal.
      const scores = apps
        .map((a) => a.aiScore)
        .filter((score): score is number => typeof score === "number");
      const avgAiScore =
        scores.length > 0
          ? Math.round((scores.reduce((sum, s) => sum + s, 0) / scores.length) * 10) / 10
          : null;

      // Funnel: jumlah lamaran per tahap pipeline posisi (bawaan bila stages kosong).
      const stages = stagesForPosition(parseRequirements(position.stages));
      const funnel = stages.map((stage) => ({
        stage,
        count: apps.filter((a) => a.status === stage).length,
      }));

      // Sumber pelamar: agregasi source (trim, buang kosong), urut terbanyak.
      const sourceCount = new Map<string, number>();
      for (const app of apps) {
        const source = (app.source ?? "").trim();
        if (!source) continue;
        sourceCount.set(source, (sourceCount.get(source) ?? 0) + 1);
      }
      const sources = [...sourceCount.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));

      return {
        positionId: position.id,
        title: position.title,
        slug: position.slug,
        isActive: position.isActive,
        views: position.views,
        applications: apps.length,
        conversion,
        avgAiScore,
        funnel,
        sources,
        topSource: sources[0] ?? null,
      };
    });

    const body: AdminPositionStatsResponse = { rows };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/admin/position-stats]", error);
    return NextResponse.json({ error: "Gagal memuat statistik posisi. Coba lagi nanti." }, { status: 500 });
  }
}
