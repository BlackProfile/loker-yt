// POST /api/admin/login — login admin multi-user (email+password) dengan kompatibilitas legacy (password saja).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { setSessionCookie, verifyPassword } from "@/lib/server-auth";
import { ensureSeeded } from "@/lib/seed";
import { ROLES, type AdminSession, type Role } from "@/lib/types";

export const dynamic = "force-dynamic";

function toSession(user: { id: string; name: string; email: string; role: string }): AdminSession {
  const role: Role = (ROLES as string[]).includes(user.role) ? (user.role as Role) : "VIEWER";
  return { id: user.id, name: user.name, email: user.email, role };
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

    if (!password) {
      return NextResponse.json({ error: "Password wajib diisi." }, { status: 400 });
    }

    let user: { id: string; name: string; email: string; role: string; passwordHash: string } | null = null;

    if (email) {
      // Login multi-user: cocokkan email (case-insensitive) di antara user aktif.
      const users = await db.adminUser.findMany({ where: { isActive: true } });
      user = users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
      }
    } else {
      // KOMPATIBILITAS LEGACY: body hanya { password } → verifikasi vs OWNER pertama (terlama).
      const owner = await db.adminUser.findFirst({
        where: { role: "OWNER", isActive: true },
        orderBy: { createdAt: "asc" },
      });
      if (!owner || !verifyPassword(password, owner.passwordHash)) {
        return NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
      }
      user = owner;
    }

    const response = NextResponse.json({ ok: true, session: toSession(user) });
    await setSessionCookie(response, user.id);
    return response;
  } catch (error) {
    console.error("[POST /api/admin/login]", error);
    return NextResponse.json({ error: "Gagal masuk. Coba lagi nanti." }, { status: 500 });
  }
}
