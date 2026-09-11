// PATCH  /api/admin/positions/[id] — update sebagian field posisi, termasuk closesAt (OWNER/HR).
// DELETE /api/admin/positions/[id] — hapus posisi (OWNER/HR; Application.positionId jadi null via onDelete SetNull).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { serializePosition } from "@/lib/seed";
import { POSITION_TYPES } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

type PositionUpdateData = {
  title?: string;
  department?: string;
  type?: string;
  location?: string;
  description?: string;
  requirements?: string;
  isActive?: boolean;
  closesAt?: Date | null;
  order?: number;
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: PositionUpdateData = {};

    if (data.title !== undefined) {
      const title = typeof data.title === "string" ? data.title.trim() : "";
      if (title.length < 3) {
        return NextResponse.json({ error: "Judul posisi minimal 3 karakter." }, { status: 400 });
      }
      updateData.title = title;
    }
    if (data.department !== undefined) {
      const department = typeof data.department === "string" ? data.department.trim() : "";
      if (!department) {
        return NextResponse.json({ error: "Departemen wajib diisi." }, { status: 400 });
      }
      updateData.department = department;
    }
    if (data.type !== undefined) {
      if (typeof data.type !== "string" || !(POSITION_TYPES as readonly string[]).includes(data.type.trim())) {
        return NextResponse.json({ error: "Jenis pekerjaan tidak valid." }, { status: 400 });
      }
      updateData.type = data.type.trim();
    }
    if (data.location !== undefined) {
      const location = typeof data.location === "string" ? data.location.trim() : "";
      if (!location) {
        return NextResponse.json({ error: "Lokasi wajib diisi." }, { status: 400 });
      }
      updateData.location = location;
    }
    if (data.description !== undefined) {
      const description = typeof data.description === "string" ? data.description.trim() : "";
      if (description.length < 10) {
        return NextResponse.json({ error: "Deskripsi minimal 10 karakter." }, { status: 400 });
      }
      updateData.description = description;
    }
    if (data.requirements !== undefined) {
      if (!Array.isArray(data.requirements)) {
        return NextResponse.json({ error: "Requirements harus berupa array teks." }, { status: 400 });
      }
      const requirements = data.requirements
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      updateData.requirements = JSON.stringify(requirements);
    }
    if (data.isActive !== undefined) {
      if (typeof data.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive harus berupa boolean." }, { status: 400 });
      }
      updateData.isActive = data.isActive;
    }
    if (data.closesAt !== undefined) {
      if (data.closesAt === null) {
        updateData.closesAt = null;
      } else if (typeof data.closesAt === "string") {
        const parsed = new Date(data.closesAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Tanggal penutupan tidak valid." }, { status: 400 });
        }
        updateData.closesAt = parsed;
      } else {
        return NextResponse.json({ error: "Tanggal penutupan tidak valid." }, { status: 400 });
      }
    }
    if (data.order !== undefined) {
      if (typeof data.order !== "number" || !Number.isInteger(data.order)) {
        return NextResponse.json({ error: "Order harus berupa bilangan bulat." }, { status: 400 });
      }
      updateData.order = data.order;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const existing = await db.position.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const updated = await db.position.update({ where: { id }, data: updateData });

    return NextResponse.json(serializePosition(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/positions/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui posisi. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const existing = await db.position.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.position.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/positions/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus posisi. Coba lagi nanti." }, { status: 500 });
  }
}
