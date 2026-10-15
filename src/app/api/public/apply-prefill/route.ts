// GET /api/public/apply-prefill?email=... — prefill pelamar lama (Task 33-c).
// Tanpa auth (dipanggil dari form publik saat pelamar mengisi email): mengembalikan
// HANYA nama & nomor WhatsApp dari lamaran TERAKHIR dengan email yang sama agar
// pelamar tidak mengetik ulang.
// NR60 (C1) — diperluas untuk peringatan duplikat sebelum submit:
// - lastAppliedAt: ISO waktu lamaran terakhir dgn email ini (null bila tidak ada);
// - recent: posisi yang dilamar 90 hari terakhir (belum dihapus, unik per posisi,
//   terbaru dulu, maks 8) — dipakai wizard utk menampilkan peringatan "kamu baru
//   saja melamar posisi X".
// Field sensitif lain tidak pernah dikirim (tidak bocor).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Regex email sederhana — konsisten dengan validasi wizard publik & submit lamaran.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rate limit per IP (NR60 — pola sama dengan /api/public/dedupe): maks 20
// permintaan per menit — cukup untuk debounce wizard, menghambat enumerasi.
const RATE_LIMIT_MAX = 20;
const RATE_WINDOW_MS = 60 * 1000;
const rateMap = new Map<string, number[]>();

// Jendela "recent" 90 hari — konsisten dengan deteksi duplikat di POST /api/applications.
const RECENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
// Jumlah maksimum posisi unik dalam "recent".
const RECENT_MAX = 8;

/** IP klien dari header proxy standar (fallback "unknown"). */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded
    ? (forwarded.split(",")[0] ?? "").trim()
    : (req.headers.get("x-real-ip") ?? "").trim();
  return ip || "unknown";
}

/** Respons "tidak ada data" — dipakai juga utk 429 agar wizard tak menampilkan error. */
function emptyResponse() {
  return { name: null, phone: null, lastAppliedAt: null, recent: [] };
}

export async function GET(req: NextRequest) {
  try {
    const emailRaw = (req.nextUrl.searchParams.get("email") ?? "").trim();
    if (!emailRaw || !EMAIL_REGEX.test(emailRaw)) {
      return NextResponse.json({ error: "Email tidak valid." }, { status: 400 });
    }

    // Rate limit per IP (NR60 — setelah validasi email, pola sama dgn dedupe).
    // 429 TIDAK membawa field error: klien memperlakukannya sebagai "tidak ada data".
    const nowMs = Date.now();
    const ipKey = `prefill:${clientIp(req)}`;
    const hits = (rateMap.get(ipKey) ?? []).filter((ts) => nowMs - ts < RATE_WINDOW_MS);
    if (hits.length >= RATE_LIMIT_MAX) {
      return NextResponse.json(emptyResponse(), { status: 429 });
    }
    hits.push(nowMs);
    rateMap.set(ipKey, hits);
    if (rateMap.size > 500) {
      for (const [key, timestamps] of rateMap) {
        if (timestamps.every((ts) => nowMs - ts >= RATE_WINDOW_MS)) rateMap.delete(key);
      }
    }

    // Satu query terbatas untuk semuanya (terbaru dulu). `contains` di SQLite
    // Prisma bersifat case-insensitive (ASCII) sehingga email huruf besar/kecil
    // tetap cocok; kecocokan EKSAK (case-insensitive) difilter di sisi aplikasi
    // di bawah agar substring (mis. "john@x.com" di "bigjohn@x.com") tidak
    // ikut terhitung — pola sama dengan /api/public/dedupe. Diambil lebih banyak
    // dari 8 (bounded) karena dedupe per posisi baru terjadi setelahnya, agar
    // 8 posisi unik terbaru benar-benar terwakili.
    const emailLower = emailRaw.toLowerCase();
    const rows = await db.application.findMany({
      where: { email: { contains: emailLower } },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        email: true,
        name: true,
        phone: true,
        deletedAt: true,
        positionId: true,
        position: { select: { title: true } },
        createdAt: true,
      },
    });

    // Filter eksak case-insensitive (anti false-positive substring).
    const matched = rows.filter(
      (row) => (row.email ?? "").trim().toLowerCase() === emailLower,
    );

    // Prefill nama/WA: dari lamaran TERAKHIR dgn email ini (perilaku lama —
    // lamaran soft-deleted tetap dipakai utk prefill).
    const latest = matched[0] ?? null;

    // Peringatan duplikat (NR60): lamaran 90 hari terakhir yang belum dihapus,
    // dideduplikasi per posisi (yang terbaru menang — baris sudah terurut desc),
    // maks 8 posisi unik. Lamaran tanpa posisi (posisi dihapus, SetNull) dilewati.
    const recentCutoff = nowMs - RECENT_WINDOW_MS;
    const seenPositions = new Set<string>();
    const recent: { positionId: string; title: string; appliedAt: string }[] = [];
    for (const row of matched) {
      if (!row.positionId) continue; // posisi sudah tidak ada — tak relevan utk peringatan
      if (row.createdAt.getTime() < recentCutoff) break; // desc → sisanya lebih tua
      if (row.deletedAt !== null) continue; // soft-deleted tidak dihitung
      if (seenPositions.has(row.positionId)) continue;
      seenPositions.add(row.positionId);
      recent.push({
        positionId: row.positionId,
        title: row.position?.title ?? row.positionId,
        appliedAt: row.createdAt.toISOString(),
      });
      if (recent.length >= RECENT_MAX) break;
    }

    return NextResponse.json({
      name: latest?.name ?? null,
      phone: latest?.phone ?? null,
      lastAppliedAt: latest ? latest.createdAt.toISOString() : null,
      recent,
    });
  } catch (error) {
    console.error("[GET /api/public/apply-prefill]", error);
    return NextResponse.json(
      { error: "Gagal memuat data. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
