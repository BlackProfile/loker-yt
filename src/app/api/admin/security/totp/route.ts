// GET  /api/admin/security/totp — status 2FA (TOTP) milik sesi sendiri.
// POST /api/admin/security/totp — kelola 2FA sendiri: action=setup | enable {code} | disable {code}.
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { generateTotpSecret, verifyTotpCode } from "@/lib/totp";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

/** Status 2FA sesi sendiri (dipakai UI untuk badge Aktif/Nonaktif). */
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const user = await db.adminUser.findUnique({
      where: { id: session.id },
      select: { totpEnabled: true },
    });
    return NextResponse.json({ totpEnabled: !!user?.totpEnabled });
  } catch (error) {
    console.error("[GET /api/admin/security/totp]", error);
    return NextResponse.json({ error: "Gagal memuat status 2FA. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const user = await db.adminUser.findUnique({ where: { id: session.id } });
    if (!user || !user.isActive) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    const action =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).action
        : undefined;
    const code =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).code
        : undefined;

    // SETUP: generate secret baru (hanya bila 2FA belum aktif), simpan sebagai pending,
    // lalu kembalikan URI otpauth + QR data URL untuk discan aplikasi autentikator.
    if (action === "setup") {
      if (user.totpEnabled) {
        return NextResponse.json({ error: "2FA sudah aktif untuk akun ini." }, { status: 400 });
      }
      const { secret, uri } = generateTotpSecret(user.email);
      await db.adminUser.update({
        where: { id: user.id },
        data: { totpSecret: secret, totpEnabled: false },
      });
      const qrDataUrl = await QRCode.toDataURL(uri);
      return NextResponse.json({ totpEnabled: false, uri, secret, qrDataUrl });
    }

    // ENABLE: verifikasi kode terhadap secret pending, lalu aktifkan.
    if (action === "enable") {
      if (user.totpEnabled) {
        return NextResponse.json({ error: "2FA sudah aktif untuk akun ini." }, { status: 400 });
      }
      if (!user.totpSecret) {
        return NextResponse.json(
          { error: "Jalankan pengaturan 2FA terlebih dahulu." },
          { status: 400 },
        );
      }
      if (typeof code !== "string" || !verifyTotpCode(user.totpSecret, code)) {
        return NextResponse.json({ error: "Kode 2FA tidak valid." }, { status: 400 });
      }
      await db.adminUser.update({
        where: { id: user.id },
        data: { totpEnabled: true },
      });
      return NextResponse.json({ ok: true, totpEnabled: true });
    }

    // DISABLE: verifikasi kode terlebih dahulu, lalu kosongkan secret & matikan.
    if (action === "disable") {
      if (!user.totpSecret) {
        return NextResponse.json({ error: "2FA belum diatur untuk akun ini." }, { status: 400 });
      }
      if (typeof code !== "string" || !verifyTotpCode(user.totpSecret, code)) {
        return NextResponse.json({ error: "Kode 2FA tidak valid." }, { status: 400 });
      }
      await db.adminUser.update({
        where: { id: user.id },
        data: { totpSecret: null, totpEnabled: false },
      });
      return NextResponse.json({ ok: true, totpEnabled: false });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/admin/security/totp]", error);
    return NextResponse.json({ error: "Gagal memproses 2FA. Coba lagi nanti." }, { status: 500 });
  }
}
