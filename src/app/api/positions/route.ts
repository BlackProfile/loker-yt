// GET /api/positions — daftar posisi lowongan tayang (publik, tanpa auth).
// NR-41 E2 — endpoint publik ringan berbasis etagJson: ETag + Cache-Control +
// 304 bila If-None-Match cocok. Isi = posisi aktif yang sedang tayang
// (pola yang sama dengan /api/public/content, tanpa statistik).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { closeExpiredPositions, ensureSeeded, serializePosition } from "@/lib/seed";
import { etagJson } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    await closeExpiredPositions();

    const now = new Date();
    const positions = await db.position.findMany({
      // Tayang = aktif, belum lewat closesAt, publishAt sudah tercapai,
      // dan TIDAK ter-soft-delete (posisi di tong sampah tidak tayang).
      where: {
        isActive: true,
        deletedAt: null,
        AND: [
          { OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
          { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
        ],
      },
      orderBy: [{ featured: "desc" }, { order: "asc" }, { createdAt: "asc" }],
    });

    // NR-41 E2 — ETag + Cache-Control (kontrak body stabil via serializePosition).
    return etagJson(req, {
      items: positions.map(serializePosition),
    });
  } catch (error) {
    console.error("[GET /api/positions]", error);
    return etagJson(req, { items: [] }, "no-store");
  }
}
