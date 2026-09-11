// GET /api/public/content — konten landing page publik (site + posisi aktif + statistik).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { closeExpiredPositions, ensureSeeded, parseSiteContent, serializePosition } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeeded();
    await closeExpiredPositions();

    const [positions, totalApplications, siteSetting] = await Promise.all([
      db.position.findMany({
        where: {
          isActive: true,
          OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }],
        },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      db.application.count(),
      db.setting.findUnique({ where: { key: "site" } }),
    ]);

    return NextResponse.json({
      site: parseSiteContent(siteSetting?.value),
      positions: positions.map(serializePosition),
      stats: {
        openRoles: positions.length,
        totalApplications,
      },
    });
  } catch (error) {
    console.error("[GET /api/public/content]", error);
    return NextResponse.json({ error: "Gagal memuat konten situs. Coba lagi nanti." }, { status: 500 });
  }
}
