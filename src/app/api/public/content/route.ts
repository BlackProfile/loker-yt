// GET /api/public/content — konten landing page publik (site + posisi tayang + statistik + kuota).
// NR-41 E2 — respons dibungkus etagJson: ETag + Cache-Control + 304 bila If-None-Match cocok.
// NR45 — MEMO CACHE 45 detik (invalidasi otomatis via emitRealtime), header
// X-Cache, slow log, dan field aditif `maintenance` (mode perawatan situs).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { closeExpiredPositions, ensureSeeded, parseSiteContent, serializePosition } from "@/lib/seed";
import { etagJson } from "@/lib/http-cache";
import { memoGet, readMaintenanceConfig, recordSlowRequest } from "@/lib/load-metrics";
import type { PositionPublicStats, PublicContentResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  try {
    const { value: body, cached } = await memoGet<PublicContentResponse>(
      "content:main",
      45_000,
      async () => {
        await ensureSeeded();
        await closeExpiredPositions();

        const now = new Date();
        const positions = await db.position.findMany({
          // Tayang = aktif, belum lewat closesAt, publishAt sudah tercapai,
          // dan TIDAK ter-soft-delete (Task 27: posisi di tong sampah tidak tayang).
          where: {
            isActive: true,
            deletedAt: null,
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
              position.maxApplicants == null
                ? null
                : Math.max(0, position.maxApplicants - applications),
          };
        }

        const [totalApplications, siteSetting, maintenance] = await Promise.all([
          db.application.count(),
          db.setting.findUnique({ where: { key: "site" } }),
          readMaintenanceConfig(),
        ]);

        const built: PublicContentResponse = {
          site: parseSiteContent(siteSetting?.value),
          positions: positions.map(serializePosition),
          stats: {
            openRoles: positions.length,
            totalApplications,
          },
          positionStats,
          // NR45 — info mode perawatan (aditif; landing live-update lewat sini).
          maintenance: {
            enabled: maintenance.enabled,
            level: maintenance.level,
            message: maintenance.message,
          },
        };
        return built;
      },
    );

    // NR-41 E2 — ETag + Cache-Control (kontrak body tidak berubah kecuali aditif).
    // NR45 — header X-Cache (dipakai panel demo "Uji Cache").
    const res = etagJson(req, body, undefined, { "X-Cache": cached ? "HIT" : "MISS" });
    recordSlowRequest("GET /api/public/content", Date.now() - t0);
    return res;
  } catch (error) {
    recordSlowRequest("GET /api/public/content", Date.now() - t0);
    console.error("[GET /api/public/content]", error);
    return NextResponse.json(
      { error: "Gagal memuat konten situs. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
