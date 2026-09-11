// PATCH /api/admin/applications/[id] — update status / catatan admin.
// DELETE /api/admin/applications/[id] — hapus lamaran.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/server-auth";
import { serializeApplication } from "@/lib/seed";
import { APPLICATION_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: { status?: string; adminNotes?: string | null } = {};

    if (data.status !== undefined) {
      if (typeof data.status !== "string" || !(APPLICATION_STATUSES as string[]).includes(data.status)) {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      updateData.status = data.status;
    }

    if (data.adminNotes !== undefined) {
      if (data.adminNotes === null) {
        updateData.adminNotes = null;
      } else if (typeof data.adminNotes === "string") {
        const notes = data.adminNotes.trim();
        updateData.adminNotes = notes.length > 0 ? notes : null;
      } else {
        return NextResponse.json({ error: "Catatan admin harus berupa teks." }, { status: 400 });
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const updated = await db.application.update({
      where: { id },
      data: updateData,
      include: { position: { select: { title: true } } },
    });

    return NextResponse.json(serializeApplication(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/applications/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui lamaran. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.application.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/applications/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
