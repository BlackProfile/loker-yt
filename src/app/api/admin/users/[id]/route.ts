// PATCH  /api/admin/users/[id] — update nama/role/status aktif/password (OWNER saja).
// DELETE /api/admin/users/[id] — hapus pengguna (OWNER saja, dengan proteksi owner terakhir).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/server-auth";
import { serializeAdminUser } from "@/lib/seed";
import { ROLES } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Pengguna tidak ditemukan" };

async function requireOwner() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json(UNAUTHORIZED, { status: 401 }) as NextResponse, session: null };
  if (session.role !== "OWNER") return { error: NextResponse.json(FORBIDDEN, { status: 403 }) as NextResponse, session: null };
  return { error: null, session };
}

/** True jika target adalah satu-satunya OWNER aktif (tidak boleh dinonaktifkan/diturunkan/dihapus). */
async function isLastActiveOwner(targetId: string): Promise<boolean> {
  const activeOwnerCount = await db.adminUser.count({ where: { role: "OWNER", isActive: true } });
  const target = await db.adminUser.findUnique({ where: { id: targetId } });
  return !!target && target.role === "OWNER" && target.isActive && activeOwnerCount <= 1;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;
    const { id } = await params;

    const existing = await db.adminUser.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: { name?: string; role?: string; isActive?: boolean; passwordHash?: string } = {};

    if (data.name !== undefined) {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (name.length < 2) {
        return NextResponse.json({ error: "Nama minimal 2 karakter." }, { status: 400 });
      }
      updateData.name = name;
    }
    if (data.role !== undefined) {
      if (typeof data.role !== "string" || !(ROLES as string[]).includes(data.role)) {
        return NextResponse.json({ error: "Role tidak valid." }, { status: 400 });
      }
      updateData.role = data.role;
    }
    if (data.isActive !== undefined) {
      if (typeof data.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive harus berupa boolean." }, { status: 400 });
      }
      updateData.isActive = data.isActive;
    }
    if (data.password !== undefined) {
      if (typeof data.password !== "string" || data.password.length < 6) {
        return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
      }
      updateData.passwordHash = hashPassword(data.password);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    // Cegah menonaktifkan / menurunkan satu-satunya OWNER yang aktif.
    const losesOwnerStatus =
      existing.role === "OWNER" &&
      existing.isActive &&
      ((updateData.role !== undefined && updateData.role !== "OWNER") || updateData.isActive === false);
    if (losesOwnerStatus && (await isLastActiveOwner(id))) {
      return NextResponse.json(
        { error: "Tidak dapat menonaktifkan atau menurunkan satu-satunya pemilik (OWNER) yang aktif." },
        { status: 400 },
      );
    }

    const updated = await db.adminUser.update({ where: { id }, data: updateData });
    return NextResponse.json(serializeAdminUser(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/users/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui pengguna. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;
    const session = guard.session!;
    const { id } = await params;

    const existing = await db.adminUser.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (id === session.id) {
      return NextResponse.json({ error: "Tidak dapat menghapus akun Anda sendiri." }, { status: 400 });
    }
    if (await isLastActiveOwner(id)) {
      return NextResponse.json(
        { error: "Tidak dapat menghapus satu-satunya pemilik (OWNER) yang aktif." },
        { status: 400 },
      );
    }

    await db.adminUser.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/users/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus pengguna. Coba lagi nanti." }, { status: 500 });
  }
}
