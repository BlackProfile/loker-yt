// NR-24 — Batalkan penolakan lamaran (undo reject).
// POST /api/admin/applications/[id]/undo-reject — (OWNER/HR) body {reason}.
// Lamaran kembali ke tahap terakhir sebelum REJECTED (fallback NEW) sesuai stageHistory;
// kolom penolakan dikosongkan, email status + webhook dikirim, semua tercatat di ActivityLog.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, serializeApplication } from "@/lib/seed";
import { appendStageHistory, parseStageHistory } from "@/lib/stage-history";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { emitWebhook } from "@/lib/webhooks";
import { sendCandidateStatusEmail } from "@/lib/candidate-emails";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

const REASON_MAX = 300;

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

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    if (existing.status !== "REJECTED") {
      return NextResponse.json({ error: "Lamaran tidak sedang ditolak." }, { status: 400 });
    }
    if (existing.rejectionReason === "MENARIK_DIRI") {
      return NextResponse.json(
        { error: "Penolakan karena pelamar menarik diri tidak bisa dibatalkan." },
        { status: 400 }
      );
    }
    if (existing.mergedIntoId) {
      return NextResponse.json({ error: "Lamaran sudah digabung." }, { status: 400 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "Alasan pembatalan wajib diisi." }, { status: 400 });
    }
    if (reason.length > REASON_MAX) {
      return NextResponse.json(
        { error: `Alasan pembatalan maksimal ${REASON_MAX} karakter.` },
        { status: 400 }
      );
    }

    // Tahap tujuan: entri TERAKHIR pada stageHistory yang bukan REJECTED (fallback NEW).
    const history = parseStageHistory(existing.stageHistory);
    let targetStatus = "NEW";
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].status !== "REJECTED") {
        targetStatus = history[i].status;
        break;
      }
    }

    const now = new Date();
    const updated = await db.application.update({
      where: { id },
      data: {
        status: targetStatus,
        rejectionReason: null,
        rejectionNote: null,
        rejectedAt: null,
        stageUpdatedAt: now,
        stageHistory: appendStageHistory(existing.stageHistory, targetStatus, existing.status),
      },
      include: APPLICATION_INCLUDE,
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "UNDO_REJECT",
        detail: `Penolakan dibatalkan: ${reason}`,
      },
    });

    // Webhook keluar: tahap berubah dari REJECTED ke tahap pemulihan — fire-and-forget.
    void emitWebhook("application.stage_changed", {
      id,
      name: existing.name,
      from: "REJECTED",
      to: targetStatus,
    });
    // Email otomatis ke kandidat (pola sama dengan PATCH lamaran) — fire-and-forget.
    void sendCandidateStatusEmail({
      applicationId: id,
      name: existing.name,
      email: existing.email,
      trackingCode: existing.trackingCode,
      toStatus: targetStatus,
      positionTitle: updated.position?.title ?? null,
      origin: req.headers.get("origin") ?? undefined,
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(serializeApplication(updated));
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/undo-reject]", error);
    return NextResponse.json({ error: "Gagal membatalkan penolakan. Coba lagi nanti." }, { status: 500 });
  }
}
