// POST /api/admin/users/password — ganti password akun sendiri (semua role yang login).
// NR46 — validasi kebijakan sandi + jejak lastPasswordChangedAt + bebas wajib-ganti.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword, verifyPassword } from "@/lib/server-auth";
import { readPasswordPolicy, validatePassword } from "@/lib/password-policy";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const currentPassword = typeof data.currentPassword === "string" ? data.currentPassword : "";
    const newPassword = typeof data.newPassword === "string" ? data.newPassword : "";

    if (!currentPassword) {
      return NextResponse.json({ error: "Password saat ini wajib diisi." }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: "Password baru minimal 6 karakter" }, { status: 400 });
    }

    const user = await db.adminUser.findUnique({ where: { id: session.id } });
    if (!user) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Password saat ini salah" }, { status: 400 });
    }

    // NR46 — sandi baru wajib memenuhi kebijakan aktif.
    const policy = await readPasswordPolicy();
    const check = validatePassword(newPassword, policy, user.email);
    if (!check.ok) {
      return NextResponse.json(
        { error: `Sandi baru tidak memenuhi kebijakan: ${check.reasons.join(" ")}` },
        { status: 400 },
      );
    }

    await db.adminUser.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(newPassword),
        lastPasswordChangedAt: new Date(), // NR46
        mustChangePassword: false, // NR46 — wajib ganti terpenuhi
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/admin/users/password]", error);
    return NextResponse.json({ error: "Gagal mengganti password. Coba lagi nanti." }, { status: 500 });
  }
}
