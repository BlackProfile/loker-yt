// Autentikasi admin multi-user berbasis cookie HMAC (SERVER-ONLY — jangan diimpor dari komponen klien).
// Format cookie "admin_session": `${userId}.${expMs}.${hmacSHA256(`${userId}.${expMs}`, secret)}` (hex).
// Kedaluwarsa 7 hari. Sesi hanya valid jika AdminUser masih ada dan isActive.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ROLES, type AdminSession, type Role } from "@/lib/types";

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

/** Token sesi untuk user tertentu, kedaluwarsa 7 hari. */
export function createSessionToken(userId: string): string {
  const expMs = (Date.now() + SESSION_MAX_AGE_MS).toString();
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

/** Set cookie sesi admin pada response. */
export async function setSessionCookie(res: NextResponse, userId: string): Promise<void> {
  res.cookies.set({
    name: ADMIN_COOKIE_NAME,
    value: createSessionToken(userId),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
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

/** Ambil sesi admin aktif dari cookie. Null jika tidak login, token invalid, atau user tidak aktif. */
export async function getSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const userId = verifySessionToken(cookieStore.get(ADMIN_COOKIE_NAME)?.value);
  if (!userId) return null;
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

/** Hash password dengan SHA-256 (hex). */
export function hashPassword(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

/** Bandingkan password polos dengan hash SHA-256 (hex). */
export function verifyPassword(plain: string, hash: string): boolean {
  return safeEqual(hashPassword(plain), hash);
}
