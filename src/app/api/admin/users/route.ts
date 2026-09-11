// GET  /api/admin/users — daftar semua pengguna admin (OWNER saja).
// POST /api/admin/users — buat pengguna admin baru (OWNER saja).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/server-auth";
import { serializeAdminUser } from "@/lib/seed";
import { ROLES } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireOwner(): Promise<{ error: NextResponse | null; session: null }> {
  const session = await getSession();
  if (!session) return { error: NextResponse.json(UNAUTHORIZED, { status: 401 }), session: null };
  if (session.role !== "OWNER") return { error: NextResponse.json(FORBIDDEN, { status: 403 }), session: null };
  return { error: null, session: null };
}

export async function GET() {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;

    const users = await db.adminUser.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return NextResponse.json(users.map(serializeAdminUser));
  } catch (error) {
    console.error("[GET /api/admin/users]", error);
    return NextResponse.json({ error: "Gagal memuat daftar pengguna. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data pengguna tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const name = typeof data.name === "string" ? data.name.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";
    const password = typeof data.password === "string" ? data.password : "";
    const role = typeof data.role === "string" ? data.role.trim() : "";

    if (name.length < 2) {
      return NextResponse.json({ error: "Nama minimal 2 karakter." }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
    }
    if (!(ROLES as string[]).includes(role)) {
      return NextResponse.json({ error: "Role tidak valid." }, { status: 400 });
    }

    // SQLite Prisma tidak mendukung mode: "insensitive"; cek unik email secara manual.
    const allUsers = await db.adminUser.findMany({ select: { email: true } });
    if (allUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: "Email sudah terdaftar." }, { status: 400 });
    }

    const created = await db.adminUser.create({
      data: { name, email, passwordHash: hashPassword(password), role, isActive: true },
    });

    return NextResponse.json(serializeAdminUser(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/users]", error);
    return NextResponse.json({ error: "Gagal membuat pengguna. Coba lagi nanti." }, { status: 500 });
  }
}
