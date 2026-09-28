// GET    /api/admin/users/[id] — detail pengguna (termasuk scope posisi & status 2FA, OWNER saja).
// PATCH  /api/admin/users/[id] — update nama/role/status aktif/password/scope posisi/reset 2FA (OWNER saja).
// DELETE /api/admin/users/[id] — hapus pengguna (OWNER saja, dengan proteksi owner terakhir).
import { NextRequest, NextResponse } from "next/server";
import type { AdminUser as AdminUserRecordModel } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/server-auth";
import { parseAssignedPositions, serializeAdminUser } from "@/lib/seed";
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

/** Respons detail user: profil dasar + scope posisi (string[]) + status 2FA. */
function serializeUserDetail(user: AdminUserRecordModel) {
  return {
    ...serializeAdminUser(user),
    totpEnabled: user.totpEnabled,
    assignedPositions: parseAssignedPositions(user.assignedPositions),
  };
}

/** True jika target adalah satu-satunya OWNER aktif (tidak boleh dinonaktifkan/diturunkan/dihapus). */
async function isLastActiveOwner(targetId: string): Promise<boolean> {
  const activeOwnerCount = await db.adminUser.count({ where: { role: "OWNER", isActive: true } });
  const target = await db.adminUser.findUnique({ where: { id: targetId } });
  return !!target && target.role === "OWNER" && target.isActive && activeOwnerCount <= 1;
}

// GET: dipakai dialog edit pengguna untuk memuat scope posisi & status 2FA.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;
    const { id } = await params;

    const user = await db.adminUser.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    return NextResponse.json(serializeUserDetail(user));
  } catch (error) {
    console.error("[GET /api/admin/users/[id]]", error);
    return NextResponse.json({ error: "Gagal memuat pengguna. Coba lagi nanti." }, { status: 500 });
  }
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

    const updateData: {
      name?: string;
      role?: string;
      isActive?: boolean;
      passwordHash?: string;
      assignedPositions?: string;
      totpSecret?: string | null;
      totpEnabled?: boolean;
    } = {};

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
    // Scope posisi granular untuk HR: array positionId (kosong = semua posisi).
    if (data.assignedPositions !== undefined) {
      if (
        !Array.isArray(data.assignedPositions) ||
        data.assignedPositions.some((v) => typeof v !== "string")
      ) {
        return NextResponse.json(
          { error: "assignedPositions harus berupa array string." },
          { status: 400 },
        );
      }
      const scope = [
        ...new Set(
          (data.assignedPositions as string[])
            .map((v) => v.trim())
            .filter(Boolean)
            .map((v) => v.slice(0, 100))
        ),
      ].slice(0, 100);
      updateData.assignedPositions = JSON.stringify(scope);
    }
    // OWNER mereset 2FA user lain: kosongkan secret TOTP + matikan penanda aktif.
    if (data.totpReset !== undefined) {
      if (typeof data.totpReset !== "boolean") {
        return NextResponse.json({ error: "totpReset harus berupa boolean." }, { status: 400 });
      }
      if (data.totpReset) {
        updateData.totpSecret = null;
        updateData.totpEnabled = false;
      }
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
    return NextResponse.json(serializeUserDetail(updated));
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
