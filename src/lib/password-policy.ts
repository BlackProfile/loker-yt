// SERVER-ONLY — NR46: kebijakan sandi (Paket B) — Setting "password_policy".
// Dipakai oleh: buat user langsung, reset sandi OWNER, ganti sandi sendiri,
// dan terima undangan. Validasi TIDAK PERNAH melempar (gagal baca = bawaan).
import { db } from "@/lib/db";

export type PasswordPolicy = {
  minLength: number; // 8..72 (bawaan 8)
  requireChangeFirstLogin: boolean; // akun buatan OWNER wajib ganti sandi saat pertama login
  rotationDays: number; // 0 = nonaktif; 30/60/90/180 = peringatan rotasi
  blockWeak: boolean; // tolak sandi umum & pola lemah
};

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireChangeFirstLogin: false,
  rotationDays: 0,
  blockWeak: true,
};

const SETTING_KEY = "password_policy";

/** Daftar sandi umum yang wajib ditolak (subset 10k list — cukup untuk menangkap kasus jelas). */
const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890",
  "qwerty123", "qwertyuiop", "12345678a", "abc12345", "iloveyou", "admin123", "admin1234",
  "lumina123", "lumina1234", "letmein1", "welcome1", "welcome123", "monkey123", "dragon123",
  "sunshine1", "princess1", "football1", "baseball1", "master123", "google123", "zaq12wsx",
]);

export async function readPasswordPolicy(): Promise<PasswordPolicy> {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULT_PASSWORD_POLICY };
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_PASSWORD_POLICY };
    }
    const raw = parsed as Record<string, unknown>;
    const minLengthRaw = Number(raw.minLength);
    const rotationRaw = Number(raw.rotationDays);
    return {
      minLength: Number.isFinite(minLengthRaw)
        ? Math.min(72, Math.max(8, Math.round(minLengthRaw)))
        : DEFAULT_PASSWORD_POLICY.minLength,
      requireChangeFirstLogin: raw.requireChangeFirstLogin === true,
      rotationDays: Number.isFinite(rotationRaw) && [0, 30, 60, 90, 180].includes(rotationRaw)
        ? rotationRaw
        : DEFAULT_PASSWORD_POLICY.rotationDays,
      blockWeak: raw.blockWeak !== false, // bawaan aktif
    };
  } catch {
    return { ...DEFAULT_PASSWORD_POLICY };
  }
}

export async function writePasswordPolicy(policy: PasswordPolicy): Promise<PasswordPolicy> {
  const clean: PasswordPolicy = {
    minLength: Math.min(72, Math.max(8, Math.round(policy.minLength) || DEFAULT_PASSWORD_POLICY.minLength)),
    requireChangeFirstLogin: policy.requireChangeFirstLogin === true,
    rotationDays: [0, 30, 60, 90, 180].includes(policy.rotationDays)
      ? policy.rotationDays
      : DEFAULT_PASSWORD_POLICY.rotationDays,
    blockWeak: policy.blockWeak !== false,
  };
  const value = JSON.stringify(clean);
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  return clean;
}

/**
 * Validasi sandi terhadap kebijakan. Selalu mengembalikan daftar alasan (kosong = lolos).
 * `email` opsional — sandi yang memuat bagian lokal email ditolak.
 */
export function validatePassword(
  password: string,
  policy: PasswordPolicy,
  email?: string | null,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const pw = password ?? "";
  if (pw.length < policy.minLength) {
    reasons.push(`Minimal ${policy.minLength} karakter (saat ini ${pw.length}).`);
  }
  if (pw.length > 72) {
    reasons.push("Maksimal 72 karakter.");
  }
  if (policy.blockWeak) {
    const lower = pw.toLowerCase();
    if (WEAK_PASSWORDS.has(lower)) {
      reasons.push("Sandi termasuk daftar sandi yang mudah ditebak.");
    }
    if (/^(.)\1+$/.test(pw) && pw.length > 0) {
      reasons.push("Sandi tidak boleh semua karakter sama.");
    }
    if (/^(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/.test(lower)) {
      reasons.push("Sandi tidak boleh pola berurutan yang mudah ditebak.");
    }
    const local = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
    if (local.length >= 3 && lower.includes(local)) {
      reasons.push("Sandi tidak boleh memuat bagian awal email Anda.");
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Ringkasan kebijakan untuk ditampilkan di UI (bahasa Indonesia). */
export function describePasswordPolicy(policy: PasswordPolicy): string[] {
  const lines = [`Minimal ${policy.minLength} karakter.`];
  if (policy.blockWeak) lines.push("Sandi umum dan pola mudah ditebak ditolak.");
  if (policy.requireChangeFirstLogin) lines.push("Akun baru wajib mengganti sandi pada login pertama.");
  if (policy.rotationDays > 0) lines.push(`Disarankan mengganti sandi setiap ${policy.rotationDays} hari.`);
  return lines;
}

/** Umur sandi dalam hari (null bila tidak tercatat). */
export function passwordAgeDays(lastPasswordChangedAt: Date | null): number | null {
  if (!lastPasswordChangedAt) return null;
  return Math.floor((Date.now() - lastPasswordChangedAt.getTime()) / (24 * 60 * 60_000));
}
