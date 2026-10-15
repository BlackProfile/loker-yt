// GET /api/positions — daftar posisi lowongan tayang (publik, tanpa auth).
// NR-41 E2 — endpoint publik ringan berbasis etagJson: ETag + Cache-Control +
// 304 bila If-None-Match cocok. Isi = posisi aktif yang sedang tayang
// (pola yang sama dengan /api/public/content, tanpa statistik).
// NR45 — lapisan MEMO CACHE 30 detik (100 pengunjung = 1 query DB) dengan
// invalidasi otomatis via emitRealtime("positions:changed"), header X-Cache,
// dan pencatatan permintaan lambat (SLOW_REQUEST).
// NR58 (A1/A2) — rate limit publik 120/mnt/IP + SERVE-STALE: saat Mode Hemat/
// beban kritis loader tidak dipanggil selama snapshot basi masih <= 10 menit,
// dan bila loader gagal data basi tetap disajikan — landing tidak pernah error.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { closeExpiredPositions, ensureSeeded, serializePosition } from "@/lib/seed";
import { etagJson } from "@/lib/http-cache";
import { memoGetHeavy, recordSlowRequest } from "@/lib/load-metrics";
import { publicRateGuard, PUBLIC_RATE_LIMITS } from "@/lib/public-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  // NR58 (A1) — pelindung pertama sebelum menyentuh cache/DB.
  const limited = publicRateGuard(
    req,
    "positions",
    PUBLIC_RATE_LIMITS.readPerMinute,
    60_000,
  );
  if (limited) return limited;

  try {
    const { value, cached, stale } = await memoGetHeavy(
      "positions:main",
      30_000,
      10 * 60_000,
      async () => {
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
      },
    );

    // NR-41 E2 — ETag + Cache-Control (kontrak body stabil via serializePosition).
    // NR45 — header X-Cache (dipakai panel demo "Uji Cache").
    // NR58 — X-Data-Stale: 1 saat server menyajikan snapshot basi (Mode Hemat/
    // beban kritis) agar klien bisa memberi tahu "data mungkin tertunda".
    const res = etagJson(req, value, undefined, {
      "X-Cache": cached ? "HIT" : "MISS",
      ...(stale ? { "X-Data-Stale": "1" } : {}),
    });
    recordSlowRequest("GET /api/positions", Date.now() - t0);
    return res;
  } catch (error) {
    recordSlowRequest("GET /api/positions", Date.now() - t0);
    console.error("[GET /api/positions]", error);
    return etagJson(req, { items: [] }, "no-store");
  }
}
