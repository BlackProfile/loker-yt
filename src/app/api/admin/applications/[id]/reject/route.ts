// POST /api/admin/applications/[id]/reject — tolak lamaran dengan alasan terstruktur (OWNER/HR).
// Mengubah status ke REJECTED, menyimpan alasan + feedback, mencatat log, dan mengirim
// notifikasi webhook. Mengembalikan pesan penolakan siap-kirim (dari template posisi).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  sanitizeRejectionReason,
  serializeApplication,
} from "@/lib/seed";
import { REJECTION_REASON_LABELS } from "@/lib/types";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { sendSystemEvent } from "@/lib/notify";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const reason = sanitizeRejectionReason(data.reason);
    if (!reason) {
      return NextResponse.json({ error: "Alasan penolakan tidak valid." }, { status: 400 });
    }

    let note: string | null = null;
    if (typeof data.note === "string" && data.note.trim()) {
      note = data.note.trim().slice(0, 1000);
    }
    // Feedback detail: catatan ditampilkan ke pelamar di halaman status.
    const feedback = data.feedback === true;

    const existing = await db.application.findUnique({
      where: { id },
      include: { position: { select: { title: true, rejectTemplate: true } } },
    });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (existing.status === "REJECTED") {
      return NextResponse.json({ error: "Lamaran sudah ditolak sebelumnya." }, { status: 400 });
    }

    const now = new Date();
    const updated = await db.application.update({
      where: { id },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
        rejectionNote: feedback ? note : note, // catatan selalu tersimpan internal; tampil publik hanya bila feedback
        rejectedAt: now,
      },
      include: APPLICATION_INCLUDE,
    });

    const reasonLabel = REJECTION_REASON_LABELS[reason];
    await db.activityLog.createMany({
      data: [
        {
          applicationId: id,
          actor: session.name,
          action: "STATUS_CHANGE",
          detail: `Ditolak — alasan: ${reasonLabel}`,
        },
        {
          applicationId: id,
          actor: "Sistem",
          action: "REJECT_NOTIFIED",
          detail: feedback
            ? "Pesan penolakan dengan feedback disiapkan untuk pelamar"
            : "Pesan penolakan standar disiapkan untuk pelamar",
        },
      ],
    });

    // Notifikasi webhook ke admin
    void sendSystemEvent({
      title: "Kandidat Ditolak",
      detail: `${existing.name} (${existing.position?.title ?? "posisi umum"}) ditolak — alasan: ${reasonLabel}`,
      applicationId: id,
      action: "REJECT_NOTIFIED",
    });

    // Pesan penolakan siap-kirim dari template posisi (variabel {nama},{posisi},{kode},{alasan})
    const baseTemplate =
      existing.position?.rejectTemplate ??
      "Halo {nama},\n\nTerima kasih sudah melamar posisi {posisi} di Lumina Studio. Setelah menimbang banyak kandidat, kami memutuskan untuk belum melanjutkan lamaranmu kali ini.\n\nJangan berkecil hati — kami menyimpan datamu dan akan menghubungimu bila ada kesempatan lain yang cocok. Tetap semangat berkarya!\n\nSalam,\nTim Lumina Studio";
    const message = fill(baseTemplate, {
      nama: existing.name,
      posisi: existing.position?.title ?? "-",
      kode: existing.trackingCode ?? "-",
      alasan: reasonLabel,
    }) + (feedback && note ? `\n\nUmpan balik dari kami:\n${note}` : "");

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({
      application: serializeApplication(updated),
      message,
      reasonLabel,
    });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/reject]", error);
    return NextResponse.json({ error: "Gagal menolak lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
