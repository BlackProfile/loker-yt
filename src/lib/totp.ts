// Helper 2FA TOTP (SERVER-ONLY — jangan diimpor dari komponen klien).
// Memakai paket otpauth: secret base32 acak (20 byte) + TOTP 6 digit / 30 detik (SHA-1).
import { Secret, TOTP } from "otpauth";

export const TOTP_ISSUER = "Lumina Studio";

/** Buat instance TOTP dari secret base32 (issuer/label hanya untuk URI, bukan perhitungan kode). */
function buildTotp(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: TOTP_ISSUER,
    label,
    secret: Secret.fromBase32(secretBase32),
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

/** Generate secret baru + URI otpauth:// untuk QR aplikasi autentikator. */
export function generateTotpSecret(label: string): { secret: string; uri: string } {
  const secret = new Secret({ size: 20 }).base32;
  return { secret, uri: buildTotp(secret, label).toString() };
}

/** Verifikasi kode TOTP 6 digit (toleransi +/- 30 detik). True hanya bila delta tidak null. */
export function verifyTotpCode(secretBase32: string, code: string): boolean {
  const clean = (code ?? "").replace(/\D/g, "");
  if (clean.length !== 6 || !secretBase32) return false;
  try {
    return buildTotp(secretBase32, "").validate({ token: clean, window: 1 }) !== null;
  } catch {
    return false;
  }
}
