// POST /api/public/interview/respond — aksi pelamar dari halaman status (pakai kode tracking):
//   CONFIRM  -> konfirmasi kehadiran
//   RESCHEDULE -> ajukan ubah jadwal (usulan waktu + alasan)
//   CANCEL_REQUEST -> batalkan usulan ubah jadwal sendiri
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

// Rate limit sederhana per kode (mirip endpoint track): 1 permintaan / detik.
const rateMap = new Map<string, number>();
const RATE_MS = 1000;

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
    const interviewId = typeof data.interviewId === "string" ? data.interviewId.trim() : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    if (!code || !interviewId) {
      return NextResponse.json({ error: "Kode pelacakan dan sesi wajib diisi." }, { status: 400 });
    }
    if (!["CONFIRM", "RESCHEDULE", "CANCEL_REQUEST"].includes(action)) {
      return NextResponse.json({ error: "Aksi tidak valid." }, { status: 400 });
    }

    // Rate limit perintah per kode
    const now = Date.now();
    const last = rateMap.get(`${code}:${interviewId}`) ?? 0;
    if (now - last < RATE_MS) {
      return NextResponse.json({ error: "Terlalu sering. Coba beberapa detik lagi." }, { status: 429 });
    }
    rateMap.set(`${code}:${interviewId}`, now);
    if (rateMap.size > 500) {
      for (const [key, ts] of rateMap) {
        if (now - ts > 60_000) rateMap.delete(key);
      }
    }

    const application = await db.application.findUnique({ where: { trackingCode: code }, select: { id: true, name: true } });
    if (!application) {
      return NextResponse.json({ error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
    }

    const interview = await db.interview.findFirst({
      where: { id: interviewId, applicationId: application.id },
    });
    if (!interview) {
      return NextResponse.json({ error: "Sesi wawancara tidak ditemukan." }, { status: 404 });
    }
    if (!["SCHEDULED", "RESCHEDULE_REQUESTED"].includes(interview.status)) {
      return NextResponse.json(
        { error: "Sesi ini sudah dikonfirmasi atau tidak aktif lagi." },
        { status: 400 },
      );
    }

    if (action === "CONFIRM") {
      const updated = await db.interview.update({
        where: { id: interview.id },
        data: { status: "CONFIRMED", rescheduleReason: null, rescheduleProposedAt: null },
      });
      await db.activityLog.create({
        data: {
          applicationId: application.id,
          actor: "Pelamar",
          action: "INTERVIEW_CONFIRMED",
          detail: `Pelamar mengonfirmasi kehadiran wawancara ronde ${interview.round}`,
        },
      });
      void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
      return NextResponse.json({ ok: true, status: updated.status });
    }

    if (action === "RESCHEDULE") {
      const proposedAt =
        typeof data.proposedAt === "string" && data.proposedAt ? new Date(data.proposedAt) : null;
      if (!proposedAt || Number.isNaN(proposedAt.getTime())) {
        return NextResponse.json({ error: "Usulan waktu baru tidak valid." }, { status: 400 });
      }
      const reason =
        typeof data.reason === "string" && data.reason.trim()
          ? data.reason.trim().slice(0, 500)
          : null;
      const updated = await db.interview.update({
        where: { id: interview.id },
        data: {
          status: "RESCHEDULE_REQUESTED",
          rescheduleProposedAt: proposedAt,
          rescheduleReason: reason,
        },
      });
      await db.activityLog.create({
        data: {
          applicationId: application.id,
          actor: "Pelamar",
          action: "INTERVIEW_RESCHEDULE",
          detail: `Pelamar mengajukan ubah jadwal ronde ${interview.round} ke ${proposedAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}${reason ? ` — alasan: ${reason}` : ""}`,
        },
      });
      void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
      return NextResponse.json({ ok: true, status: updated.status });
    }

    // CANCEL_REQUEST
    const updated = await db.interview.update({
      where: { id: interview.id },
      data: { status: "SCHEDULED", rescheduleReason: null, rescheduleProposedAt: null },
    });
    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "INTERVIEW_RESCHEDULE",
        detail: `Pelamar membatalkan usulan ubah jadwal ronde ${interview.round}`,
      },
    });
    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
    return NextResponse.json({ ok: true, status: updated.status });
  } catch (error) {
    console.error("[POST /api/public/interview/respond]", error);
    return NextResponse.json({ error: "Gagal memproses permintaan. Coba lagi nanti." }, { status: 500 });
  }
}
