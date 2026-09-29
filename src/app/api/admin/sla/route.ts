// GET /api/admin/sla — alert SLA per tahap: lamaran aktif yang terlalu lama diam
// di satu tahap pipeline. Query ?days=N (default 7, min 1, maks 90).
// Kriteria: belum dihapus/diarsipkan, status bukan REJECTED/ACCEPTED/HIRED, dan
// stageUpdatedAt (fallback createdAt) lebih lama dari N hari. Urut paling lama dulu.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const DAY_MS = 24 * 60 * 60 * 1000;
const EXCLUDED_STATUSES = ["REJECTED", "ACCEPTED", "HIRED"];

/** days dari query: default 7, dijepit 1-90 (integer). */
function parseDays(raw: string | null): number {
  if (raw === null || raw.trim() === "") return 7;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 7;
  return Math.min(90, Math.max(1, n));
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const days = parseDays(searchParams.get("days"));
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const rows = await db.application.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
        status: { notIn: EXCLUDED_STATUSES },
        OR: [
          { stageUpdatedAt: { lt: cutoff } },
          { AND: [{ stageUpdatedAt: null }, { createdAt: { lt: cutoff } }] },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 500, // kandidat cukup banyak; penyaringan & urutan final di JS
      select: {
        id: true,
        name: true,
        trackingCode: true,
        status: true,
        stageUpdatedAt: true,
        createdAt: true,
        position: { select: { title: true } },
      },
    });

    // Prisma tidak bisa orderBy coalesce(stageUpdatedAt, createdAt) di SQLite —
    // urutkan di JS berdasarkan lama hari di tahap, ambil 20 teratas.
    const now = Date.now();
    const body = {
      days,
      rows: rows
        .map((row) => {
          const effective = row.stageUpdatedAt ?? row.createdAt;
          return {
            id: row.id,
            name: row.name,
            trackingCode: row.trackingCode,
            positionTitle: row.position?.title ?? null,
            status: row.status,
            label: stageLabel(row.status),
            tanggalPaten: effective.toISOString(),
            daysInStage: Math.max(0, Math.floor((now - effective.getTime()) / DAY_MS)),
          };
        })
        .sort((a, b) => b.daysInStage - a.daysInStage)
        .slice(0, 20),
    };

    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/admin/sla]", error);
    return NextResponse.json(
      { error: "Gagal memuat data SLA. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
