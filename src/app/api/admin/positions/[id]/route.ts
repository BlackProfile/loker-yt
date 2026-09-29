// PATCH  /api/admin/positions/[id] — update sebagian field posisi (OWNER/HR), mendukung
//        seluruh field v3 (slug, gaji, benefit, screening, pipeline, template, rubrik, dll).
// DELETE /api/admin/positions/[id] — SOFT delete posisi (OWNER/HR): deletedAt diisi,
//          lamaran tetap utuh; pemulihan/hapus permanen lewat /api/admin/trash.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { serializePosition } from "@/lib/seed";
import { positionFieldsToDb, sanitizePositionInput } from "@/lib/position-input";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

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

    const existing = await db.position.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      // Posisi di tong sampah tidak bisa diedit.
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const sanitized = await sanitizePositionInput(data, {
      mode: "update",
      excludeId: existing.id,
      current: existing,
    });
    if (!sanitized.ok) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 });
    }

    const updateData = positionFieldsToDb(sanitized.value);
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const updated = await db.position.update({ where: { id }, data: updateData });

    // Realtime: perubahan posisi (edit/toggle/arsip) disebarkan ke publik & admin.
    void emitRealtime(REALTIME_EVENTS.positions);
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
    if (!existing || existing.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // SOFT delete: simpan deletedAt agar bisa dipulihkan dari Tong Sampah.
    const deletedAt = new Date();
    await db.position.update({ where: { id }, data: { deletedAt } });
    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: session.name,
        action: "POSITION_DELETE",
        detail: `Posisi "${existing.title}" dipindahkan ke tong sampah`,
      },
    });

    // Realtime: posisi dihapus — segarkan daftar publik & admin.
    void emitRealtime(REALTIME_EVENTS.positions);
    return NextResponse.json({ ok: true, deletedAt: deletedAt.toISOString() });
  } catch (error) {
    console.error("[DELETE /api/admin/positions/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus posisi. Coba lagi nanti." }, { status: 500 });
  }
}
