// NR58 (A1) — ekstraksi IP klien dari header proxy standar.
// Dipakai bersama oleh rate limiter di rute publik. Logika sama dengan
// routeClientIp() di /api/applications (NR45) — dipisah agar semua rute
// publik memakai definisi yang sama tanpa duplikasi.
import type { NextRequest } from "next/server";

export function routeClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return (forwarded.split(",")[0] ?? "").trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
