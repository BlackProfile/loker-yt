// GET /api/public/content — konten landing page publik (site + posisi tayang + statistik + kuota).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { closeExpiredPositions, ensureSeeded, parseSiteContent, serializePosition } from "@/lib/seed";
import type { PositionPublicStats, PublicContentResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    await closeExpiredPositions();

    const now = new Date();
    const positions = await db.position.findMany({
      // Tayang = aktif, belum lewat closesAt, dan publishAt sudah tercapai.
      where: {
        isActive: true,
        AND: [
          { OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
          { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
        ],
      },
      // Featured dulu, lalu urutan manual, lalu terlama dibuat.
      orderBy: [{ featured: "desc" }, { order: "asc" }, { createdAt: "asc" }],
    });

    // Statistik publik per posisi tayang: jumlah lamaran (non-ditolak) + sisa kuota.
    const positionIds = positions.map((p) => p.id);
    const appGroups =
      positionIds.length > 0
        ? await db.application.groupBy({
            by: ["positionId"],
            where: { positionId: { in: positionIds }, status: { not: "REJECTED" } },
            _count: { _all: true },
          })
        : [];
    const countByPosition = new Map<string, number>();
    for (const group of appGroups) {
      if (group.positionId) countByPosition.set(group.positionId, group._count._all);
    }
    const positionStats: Record<string, PositionPublicStats> = {};
    for (const position of positions) {
      const applications = countByPosition.get(position.id) ?? 0;
      positionStats[position.id] = {
        applications,
        remainingQuota:
          position.maxApplicants == null ? null : Math.max(0, position.maxApplicants - applications),
      };
    }

    const [totalApplications, siteSetting] = await Promise.all([
      db.application.count(),
      db.setting.findUnique({ where: { key: "site" } }),
    ]);

    const body: PublicContentResponse = {
      site: parseSiteContent(siteSetting?.value),
      positions: positions.map(serializePosition),
      stats: {
        openRoles: positions.length,
        totalApplications,
      },
      positionStats,
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/public/content]", error);
    return NextResponse.json({ error: "Gagal memuat konten situs. Coba lagi nanti." }, { status: 500 });
  }
}
