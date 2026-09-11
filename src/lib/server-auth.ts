// Autentikasi admin berbasis cookie HMAC (SERVER-ONLY — jangan diimpor dari komponen klien).
// Nilai cookie: `${expiresAtMs}.${hmacSHA256(expiresAtMs, secret)}` (hex).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE_NAME = "admin_session";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 hari (untuk cookie maxAge)

function getSecret(): string {
  return process.env.ADMIN_SECRET ?? "lumina-studio-secret-key";
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

/** Perbandingan string yang tahan timing attack. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Token sesi baru, kedaluwarsa 7 hari. */
export async function createSessionToken(): Promise<string> {
  const expiresAtMs = (Date.now() + SESSION_MAX_AGE_MS).toString();
  return `${expiresAtMs}.${sign(expiresAtMs)}`;
}

/** True jika token valid (tanda tangan cocok dan belum kedaluwarsa). */
export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const separatorIndex = token.indexOf(".");
  if (separatorIndex <= 0) return false;
  const expiresAtMs = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  if (!/^\d+$/.test(expiresAtMs)) return false;
  if (!safeEqual(signature, sign(expiresAtMs))) return false;
  return Number(expiresAtMs) > Date.now();
}

/** Ambil token sesi admin dari cookie request. */
export async function getSessionTokenFromRequest(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_COOKIE_NAME)?.value;
}

/** True jika request berasal dari admin yang sedang login. */
export async function requireAdmin(): Promise<boolean> {
  const token = await getSessionTokenFromRequest();
  return verifySessionToken(token);
}

/** Hash password dengan SHA-256 (hex). */
export function hashPassword(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** Bandingkan password polos dengan hash SHA-256 (hex). */
export function verifyPassword(plain: string, hash: string): boolean {
  return safeEqual(hashPassword(plain), hash);
}
