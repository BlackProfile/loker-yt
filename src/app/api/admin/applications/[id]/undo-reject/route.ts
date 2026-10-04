// POST /api/admin/applications/[id]/undo-reject — batalkan penolakan (NR-24, fitur 14).
// Pola kunci: UI dua langkah (buka kunci -> alasan wajib) dan server wajib menerima
// `reason` (minimal 4 karakter). Status kembali ke tahap sebelum ditolak (dari
// stageHistory), kolom penolakan dibersihkan, dan semuanya tercatat di timeline.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, serializeApplication } from "@/lib/seed";
import { parseStageHistory, STAGE_HISTORY_MAX } from "@/lib/stage-history";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

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
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (reason.length < 4) {
      return NextResponse.json(
        { error: "Alasan pembatalan penolakan wajib diisi (minimal 4 karakter)." },
        { status: 400 }
      );
    }

    const app = await db.application.findUnique({
      where: { id },
      include: { position: { select: { stageCategories: true } } },
    });
    if (!app) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Validasi: lamaran harus sedang berada di tahap final Ditolak
    // (bawaan REJECTED atau tahap kustom berkategori REJECTED).
    const stageCategories = (() => {
      try {
        const parsed: unknown = JSON.parse(app.position?.stageCategories || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, string>)
          : {};
      } catch {
        return {};
      }
    })();
    const isRejected =
      app.status === "REJECTED" || stageCategories[app.status] === "REJECTED";
    if (!isRejected) {
      return NextResponse.json(
        { error: "Lamaran tidak sedang berstatus Ditolak." },
        { status: 400 }
      );
    }
    if (app.hiredAt) {
      return NextResponse.json(
        { error: "Lamaran ini sudah menjadi karyawan aktif dan tidak dapat dibatalkan." },
        { status: 409 }
      );
    }

    // Tahap tujuan: entri stageHistory tepat sebelum entri terakhir yang bernilai
    // tahap ditolak saat ini. Bila tidak ada riwayat, kembali ke tahap Baru.
    const history = parseStageHistory(app.stageHistory);
    let target = "NEW";
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].status === app.status && i > 0) {
        const prev = history[i - 1].status;
        // Jangan kembali ke tahap final lain (Diterima/Ditolak) — jatuh ke Baru.
        const prevIsFinal =
          prev === "ACCEPTED" ||
          prev === "REJECTED" ||
          stageCategories[prev] === "ACCEPTED" ||
          stageCategories[prev] === "REJECTED";
        target = prevIsFinal ? "NEW" : prev;
        break;
      }
    }

    const updated = await db.application.update({
      where: { id },
      data: {
        status: target,
        stageUpdatedAt: new Date(),
        stageHistory: JSON.stringify(
          [...parseStageHistory(app.stageHistory), { status: target, at: new Date().toISOString() }].slice(
            -STAGE_HISTORY_MAX
          )
        ),
        rejectionReason: null,
        rejectionNote: null,
        rejectedAt: null,
      },
      include: APPLICATION_INCLUDE,
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "REJECT_UNDO",
        detail: `Penolakan dibatalkan — kembali ke tahap "${target}". Alasan: ${reason.slice(0, 300)}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, application: serializeApplication(updated) });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/undo-reject]", error);
    return NextResponse.json(
      { error: "Gagal membatalkan penolakan. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
