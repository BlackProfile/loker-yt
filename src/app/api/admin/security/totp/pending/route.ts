// NR-41 F8 — alur wajib 2FA untuk OWNER yang belum mengaktifkan TOTP (SERVER-ONLY).
// Login OWNER tanpa TOTP tidak langsung mendapat sesi penuh; login route
// mengembalikan {ok:false, mustSetup2FA:true, setupToken} (token 32-hex, 10 menit,
// disimpan via storePending2FASetup() di src/lib/server-auth.ts).
// Endpoint ini menuntaskan pemasangan TOTP tanpa sesi penuh:
//   POST {setupToken}          → bootstrap: buat secret pending + QR + otpauth URL
//   POST {setupToken, code}    → verifikasi kode, aktifkan TOTP, BERIKAN SESI PENUH
// Upaya dicatat ke LoginAudit (reason: 2FA_PENDING_SETUP / 2FA_PENDING_ENABLED).
import QRCode from "qrcode";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  consumePending2FASetup,
  setSessionCookie,
} from "@/lib/server-auth";
import { generateTotpSecret, verifyTotpCode } from "@/lib/totp";

export const dynamic = "force-dynamic";

const PENDING_SECRET_TTL_MS = 10 * 60 * 1000;

type PendingSecret = { secret: string; exp: number };

function pendingSecretKey(userId: string): string {
  return `pending_2fa_secret:${userId}`;
}

async function writePendingSecret(userId: string, secret: string): Promise<void> {
  const payload: PendingSecret = { secret, exp: Date.now() + PENDING_SECRET_TTL_MS };
  await db.setting.upsert({
    where: { key: pendingSecretKey(userId) },
    create: { key: pendingSecretKey(userId), value: JSON.stringify(payload) },
    update: { value: JSON.stringify(payload) },
  });
}

async function readPendingSecret(userId: string): Promise<string | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: pendingSecretKey(userId) } });
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const data = parsed as Record<string, unknown>;
    if (typeof data.secret !== "string" || typeof data.exp !== "number") return null;
    if (data.exp <= Date.now()) return null;
    return data.secret;
  } catch {
    return null;
  }
}

async function deletePendingSecret(userId: string): Promise<void> {
  try {
    await db.setting.delete({ where: { key: pendingSecretKey(userId) } });
  } catch {
    // baris tidak ada — abaikan
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
    }
    const rec = body as Record<string, unknown>;
    const setupToken = typeof rec.setupToken === "string" ? rec.setupToken.trim() : "";
    const code = typeof rec.code === "string" ? rec.code.trim() : "";
    if (!/^[a-f0-9]{32}$/.test(setupToken)) {
      return NextResponse.json(
        { error: "Sesi pemasangan 2FA tidak valid. Login ulang." },
        { status: 401 },
      );
    }

    // Temukan pemilik token: kandidat OWNER aktif berjumlah kecil — coba konsumsi.
    // consumePending2FASetup menghapus baris saat cocok (token sekali pakai),
    // jadi kita uji per user dengan token baca-tulis yang aman untuk alur ini.
    const owners = await db.adminUser.findMany({
      where: { role: "OWNER", isActive: true },
      select: { id: true, email: true },
    });
    let userId: string | null = null;
    for (const owner of owners) {
      const row = await db.setting.findUnique({ where: { key: `pending_2fa_setup:${owner.id}` } });
      if (!row) continue;
      try {
        const parsed: unknown = JSON.parse(row.value);
        if (
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          (parsed as Record<string, unknown>).token === setupToken
        ) {
          userId = owner.id;
          break;
        }
      } catch {
        // baris rusak — lanjut kandidat berikutnya
      }
    }
    if (!userId || !(await consumePending2FASetup(userId, setupToken))) {
      return NextResponse.json(
        { error: "Sesi pemasangan 2FA kedaluwarsa. Login ulang." },
        { status: 401 },
      );
    }

    const user = await db.adminUser.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.role !== "OWNER" || user.totpEnabled) {
      return NextResponse.json(
        { error: "Pemasangan 2FA tidak berlaku untuk akun ini." },
        { status: 400 },
      );
    }

    // TAHAP 1 — bootstrap: buat secret pending + QR (belum aktif, belum ada sesi).
    if (!code) {
      const { secret, uri } = generateTotpSecret(user.email);
      await writePendingSecret(user.id, secret);
      const qrDataUrl = await QRCode.toDataURL(uri);
      await db.loginAudit
        .create({
          data: { email: user.email, userId: user.id, success: true, reason: "2FA_PENDING_SETUP" },
        })
        .catch(() => undefined);
      return NextResponse.json({
        ok: true,
        stage: "SETUP",
        email: user.email,
        uri,
        secret,
        qrDataUrl,
      });
    }

    // TAHAP 2 — verifikasi kode, aktifkan TOTP, berikan sesi penuh.
    const secret = await readPendingSecret(user.id);
    if (!secret || !verifyTotpCode(secret, code)) {
      return NextResponse.json(
        { error: "Kode 2FA tidak valid. Coba lagi." },
        { status: 400 },
      );
    }
    await db.adminUser.update({
      where: { id: user.id },
      data: { totpSecret: secret, totpEnabled: true },
    });
    await deletePendingSecret(user.id);
    await db.loginAudit
      .create({
        data: { email: user.email, userId: user.id, success: true, reason: "2FA_PENDING_ENABLED" },
      })
      .catch(() => undefined);

    const response = NextResponse.json({ ok: true, totpEnabled: true });
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const userAgent = req.headers.get("user-agent");
    await setSessionCookie(response, user.id, { ip, userAgent });
    return response;
  } catch (error) {
    console.error("[POST /api/admin/security/totp/pending]", error);
    return NextResponse.json(
      { error: "Gagal memproses pemasangan 2FA. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
