// Gerbang keamanan bersama untuk endpoint publik pelacakan lamaran
// (/api/public/track, /api/public/track-auth, /api/public/withdraw):
// - Throttle sederhana per IP+scope (interval minimum antar permintaan).
// - Lockout login: 5x gagal cocokkan email+kode dalam 15 menit -> dikunci 15 menit.
// Semua state hidup di memori proses (kebijakan caching lokal; hilang saat restart,
// cukup untuk memperlambat brute force tanpa infrastruktur tambahan).
import type { NextRequest } from "next/server";

/** Batas percobaan login gagal sebelum terkunci. */
const FAIL_LIMIT = 5;
/** Jendela kegagalan & durasi kunci (15 menit). */
const WINDOW_MS = 15 * 60 * 1000;

type FailRecord = { count: number; windowStart: number; lockedUntil: number };

const failMap = new Map<string, FailRecord>();
const throttleMap = new Map<string, number>();

/** Kunci klien dari header proxy (fallback "unknown"). */
export function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return (forwarded.split(",")[0] ?? "").trim();
  return (req.headers.get("x-real-ip") ?? "").trim() || "unknown";
}

function prune(now: number): void {
  if (failMap.size > 1000) {
    for (const [key, rec] of failMap) {
      if (now - rec.windowStart > WINDOW_MS && now > rec.lockedUntil) failMap.delete(key);
    }
  }
  if (throttleMap.size > 2000) {
    for (const [key, ts] of throttleMap) {
      if (now - ts > 60_000) throttleMap.delete(key);
    }
  }
}

/**
 * Throttle per kunci scope (mis. "track:1.2.3.4"): true = harus dilewati
 * (terlalu cepat), false = boleh lanjut (dan waktu terakhir diperbarui).
 */
export function isThrottled(scope: string, minIntervalMs: number): boolean {
  const now = Date.now();
  prune(now);
  const last = throttleMap.get(scope) ?? 0;
  if (now - last < minIntervalMs) return true;
  throttleMap.set(scope, now);
  return false;
}

/** True bila kunci sedang terkunci akibat terlalu banyak kegagalan login. */
export function isLockedOut(key: string): boolean {
  const rec = failMap.get(key);
  return !!rec && rec.lockedUntil > Date.now();
}

/** Sisa detik kunci (untuk pesan "coba lagi dalam X menit"), 0 bila tidak terkunci. */
export function lockRemainingSec(key: string): number {
  const rec = failMap.get(key);
  if (!rec || rec.lockedUntil <= Date.now()) return 0;
  return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
}

/** Catat satu kegagalan pencocokan email+kode; kunci saat mencapai batas. */
export function recordAuthFail(key: string): void {
  const now = Date.now();
  const rec = failMap.get(key);
  if (!rec || now - rec.windowStart > WINDOW_MS) {
    failMap.set(key, { count: 1, windowStart: now, lockedUntil: 0 });
    return;
  }
  rec.count += 1;
  if (rec.count >= FAIL_LIMIT) {
    rec.lockedUntil = now + WINDOW_MS;
    rec.count = 0;
    rec.windowStart = now;
  }
}

/** Hapus riwayat kegagalan (dipanggil saat login sukses). */
export function clearAuthFails(key: string): void {
  failMap.delete(key);
}
