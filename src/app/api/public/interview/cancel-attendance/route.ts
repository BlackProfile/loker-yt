// POST /api/public/interview/cancel-attendance — pelamar menyatakan tidak bisa
// hadir pada sesi wawancara mendatang (pembatalan kehadiran mandiri).
// Body: { code: "LM-XXX", interviewId }
// Alur: validasi -> status sesi jadi CANCELLED -> slot sesi dibebaskan ->
// log + notifikasi admin + email konfirmasi ke pelamar.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queueEmail, pushNotification } from "@/lib/notify";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

// Rate limit in-memory per kode: 1 permintaan/detik + maks 6 per jam.
const RATE_MS = 1000;
const HOUR_MS = 3_600_000;
const MAX_PER_HOUR = 6;
const lastReqMap = new Map<string, number>();
const hourMap = new Map<string, number[]>();

/** True bila permintaan melewati batas; selain itu catat permintaan ini. */
function rateLimited(code: string): boolean {
  const now = Date.now();
  const last = lastReqMap.get(code) ?? 0;
  if (now - last < RATE_MS) return true;
  const stamps = (hourMap.get(code) ?? []).filter((ts) => now - ts < HOUR_MS);
  if (stamps.length >= MAX_PER_HOUR) return true;
  lastReqMap.set(code, now);
  stamps.push(now);
  hourMap.set(code, stamps);
  // Bersih-bersih map agar tidak tumbuh tanpa batas.
  if (lastReqMap.size > 500) {
    for (const [key, ts] of lastReqMap) {
      if (now - ts > 60_000) lastReqMap.delete(key);
    }
  }
  if (hourMap.size > 500) {
    for (const [key, arr] of hourMap) {
      if (arr.every((ts) => now - ts >= HOUR_MS)) hourMap.delete(key);
    }
  }
  return false;
}

const fmtWhen = (d: Date) =>
  d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
    const interviewId = typeof data.interviewId === "string" ? data.interviewId.trim() : "";
    if (!code || !interviewId) {
      return NextResponse.json({ error: "Kode pelacakan dan sesi wajib diisi." }, { status: 400 });
    }

    if (rateLimited(code)) {
      return NextResponse.json(
        { error: "Terlalu sering. Coba beberapa detik lagi." },
        { status: 429 },
      );
    }

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: {
        id: true,
        name: true,
        email: true,
        position: { select: { title: true } },
      },
    });
    if (!application) {
      return NextResponse.json({ error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
    }

    const interview = await db.interview.findFirst({
      where: { id: interviewId, applicationId: application.id },
    });
    if (!interview) {
      return NextResponse.json({ error: "Sesi wawancara tidak ditemukan." }, { status: 404 });
    }
    if (!["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"].includes(interview.status)) {
      return NextResponse.json(
        { error: "Sesi ini sudah selesai atau tidak aktif lagi." },
        { status: 400 },
      );
    }
    if (interview.scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Jadwal sesi ini sudah terlewat; tidak bisa dibatalkan." },
        { status: 400 },
      );
    }

    const scheduledWhen = fmtWhen(interview.scheduledAt);
    const positionTitle = application.position?.title ?? "-";

    // Transaksi: batalkan sesi + bebaskan slot lama milik sesi ini.
    await db.$transaction(async (tx) => {
      await tx.interview.update({
        where: { id: interview.id },
        data: { status: "CANCELLED" },
      });
      if (interview.slotId) {
        // Bebaskan slot hanya bila memang di-book oleh lamaran ini.
        await tx.interviewSlot.updateMany({
          where: { id: interview.slotId, bookedByApplicationId: application.id },
          data: { bookedByApplicationId: null, bookedAt: null },
        });
      }
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "INTERVIEW_CANCELLED",
        detail: `Pelamar menyatakan tidak bisa hadir wawancara ronde ${interview.round} pada ${scheduledWhen}`,
      },
    });

    void pushNotification({
      title: "Pelamar membatalkan kehadiran wawancara",
      body: `${application.name} tidak bisa hadir pada ronde ${interview.round} (${scheduledWhen}) untuk posisi ${positionTitle}.`,
      category: "INTERVIEW",
      applicationId: application.id,
    });

    void queueEmail({
      toEmail: application.email,
      subject: "Pembatalan kehadiran wawancara dikonfirmasi",
      body: [
        `Halo ${application.name},`,
        "",
        "Permintaan pembatalan kehadiranmu telah kami proses.",
        "",
        `Sesi yang dibatalkan: wawancara ronde ${interview.round}`,
        `Jadwal: ${scheduledWhen}`,
        `Posisi: ${positionTitle}`,
        "",
        "Bila kamu berubah pikiran dan ingin tetap melanjutkan proses, buka halaman cek status lamaran dengan kode " +
          code +
          " — bila tim membuka slot jadwal lain, kamu bisa memilih slot baru dari sana.",
        "",
        "Salam hangat,",
        "Tim Lumina Studio",
      ].join("\n"),
      kind: "INVITE",
      applicationId: application.id,
    });

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);

    return NextResponse.json({ ok: true, status: "CANCELLED" });
  } catch (error) {
    console.error("[POST /api/public/interview/cancel-attendance]", error);
    return NextResponse.json(
      { error: "Gagal membatalkan kehadiran. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
