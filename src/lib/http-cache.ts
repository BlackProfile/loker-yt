// NR-41 E2 — HTTP caching helper (SERVER-ONLY): ETag + Cache-Control untuk
// endpoint GET publik yang berat dibaca ulang. Serialisasi JSON stabil via
// JSON.stringify lalu hash SHA-1 → ETag lemah `W/"hash"`. Bila header
// If-None-Match klien cocok, balas 304 tanpa body (hemat bandwidth).
import { createHash } from "node:crypto";

/** Cache-Control default: cache privat singkat + stale-while-revalidate. */
export const DEFAULT_CACHE_CONTROL = "private, max-age=15, stale-while-revalidate=60";

/** Cek apakah If-None-Match klien cocok dengan ETag server (dukung daftar & *). */
function ifNoneMatchMatches(headerValue: string | null, etag: string): boolean {
  if (!headerValue) return false;
  const trimmed = headerValue.trim();
  if (trimmed === "*") return true;
  // Daftar ETag dipisah koma (klien boleh menyimpan beberapa revisi).
  return trimmed.split(",").some((candidate) => candidate.trim() === etag);
}

/**
 * Bungkus data JSON dengan ETag + Cache-Control.
 * - Cocok If-None-Match → Response 304 (headers ETag + Cache-Control, tanpa body).
 * - Tidak cocok → Response 200 JSON + header ETag + Cache-Control.
 * Kontrak respons (bentuk body) TIDAK berubah — hanya header cache yang ditambah.
 */
export function etagJson(
  req: Request,
  data: unknown,
  cacheControl: string = DEFAULT_CACHE_CONTROL,
): Response {
  const body = JSON.stringify(data);
  const etag = `W/"${createHash("sha1").update(body).digest("hex")}"`;
  const headers: Record<string, string> = {
    ETag: etag,
    "Cache-Control": cacheControl,
  };

  if (ifNoneMatchMatches(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, {
    status: 200,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8" },
  });
}
