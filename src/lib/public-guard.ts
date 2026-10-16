// NR58 (A1) — gerbang rate limit untuk rute publik.
// Tujuan: saat traffic naik (bot, scraper, atau pengguna berat), rute publik
// tidak bisa membanjiri DB. Memakai rateLimit() sliding window dari
// load-metrics (state memori proses, pola NR45 yang sama dengan submit
// lamaran). Kegagalan limitir = izinkan (jangan pernah menggagalkan alur).
// Respons 429 dirancang ramah: pesan Indonesia tenang + Retry-After.
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/load-metrics";
import { routeClientIp } from "@/lib/client-ip";

/** Limiter umum rute publik (bisa dinilai ulang setelah pengamatan produksi). */
export const PUBLIC_RATE_LIMITS = {
  /** GET publik ringan (landing content, daftar posisi). */
  readPerMinute: 120,
  /** Cek status lamaran (POST kode pelacakan). */
  trackPer5Min: 20,
  /** Simpan draft wizard. */
  draftPer10Min: 30,
  /** Unggah berkas draft (mahal — bandwidth + disk). */
  draftFilePer10Min: 20,
} as const;

/**
 * Cek rate limit untuk satu permintaan publik.
 * @returns null bila DIIZINKAN melanjutkan; Response 429 bila DITOLAK.
 */
export function publicRateGuard(
  req: NextRequest,
  scope: string,
  max: number,
  windowMs: number,
): Response | null {
  const ip = routeClientIp(req);
  const verdict = rateLimit(`${scope}:${ip}`, max, windowMs);
  if (verdict.allowed) return null;
  return NextResponse.json(
    {
      error:
        "Server sedang ramai. Coba lagi beberapa saat — data Anda aman, tidak ada yang hilang.",
      retryAfterSec: verdict.retryAfterSec,
    },
    {
      status: 429,
      headers: { "Retry-After": String(verdict.retryAfterSec) },
    },
  );
}
