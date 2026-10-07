// Autentikasi admin multi-user berbasis cookie HMAC (SERVER-ONLY — jangan diimpor dari komponen klien).
// Format cookie "admin_session": `${userId}.${expMs}.${hmacSHA256(`${userId}.${expMs}`, secret)}` (hex).
// NR41-SEC-B (F6): sesi sliding — durasi 7 hari default, 30 hari bila "ingat saya" (rememberMe).
//   Konstanta SESSION_MAX_AGE_* dipertahankan untuk kompatibilitas pemanggil lama.
// Sesi hanya valid jika AdminUser masih ada dan isActive.
// Task 27: tiap login juga mencatat row SessionToken (per perangkat) — mendukung daftar
// sesi aktif + logout paksa per perangkat. Row lama (pra-Task 27) tetap diizinkan.
// NR41-SEC-B (F6): idle timeout — sesi tanpa aktivitas melebihi N menit (Setting
// "session_idle_minutes", default 720; 0 = nonaktif) dicabut otomatis.
// NR41-SEC-B (F4): password hashing bcrypt (cost 10). Hash lama SHA-256 hex tetap
// dikenali (kompatibilitas) dan di-upgrade ke bcrypt saat login sukses.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ROLES, type AdminSession, type Role } from "@/lib/types";

export const ADMIN_COOKIE_NAME = "admin_session";
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari (default, kompatibilitas)
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 hari (untuk cookie maxAge)
export const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari (ingat saya)
export const REMEMBER_ME_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 hari

// F4 — cost factor bcrypt (10 sesuai kontrak gelombang)
const BCRYPT_COST = 10;

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

/** Token sesi untuk user tertentu — durasi mengikuti maxAgeMs (7 atau 30 hari). */
export function createSessionToken(userId: string, maxAgeMs: number = SESSION_MAX_AGE_MS): string {
  const expMs = (Date.now() + maxAgeMs).toString();
  const payload = `${userId}.${expMs}`;
  return `${payload}.${sign(payload)}`;
}

/** Kembalikan userId jika token valid (tanda tangan cocok & belum kedaluwarsa), selain itu null. */
export function verifySessionToken(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expMs, signature] = parts;
  if (!userId || !/^\d+$/.test(expMs)) return null;
  if (!safeEqual(signature, sign(`${userId}.${expMs}`))) return null;
  if (Number(expMs) <= Date.now()) return null;
  return userId;
}

/**
 * Set cookie sesi admin pada response + catat row SessionToken (per perangkat).
 * F6 — opts.rememberMe: true → cookie & exp payload 30 hari, selain itu 7 hari.
 */
export async function setSessionCookie(
  res: NextResponse,
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
  opts?: { rememberMe?: boolean },
): Promise<void> {
  const maxAgeMs = opts?.rememberMe ? REMEMBER_ME_MAX_AGE_MS : SESSION_MAX_AGE_MS;
  const maxAgeSec = opts?.rememberMe ? REMEMBER_ME_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;
  const token = createSessionToken(userId, maxAgeMs);
  if (meta) {
    await registerSessionToken(userId, token, meta);
  }
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSec,
  });
}

/** Hapus cookie sesi admin pada response. */
export async function clearSessionCookie(res: NextResponse): Promise<void> {
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

function roleOf(value: string): Role | null {
  return (ROLES as string[]).includes(value) ? (value as Role) : null;
}

/** Ambil sesi admin aktif dari cookie. Null jika tidak login, token invalid,
 *  sesi dicabut per perangkat, idle timeout, atau user tidak aktif. */
export async function getSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  const userId = verifySessionToken(token);
  if (!userId) return null;
  // Task 27: bila verifikasi krypto lolos, cek apakah sesi perangkat ini dicabut.
  if (token && (await checkSessionToken(token))) return null;
  const user = await db.adminUser.findUnique({ where: { id: userId } });
  if (!user || !user.isActive) return null;
  const role = roleOf(user.role);
  if (!role) return null;
  return { id: user.id, name: user.name, email: user.email, role };
}

/**
 * Sesi admin jika role-nya termasuk daftar `roles`; null jika tidak login atau role tidak sesuai.
 * Pemanggil disarankan membedakan 401 (belum login) dan 403 (role kurang) via getSession().
 */
export async function requireRole(roles: Role[]): Promise<AdminSession | null> {
  const session = await getSession();
  if (!session || !roles.includes(session.role)) return null;
  return session;
}

/** Cek versi lama (v1): true jika ada sesi admin valid. */
export async function requireAdmin(): Promise<boolean> {
  return (await getSession()) !== null;
}

/* ------------------------- Password hashing (F4) ------------------------- */

/**
 * Hash password — NR41-SEC-B: bcrypt cost 10 (format "$2...").
 * Fungsi sinkron agar seluruh pemanggil lama (seed, undangan admin, ganti password,
 * buat user) otomatis memakai bcrypt tanpa perubahan kode.
 */
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

/** True bila hash berformat bcrypt ("$2a$", "$2b$", "$2y$", "$2x$"). */
export function isBcryptHash(hash: string): boolean {
  return /^\$2[abxy]\$/.test(hash);
}

/** True bila hash berformat legacy SHA-256 hex-64. */
export function isLegacySha256Hash(hash: string): boolean {
  return /^[0-9a-f]{64}$/i.test(hash);
}

/** SHA-256 hex lama — dipakai hanya untuk memverifikasi hash legacy sebelum upgrade. */
function legacySha256(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/**
 * Bandingkan password polos dengan hash tersimpan.
 * - Hash bcrypt ("$2...") → bcrypt.compare.
 * - Hash legacy SHA-256 hex-64 → bandingkan sha256 lama (hasil=true berarti perlu
 *   upgrade — panggil upgradePasswordHashIfNeeded setelah login sukses).
 * - Format tidak dikenal → false.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (isBcryptHash(hash)) {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }
  if (isLegacySha256Hash(hash)) {
    return safeEqual(legacySha256(plain), hash.toLowerCase());
  }
  return false;
}

/**
 * Verifikasi password + penanda perlu upgrade (hash legacy SHA-256 masih memakai
 * plaintext-verifikasi cepat tanpa salt). Dipakai route login & ganti password.
 */
export async function verifyPasswordWithMeta(
  plain: string,
  hash: string,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  const ok = await verifyPassword(plain, hash);
  return { ok, needsUpgrade: ok && isLegacySha256Hash(hash) };
}

/**
 * F4 — upgrade transparan: bila hash lama (SHA-256 hex) cocok dengan plaintext,
 * rehash dengan bcrypt dan simpan ke AdminUser. Dipanggil fire-and-forget pada
 * login sukses. Tidak pernah melempar error.
 */
export async function upgradePasswordHashIfNeeded(
  userId: string,
  plain: string,
  oldHash: string,
): Promise<void> {
  try {
    if (!isLegacySha256Hash(oldHash)) return;
    if (!safeEqual(legacySha256(plain), oldHash.toLowerCase())) return;
    const newHash = hashPassword(plain);
    await db.adminUser.update({ where: { id: userId }, data: { passwordHash: newHash } });
  } catch (err) {
    console.error("[server-auth] gagal upgrade hash password ke bcrypt", err);
  }
}

/** SHA-256 hex dari nilai cookie sesi — dipakai sebagai tokenHash pada SessionToken. */
export function hashToken(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/* ----------------------- SessionToken (per perangkat) ----------------------- */

// Throttle tulis lastSeenAt: maksimal sekali per 5 menit per token (in-memory).
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
const lastSeenWrites = new Map<string, number>();

// F6 — cache Setting "session_idle_minutes" in-memory 5 menit (hindari query tiap request).
const IDLE_SETTING_CACHE_MS = 5 * 60 * 1000;
let idleMinutesCache: { value: number; at: number } | null = null;

/** Ambil ambang idle timeout (menit) dari Setting — default 720; 0 = nonaktif. */
async function getIdleTimeoutMinutes(): Promise<number> {
  const now = Date.now();
  if (idleMinutesCache && now - idleMinutesCache.at < IDLE_SETTING_CACHE_MS) {
    return idleMinutesCache.value;
  }
  let value = 720;
  try {
    const row = await db.setting.findUnique({ where: { key: "session_idle_minutes" } });
    if (row) {
      const parsed: unknown = JSON.parse(row.value);
      const num = typeof parsed === "number" ? parsed : Number(parsed);
      if (Number.isFinite(num) && num >= 0) value = Math.floor(num);
    }
  } catch {
    // Setting tidak ada / JSON rusak → pakai default 720 menit.
  }
  idleMinutesCache = { value, at: now };
  return value;
}

/**
 * Cek pembatalan sesi per perangkat + perbarui lastSeenAt (throttled).
 * Return true bila sesi telah dicabut (revokedAt != null ATAU idle timeout).
 * F6 — idle timeout: lastSeenAt lebih lama dari N menit (Setting
 * "session_idle_minutes", default 720; 0 = nonaktif) → sesi dicabut.
 * Row SessionToken yang tidak ada dianggap sesi lama yang sah (kompatibilitas).
 */
async function checkSessionToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  try {
    const row = await db.sessionToken.findUnique({ where: { tokenHash } });
    if (!row) return false; // sesi lama tanpa row — izinkan
    if (row.revokedAt) return true;

    const now = Date.now();
    // Idle timeout: tanpa aktivitas lebih lama dari ambang → cabut sesi.
    const idleMinutes = await getIdleTimeoutMinutes();
    if (idleMinutes > 0) {
      const idleMs = now - row.lastSeenAt.getTime();
      if (idleMs > idleMinutes * 60 * 1000) {
        await db.sessionToken
          .update({ where: { tokenHash }, data: { revokedAt: new Date() } })
          .catch(() => undefined);
        lastSeenWrites.delete(tokenHash);
        return true; // sesi dicabut (idle timeout)
      }
    }

    const last = lastSeenWrites.get(tokenHash) ?? row.lastSeenAt.getTime();
    if (now - last >= LAST_SEEN_THROTTLE_MS) {
      lastSeenWrites.set(tokenHash, now);
      // Tulis tanpa menunggu — kegagalan tidak mempengaruhi validitas sesi.
      void db.sessionToken
        .update({ where: { tokenHash }, data: { lastSeenAt: new Date() } })
        .catch(() => {
          lastSeenWrites.delete(tokenHash);
        });
    }
    return false;
  } catch {
    // Gagal membaca SessionToken tidak boleh menggagalkan login yang valid.
    return false;
  }
}

/** Pencatatan sesi per perangkat setelah login sukses. Gagal write tidak menggagalkan login. */
async function registerSessionToken(
  userId: string,
  token: string,
  meta: { ip?: string | null; userAgent?: string | null },
): Promise<void> {
  try {
    await db.sessionToken.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        ip: meta.ip?.slice(0, 50) ?? null,
        userAgent: meta.userAgent?.slice(0, 200) ?? null,
      },
    });
  } catch (err) {
    console.error("[server-auth] gagal mencatat SessionToken", err);
  }
}

/* --------------------- Setup 2FA tertunda (F4 / F8) --------------------- */

export const PENDING_2FA_TTL_MS = 10 * 60 * 1000; // token setup 2FA berlaku 10 menit

export type Pending2FASetup = { token: string; exp: number };

function pending2faKey(userId: string): string {
  return `pending_2fa_setup:${userId}`;
}

/** Simpan token setup 2FA sementara (10 menit) untuk OWNER yang belum mengaktifkan TOTP. */
export async function storePending2FASetup(userId: string): Promise<string> {
  const token = randomBytes(16).toString("hex"); // 32 karakter hex
  const payload: Pending2FASetup = { token, exp: Date.now() + PENDING_2FA_TTL_MS };
  await db.setting.upsert({
    where: { key: pending2faKey(userId) },
    update: { value: JSON.stringify(payload) },
    create: { key: pending2faKey(userId), value: JSON.stringify(payload) },
  });
  return token;
}

/** Verifikasi & konsumsi token setup 2FA. Token kedaluwarsa/salah → null. */
export async function consumePending2FASetup(
  userId: string,
  token: string,
): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key: pending2faKey(userId) } });
    if (!row) return false;
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const data = parsed as Record<string, unknown>;
    if (typeof data.token !== "string" || typeof data.exp !== "number") return false;
    if (data.token !== token || data.exp <= Date.now()) return false;
    await db.setting.delete({ where: { key: pending2faKey(userId) } }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
