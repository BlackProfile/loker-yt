// NR-24 — Hapus satu dokumen internal lamaran.
// DELETE /api/admin/internal-docs/[id] — (OWNER/HR).
// FileAsset ikut terhapus otomatis via onDelete: Cascade (relasi internalDoc).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Dokumen tidak ditemukan" };

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

    const existing = await db.applicationInternalDoc.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.applicationInternalDoc.delete({ where: { id } });

    await db.activityLog.create({
      data: {
        applicationId: existing.applicationId,
        actor: session.name,
        action: "INTERNAL_DOC_DELETED",
        detail: `Dokumen internal dihapus: ${existing.name}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/internal-docs/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus dokumen internal. Coba lagi nanti." }, { status: 500 });
  }
}
