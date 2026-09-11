// POST /api/admin/applications/bulk — aksi massal: ubah status, hapus, atur talent pool, atau tolak (OWNER/HR).
// Aksi "reject": status -> REJECTED + alasan terstruktur + tanggal ditolak (per lamaran, lewat transaksi).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { sanitizeRejectionReason } from "@/lib/seed";
import { stageLabel } from "@/lib/stages";
import { REJECTION_REASON_LABELS, type RejectionReason } from "@/lib/types";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const ids = Array.isArray(data.ids)
      ? data.ids.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Daftar ID lamaran tidak valid." }, { status: 400 });
    }

    const action = typeof data.action === "string" ? data.action : "";
    if (!["status", "delete", "talentPool", "reject"].includes(action)) {
      return NextResponse.json({ error: "Aksi tidak valid." }, { status: 400 });
    }

    let affected = 0;
    let logAction = "";
    let logDetail = "";

    if (action === "status") {
      // Status/tahap menerima string apa pun (5 status bawaan ATAU tahap kustom posisi).
      const status = typeof data.status === "string" ? data.status.trim() : "";
      if (!status || status.length > 40) {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      const result = await db.application.updateMany({ where: { id: { in: ids } }, data: { status } });
      affected = result.count;
      const label = stageLabel(status);
      logAction = "BULK_STATUS";
      logDetail = `${affected} lamaran diubah status menjadi ${label}`;
    } else if (action === "talentPool") {
      if (typeof data.talentPool !== "boolean") {
        return NextResponse.json({ error: "talentPool harus berupa boolean." }, { status: 400 });
      }
      const result = await db.application.updateMany({
        where: { id: { in: ids } },
        data: { talentPool: data.talentPool },
      });
      affected = result.count;
      logAction = "BULK_TALENT_POOL";
      logDetail = `${affected} lamaran ${data.talentPool ? "ditambahkan ke" : "dikeluarkan dari"} talent pool`;
    } else if (action === "reject") {
      const reason = sanitizeRejectionReason(data.reason);
      if (!reason) {
        return NextResponse.json({ error: "Alasan penolakan tidak valid." }, { status: 400 });
      }
      const note =
        typeof data.note === "string" && data.note.trim() ? data.note.trim().slice(0, 1000) : null;
      const now = new Date();
      const rows = await db.application.findMany({
        where: { id: { in: ids }, status: { not: "REJECTED" } },
        select: { id: true },
      });
      await db.$transaction(
        rows.map((row) =>
          db.application.update({
            where: { id: row.id },
            data: {
              status: "REJECTED",
              rejectionReason: reason,
              rejectionNote: note,
              rejectedAt: now,
            },
          }),
        ),
      );
      if (rows.length > 0) {
        await db.activityLog.createMany({
          data: rows.map((row) => ({
            applicationId: row.id,
            actor: session.name,
            action: "STATUS_CHANGE",
            detail: `Ditolak massal — alasan: ${REJECTION_REASON_LABELS[reason as RejectionReason]}`,
          })),
        });
      }
      affected = rows.length;
      logAction = "BULK_STATUS";
      logDetail = `${affected} lamaran ditolak massal (alasan: ${REJECTION_REASON_LABELS[reason as RejectionReason]})`;
    } else {
      const result = await db.application.deleteMany({ where: { id: { in: ids } } });
      affected = result.count;
      logAction = "BULK_DELETE";
      logDetail = `${affected} lamaran dihapus`;
    }

    await db.activityLog.create({
      data: { applicationId: null, actor: session.name, action: logAction, detail: logDetail },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, affected });
  } catch (error) {
    console.error("[POST /api/admin/applications/bulk]", error);
    return NextResponse.json({ error: "Gagal menjalankan aksi massal. Coba lagi nanti." }, { status: 500 });
  }
}
