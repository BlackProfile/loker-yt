// POST /api/admin/login — login admin multi-user (email+password) dengan kompatibilitas legacy (password saja).
// Keamanan: audit LoginAudit untuk semua percobaan, lockout brute force (>= 5 gagal / 15 menit),
// verifikasi kode 2FA TOTP bila aktif, dan delay kecil saat password salah.
// NR41-SEC-B (F4): verifikasi bcrypt + upgrade transparan hash legacy SHA-256 saat login sukses;
// NR50-HOTFIX: OWNER tanpa TOTP aktif TETAP mendapat sesi penuh (tidak lagi dipaksa setup 2FA —
// alur paksa lama membuat OWNER yang menonaktifkan 2FA terkunci di luar). Respons menyertakan
// totpNotice=true agar panel menampilkan pengingat mengaktifkan 2FA kembali.
// NR41-SEC-B (F6): body.rememberMe (boolean, opsional) → cookie sesi 30 hari, selain itu 7 hari.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  setSessionCookie,
  upgradePasswordHashIfNeeded,
  verifyPasswordWithMeta,
} from "@/lib/server-auth";
import { ensureSeeded } from "@/lib/seed";
import { verifyTotpCode } from "@/lib/totp";
import { ROLES, type AdminSession, type Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const LOCKOUT_THRESHOLD = 5; // jumlah gagal yang memicu blokir
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // jendela waktu 15 menit

type LoginUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  passwordHash: string;
  totpEnabled: boolean;
  totpSecret: string | null;
};

function toSession(user: { id: string; name: string; email: string; role: string }): AdminSession {
  const role: Role = (ROLES as string[]).includes(user.role) ? (user.role as Role) : "VIEWER";
  return { id: user.id, name: user.name, email: user.email, role };
}

/** Catat percobaan login ke LoginAudit (gagal write tidak boleh menggagalkan login). */
async function writeLoginAudit(entry: {
  email: string;
  userId: string | null;
  success: boolean;
  reason: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  try {
    await db.loginAudit.create({ data: entry });
  } catch (err) {
    console.error("[POST /api/admin/login] gagal menulis LoginAudit", err);
  }
}

function clientIp(req: NextRequest): string | null {
  const raw = req.headers.get("x-forwarded-for") ?? "";
  const first = raw.split(",")[0]?.trim() ?? "";
  return first ? first.slice(0, 50) : null;
}

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded(); // pastikan akun admin default sudah ada

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data login tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const password = typeof data.password === "string" ? data.password : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";
    const totpCode = typeof data.totpCode === "string" ? data.totpCode : "";
    // F6 — "ingat saya": cookie & sesi 30 hari bila dicentang (UI datang terpisah).
    const rememberMe = data.rememberMe === true;

    if (!password) {
      return NextResponse.json({ error: "Password wajib diisi." }, { status: 400 });
    }

    const ip = clientIp(req);
    const userAgent = (req.headers.get("user-agent") ?? "").trim().slice(0, 200) || null;

    let user: LoginUser | null = null;

    if (email) {
      // Login multi-user: cocokkan email (case-insensitive) di antara user aktif.
      const users = await db.adminUser.findMany({ where: { isActive: true } });
      user = users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
    } else {
      // KOMPATIBILITAS LEGACY: body hanya { password } → verifikasi vs OWNER pertama (terlama).
      const owner = await db.adminUser.findFirst({
        where: { role: "OWNER", isActive: true },
        orderBy: { createdAt: "asc" },
      });
      user = owner;
    }

    // Kunci audit: email terdaftar, atau email yang diketik (agar brute force ke email
    // tak dikenal tetap terhitung), atau penanda tanpa email untuk mode legacy.
    const auditEmail = (user ? user.email : email).trim().toLowerCase() || "(tanpa-email)";

    // PROTEKSI BRUTE FORCE: hitung gagal (di luar LOCKOUT) pada 15 menit terakhir.
    const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
    const failedCount = await db.loginAudit.count({
      where: {
        email: auditEmail,
        success: false,
        createdAt: { gte: since },
        OR: [{ reason: { not: "LOCKOUT" } }, { reason: null }],
      },
    });
    if (failedCount >= LOCKOUT_THRESHOLD) {
      await writeLoginAudit({
        email: auditEmail,
        userId: user?.id ?? null,
        success: false,
        reason: "LOCKOUT",
        ip,
        userAgent,
      });
      // Sisa waktu blokir sengaja tidak diekspos.
      return NextResponse.json({ error: "LOCKOUT" }, { status: 429 });
    }

    // Verifikasi password (bcrypt / legacy SHA-256) — hanya bila user ditemukan.
    const passwordCheck = user
      ? await verifyPasswordWithMeta(password, user.passwordHash)
      : { ok: false, needsUpgrade: false };
    if (!user || !passwordCheck.ok) {
      // Delay kecil: waktu respons salah password tidak informatif.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await writeLoginAudit({
        email: auditEmail,
        userId: user?.id ?? null,
        success: false,
        reason: "PASSWORD_SALAH",
        ip,
        userAgent,
      });
      return NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
    }

    // F4 — upgrade transparan hash legacy SHA-256 → bcrypt (fire-and-forget, tanpa menggagalkan login).
    if (passwordCheck.needsUpgrade) {
      void upgradePasswordHashIfNeeded(user.id, password, user.passwordHash);
    }

    // NR50-HOTFIX — OWNER tanpa TOTP aktif: sesi penuh tetap dibuat (tidak ada lagi
    // paksaan setup 2FA di gerbang login). Panel menampilkan pengingat via totpNotice.
    const totpNotice = user.role === "OWNER" && !user.totpEnabled;

    // 2FA TOTP: bila aktif, kode wajib valid sebelum sesi dibuat.
    if (user.totpEnabled) {
      const codeValid = user.totpSecret
        ? verifyTotpCode(user.totpSecret, totpCode)
        : false;
      if (!codeValid) {
        await writeLoginAudit({
          email: auditEmail,
          userId: user.id,
          success: false,
          reason: "TOTP_SALAH",
          ip,
          userAgent,
        });
        return NextResponse.json({ error: "KODE_2FA" }, { status: 401 });
      }
    }

    await writeLoginAudit({
      email: auditEmail,
      userId: user.id,
      success: true,
      reason: "OK",
      ip,
      userAgent,
    });

    // NR46 — catat login sukses terakhir (kesehatan akses). Gagal tidak menggagalkan login.
    await db.adminUser
      .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
      .catch(() => undefined);

    // NR46 — bila akun wajib mengganti sandi, sesi tetap dibuat (agar bisa membuka
    // dialog ganti sandi) tetapi UI dipaksa menampilkan dialog tersebut.
    let mustChangePassword = false;
    try {
      const fresh = await db.adminUser.findUnique({
        where: { id: user.id },
        select: { mustChangePassword: true },
      });
      mustChangePassword = fresh?.mustChangePassword === true;
    } catch {
      // diam
    }

    const response = NextResponse.json({
      ok: true,
      session: toSession(user),
      mustChangePassword,
      totpNotice,
    });
    // Task 27: catat sesi per perangkat (SessionToken) — gagal pencatatan tidak menggagalkan login.
    // F6: rememberMe → cookie 30 hari, selain itu 7 hari.
    await setSessionCookie(response, user.id, { ip, userAgent }, { rememberMe });
    return response;
  } catch (error) {
    console.error("[POST /api/admin/login]", error);
    return NextResponse.json({ error: "Gagal masuk. Coba lagi nanti." }, { status: 500 });
  }
}
