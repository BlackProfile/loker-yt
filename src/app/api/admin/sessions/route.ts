// GET    /api/admin/sessions — daftar sesi login aktif (revokedAt null).
//                             OWNER melihat semua sesi; role lain hanya miliknya sendiri.
//                             Sesi yang berasal dari cookie ini ditandai current: true.
// DELETE /api/admin/sessions?id=...  — cabut satu sesi (OWNER: siapa pun; lainnya: milik sendiri).
// DELETE /api/admin/sessions?scope=others — cabut semua sesi KECUALI perangkat ini (OWNER).
// DELETE /api/admin/sessions?scope=user&userId=... — cabut SEMUA sesi satu pengguna (OWNER, NR46).
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ADMIN_COOKIE_NAME, getSession, hashToken } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

async function currentTokenHash(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
  return token ? hashToken(token) : null;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const isOwner = session.role === "OWNER";
    const mine = await currentTokenHash();

    const rows = await db.sessionToken.findMany({
      where: { revokedAt: null, ...(isOwner ? {} : { userId: session.id }) },
      orderBy: { lastSeenAt: "desc" },
      take: 100,
    });

    // Model SessionToken tidak punya relasi Prisma ke AdminUser — join manual.
    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = await db.adminUser.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, role: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return NextResponse.json(
      rows.map((row) => {
        const user = userById.get(row.userId);
        return {
          id: row.id,
          userName: user?.name ?? "-",
          userEmail: user?.email ?? "-",
          userRole: user?.role ?? "-",
          userAgent: row.userAgent,
          ip: row.ip,
          createdAt: row.createdAt.toISOString(),
          lastSeenAt: row.lastSeenAt.toISOString(),
          current: mine !== null && row.tokenHash === mine,
        };
      }),
    );
  } catch (error) {
    console.error("[GET /api/admin/sessions]", error);
    return NextResponse.json({ error: "Gagal memuat daftar sesi. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") ?? "").trim();
    const scope = (searchParams.get("scope") ?? "").trim();

    // NR46 — cabut semua sesi satu pengguna (dari kartu Kesehatan Akses / detail pengguna).
    if (scope === "user") {
      if (session.role !== "OWNER") {
        return NextResponse.json(FORBIDDEN, { status: 403 });
      }
      const userId = (searchParams.get("userId") ?? "").trim();
      if (!userId) {
        return NextResponse.json({ error: "Parameter userId wajib diisi." }, { status: 400 });
      }
      const result = await db.sessionToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return NextResponse.json({ ok: true, revoked: result.count });
    }

    // Keluarkan semua perangkat lain (OWNER saja) — sesi perangkat ini tetap aktif.
    if (scope === "others") {
      if (session.role !== "OWNER") {
        return NextResponse.json(FORBIDDEN, { status: 403 });
      }
      const mine = await currentTokenHash();
      const result = await db.sessionToken.updateMany({
        where: { revokedAt: null, ...(mine ? { tokenHash: { not: mine } } : {}) },
        data: { revokedAt: new Date() },
      });
      return NextResponse.json({ ok: true, revoked: result.count });
    }

    if (!id) {
      return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
    }

    const row = await db.sessionToken.findUnique({ where: { id } });
    if (!row || row.revokedAt) {
      return NextResponse.json({ error: "Sesi tidak ditemukan." }, { status: 404 });
    }
    if (session.role !== "OWNER" && row.userId !== session.id) {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    await db.sessionToken.update({ where: { id }, data: { revokedAt: new Date() } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/sessions]", error);
    return NextResponse.json({ error: "Gagal mengeluarkan sesi. Coba lagi nanti." }, { status: 500 });
  }
}
