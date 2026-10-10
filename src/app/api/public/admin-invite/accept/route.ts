// POST /api/public/admin-invite/accept — terima undangan admin: atur password akun baru (PUBLIK).
// NR-19: dipanggil dari halaman "#admin/invite?token=..." (Panel Admin → mode Selesaikan Pendaftaran).
// Aturan:
// - Token dicari di AdminUser.inviteToken. Tidak ada / sudah kedaluwarsa → 404 generik
//   (token kedaluwarsa langsung dikosongkan agar tidak bisa dipakai lagi).
// - Password minimal 8 karakter. Nama opsional (bila diisi, nama akun diperbarui).
// - Sukses: passwordHash baru, token+kedaluwarsa dikosongkan, akun aktif, log USER_INVITE_ACCEPTED.
// - Rate limit sederhana in-memory per-IP: maks 10 permintaan/menit (pola status-gate.ts).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/server-auth";
import { readPasswordPolicy, validatePassword } from "@/lib/password-policy";
import { clientIp } from "@/lib/status-gate";

export const dynamic = "force-dynamic";

const GENERIC_NOT_FOUND = { error: "Tautan undangan tidak valid atau sudah kedaluwarsa." };

/** Rate limit in-memory per-IP: maks 10 permintaan per jendela 60 detik. */
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;
const rateMap = new Map<string, { count: number; windowStart: number }>();

function pruneRate(now: number): void {
  if (rateMap.size <= 2000) return;
  for (const [key, rec] of rateMap) {
    if (now - rec.windowStart > RATE_WINDOW_MS) rateMap.delete(key);
  }
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  pruneRate(now);
  const rec = rateMap.get(key);
  if (!rec || now - rec.windowStart > RATE_WINDOW_MS) {
    rateMap.set(key, { count: 1, windowStart: now });
    return false;
  }
  rec.count += 1;
  return rec.count > RATE_LIMIT;
}

export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi dalam beberapa saat." },
        { status: 429 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const token = typeof data.token === "string" ? data.token.trim().slice(0, 128) : "";
    const password = typeof data.password === "string" ? data.password : "";
    const rawName = typeof data.name === "string" ? data.name.trim() : "";

    if (!token) {
      return NextResponse.json(GENERIC_NOT_FOUND, { status: 404 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password minimal 8 karakter." }, { status: 400 });
    }
    // NR46 — sandi undangan juga tunduk pada kebijakan aktif.
    const policy = await readPasswordPolicy();
    const check = validatePassword(password, policy, user?.email ?? null);
    if (!check.ok) {
      return NextResponse.json(
        { error: `Sandi tidak memenuhi kebijakan: ${check.reasons.join(" ")}` },
        { status: 400 },
      );
    }
    if (rawName && rawName.length < 2) {
      return NextResponse.json({ error: "Nama minimal 2 karakter." }, { status: 400 });
    }

    const user = await db.adminUser.findUnique({ where: { inviteToken: token } });
    // Token tidak dikenal → respons generik yang sama dengan kedaluwarsa (anti-enumerasi).
    if (!user) {
      return NextResponse.json(GENERIC_NOT_FOUND, { status: 404 });
    }
    // Kedaluwarsa (atau expiry hilang) → anggap tidak ada + kosongkan token agar mati permanen.
    if (!user.inviteExpiresAt || user.inviteExpiresAt.getTime() < Date.now()) {
      await db.adminUser
        .update({ where: { id: user.id }, data: { inviteToken: null, inviteExpiresAt: null } })
        .catch(() => undefined);
      return NextResponse.json(GENERIC_NOT_FOUND, { status: 404 });
    }

    await db.adminUser.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(password),
        inviteToken: null,
        inviteExpiresAt: null,
        isActive: true,
        // NR46 — jejak sandi awal; penerima mengatur sendiri jadi tidak wajib ganti lagi.
        lastPasswordChangedAt: new Date(),
        mustChangePassword: false,
        ...(rawName ? { name: rawName.slice(0, 60) } : {}),
      },
    });

    await db.activityLog.create({
      data: {
        actor: user.email,
        action: "USER_INVITE_ACCEPTED",
        detail: "Undangan admin diterima — sandi diatur dan akun diaktifkan",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/admin-invite/accept]", error);
    return NextResponse.json(
      { error: "Gagal memproses undangan. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
