// NR-41 F8 — alur wajib 2FA untuk OWNER yang belum mengaktifkan TOTP (SERVER-ONLY).
// Login OWNER tanpa TOTP tidak lagi langsung mendapat sesi penuh; login route
// mengembalikan {ok:false, mustSetup2FA:true, setupToken} (token pendek 10 menit,
// disimpan login route di Setting `pending_2fa_setup:<userId>`).
// Endpoint ini menuntaskan pemasangan TOTP tanpa sesi penuh:
//   POST {setupToken}          → bootstrap: buat secret pending + QR + otpauth URL
//   POST {setupToken, code}    → verifikasi kode, aktifkan TOTP, BERIKAN SESI PENUH
// Semua upaya dicatat ke LoginAudit (reason: 2FA_PENDING_SETUP / 2FA_PENDING_ENABLED).
import QRCode from "qrcode";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setSessionCookie } from "@/lib/server-auth";
import { generateTotpSecret, verifyTotpCode } from "@/lib/totp";

export const dynamic = "force-dynamic";

const PENDING_TTL_MS = 10 * 60 * 1000;

type PendingSetup = { userId: string; token: string; exp: number };

async function readPendingSetup(value: string): Promise<PendingSetup | null> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.token !== "string" || typeof rec.exp !== "number") return null;
    if (rec.exp <= Date.now()) return null;
    return { userId: "", token: rec.token, exp: rec.exp };
  } catch {
    return null;
  }
}

async function writePendingSecret(userId: string, secret: string): Promise<void> {
  const value = JSON.stringify({ secret, exp: Date.now() + PENDING_TTL_MS });
  await db.setting.upsert({
    where: { key: `pending_2fa_secret:${userId}` },
    create: { key: `pending_2fa_secret:${userId}`, value },
    update: { value },
  });
}

async function readPendingSecret(userId: string): Promise<string | null> {
  try {
    const row = await db.setting.findUnique({
      where: { key: `pending_2fa_secret:${userId}` },
    });
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.secret !== "string" || typeof rec.exp !== "number") return null;
    if (rec.exp <= Date.now()) return null;
    return rec.secret;
  } catch {
    return null;
  }
}

async function deletePending(userId: string, kind: "setup" | "secret"): Promise<void> {
  const key = kind === "setup" ? `pending_2fa_setup:${userId}` : `pending_2fa_secret:${userId}`;
  try {
    await db.setting.delete({ where: { key } });
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
    if (!/^[a-f0-9]{64}$/.test(setupToken)) {
      return NextResponse.json(
        { error: "Sesi pemasangan 2FA tidak valid. Login ulang." },
        { status: 400 },
      );
    }

    // Temukan user pemilik token (jumlah admin kecil — bandingkan semua baris pending).
    const candidates = await db.setting.findMany({
      where: { key: { startsWith: "pending_2fa_setup:" } },
    });
    let userId: string | null = null;
    for (const row of candidates) {
      const pending = await readPendingSetup(row.value);
      if (pending && pending.token === setupToken) {
        userId = row.key.slice("pending_2fa_setup:".length);
        break;
      }
    }
    if (!userId) {
      return NextResponse.json(
        { error: "Sesi pemasangan 2FA kedaluwarsa. Login ulang." },
        { status: 401 },
      );
    }

    const user = await db.adminUser.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.role !== "OWNER" || user.totpEnabled) {
      await deletePending(userId, "setup");
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
      return NextResponse.json({ ok: true, stage: "SETUP", email: user.email, uri, secret, qrDataUrl });
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
    await deletePending(user.id, "secret");
    await deletePending(user.id, "setup");
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
