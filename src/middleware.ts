// NR41-SEC-B (F5) — middleware security headers untuk SEMUA response.
// - X-Content-Type-Options: nosniff
// - Referrer-Policy: strict-origin-when-cross-origin
// - Permissions-Policy: camera/microphone/geolocation dikunci (wizard intro memakai
//   unggahan file, TIDAK ada MediaRecorder/getUserMedia di halaman publik).
// - CSP longgar yang aman untuk Next.js (unsafe-inline/unsafe-eval untuk script & style).
// - X-Frame-Options SAMEORIGIN, KECUALI embed widget (?embed=1) dan gambar OG (/api/og)
//   → tanpa XFO + CSP frame-ancestors * agar iframe eksternal tetap jalan.
// - HSTS hanya bila request masuk via https (x-forwarded-proto).
import { NextRequest, NextResponse } from "next/server";

// Catatan: wizard perkenalan memakai <input type="file"> (unggah audio/video),
// bukan perekaman langsung — mikrofon/kamera aman dikunci di semua path.
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";

const CSP_BASE = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self'",
];

export function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Header dasar untuk semua response.
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", PERMISSIONS_POLICY);

  // Embed widget (?embed=1) & gambar OpenGraph boleh di-iframe eksternal.
  const isEmbed = req.nextUrl.searchParams.get("embed") === "1";
  const isOgImage = req.nextUrl.pathname === "/api/og" || req.nextUrl.pathname.startsWith("/api/og/");
  const isEmbeddable = isEmbed || isOgImage;

  const csp = [
    ...CSP_BASE,
    isEmbeddable ? "frame-ancestors *" : "frame-ancestors 'self'",
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);

  if (!isEmbeddable) {
    res.headers.set("X-Frame-Options", "SAMEORIGIN");
  }

  // HSTS hanya bila trafik benar-benar https (di belakang proxy).
  if (req.headers.get("x-forwarded-proto") === "https") {
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return res;
}

// Lewati aset statis Next.js & favicon (tidak butuh header keamanan dinamis).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"],
};
