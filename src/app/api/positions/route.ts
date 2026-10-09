// GET /api/positions — daftar posisi lowongan tayang (publik, tanpa auth).
// NR-41 E2 — endpoint publik ringan berbasis etagJson: ETag + Cache-Control +
// 304 bila If-None-Match cocok. Isi = posisi aktif yang sedang tayang
// (pola yang sama dengan /api/public/content, tanpa statistik).
// NR45 — lapisan MEMO CACHE 30 detik (100 pengunjung = 1 query DB) dengan
// invalidasi otomatis via emitRealtime("positions:changed"), header X-Cache,
// dan pencatatan permintaan lambat (SLOW_REQUEST).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { closeExpiredPositions, ensureSeeded, serializePosition } from "@/lib/seed";
import { etagJson } from "@/lib/http-cache";
import { memoGet, recordSlowRequest } from "@/lib/load-metrics";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  try {
    const { value, cached } = await memoGet("positions:main", 30_000, async () => {
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
      return { items: positions.map(serializePosition) };
    });

    // NR-41 E2 — ETag + Cache-Control (kontrak body stabil via serializePosition).
    // NR45 — header X-Cache (dipakai panel demo "Uji Cache").
    const res = etagJson(req, value, undefined, { "X-Cache": cached ? "HIT" : "MISS" });
    recordSlowRequest("GET /api/positions", Date.now() - t0);
    return res;
  } catch (error) {
    recordSlowRequest("GET /api/positions", Date.now() - t0);
    console.error("[GET /api/positions]", error);
    return etagJson(req, { items: [] }, "no-store");
  }
}
