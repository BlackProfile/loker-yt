// POST /api/public/interview/reschedule-slot — pelamar memindahkan SENDIRI jadwal
// wawancara mendatang ke slot terbuka lain (tanpa perlu persetujuan admin).
// Body: { code: "LM-XXX", interviewId, slotId }
// Alur: validasi -> klaim slot baru secara atomik -> bebaskan slot lama ->
// perbarui sesi dari data slot baru (status kembali CONFIRMED).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queueEmail, pushNotification } from "@/lib/notify";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { INTERVIEW_PLATFORM_LABELS, type InterviewPlatform } from "@/lib/types";

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

function parseInterviewers(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

/** Sinyal khusus: slot target sudah diambil pelamar lain (dipetakan ke 409). */
class SlotTakenError extends Error {}

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
    const slotId = typeof data.slotId === "string" ? data.slotId.trim() : "";
    if (!code || !interviewId || !slotId) {
      return NextResponse.json(
        { error: "Kode pelacakan, sesi, dan slot baru wajib dipilih." },
        { status: 400 },
      );
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
        positionId: true,
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
        { error: "Jadwal sesi ini sudah terlewat; tidak bisa dipindahkan." },
        { status: 400 },
      );
    }

    const slot = await db.interviewSlot.findUnique({ where: { id: slotId } });
    if (!slot) {
      return NextResponse.json({ error: "Slot baru tidak ditemukan." }, { status: 404 });
    }
    if (slot.scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Slot sudah terlewat; pilih jadwal lain." }, { status: 400 });
    }
    if (slot.positionId && slot.positionId !== application.positionId) {
      return NextResponse.json({ error: "Slot bukan untuk posisi lamaran ini." }, { status: 400 });
    }
    if (interview.slotId && interview.slotId === slot.id) {
      return NextResponse.json(
        { error: "Slot ini sudah menjadi jadwal sesi ini; pilih slot lain." },
        { status: 400 },
      );
    }

    const interviewers = parseInterviewers(slot.interviewers);
    const oldScheduledAt = interview.scheduledAt;

    // Transaksi: klaim slot baru atomik (anti tabrakan antar pelamar), bebaskan
    // slot lama milik sesi ini, lalu perbarui sesi dari data slot baru.
    const updated = await db.$transaction(async (tx) => {
      const claimed = await tx.interviewSlot.updateMany({
        where: { id: slot.id, bookedByApplicationId: null },
        data: { bookedByApplicationId: application.id, bookedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new SlotTakenError();
      }
      if (interview.slotId) {
        // Bebaskan slot lama hanya bila memang di-book oleh lamaran ini.
        await tx.interviewSlot.updateMany({
          where: { id: interview.slotId, bookedByApplicationId: application.id },
          data: { bookedByApplicationId: null, bookedAt: null },
        });
      }
      const row = await tx.interview.update({
        where: { id: interview.id },
        data: {
          scheduledAt: slot.scheduledAt,
          durationMin: slot.durationMin,
          mode: slot.mode,
          platform: slot.platform,
          meetingLink: slot.meetingLink,
          address: slot.address,
          interviewers: JSON.stringify(interviewers),
          slotId: slot.id,
          status: "CONFIRMED",
          rescheduleReason: null,
          rescheduleProposedAt: null,
        },
      });
      // Sinkronkan kolom interviewAt lama (dipakai kalender/overview admin).
      await tx.application.update({
        where: { id: application.id },
        data: { interviewAt: slot.scheduledAt },
      });
      return row;
    });

    const oldWhen = fmtWhen(oldScheduledAt);
    const newWhen = fmtWhen(slot.scheduledAt);
    const positionTitle = application.position?.title ?? "-";
    const isOnline = slot.mode !== "ONSITE";
    const platformLabel =
      INTERVIEW_PLATFORM_LABELS[slot.platform as InterviewPlatform] ?? slot.platform;

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "INTERVIEW_RESCHEDULED",
        detail: `Pelamar memindahkan jadwal wawancara ronde ${interview.round}: ${oldWhen} -> ${newWhen}`,
      },
    });

    void pushNotification({
      title: "Jadwal wawancara dipindahkan pelamar",
      body: `${application.name} memindahkan jadwal ronde ${interview.round} (${oldWhen}) ke ${newWhen} untuk posisi ${positionTitle}.`,
      category: "INTERVIEW",
      applicationId: application.id,
    });

    void queueEmail({
      toEmail: application.email,
      subject: "Jadwal wawancara diperbarui",
      body: [
        `Halo ${application.name},`,
        "",
        `Jadwal wawancaramu untuk posisi ${positionTitle} telah diperbarui langsung melalui halaman status lamaran.`,
        "",
        `Jadwal lama: ${oldWhen}`,
        `Jadwal baru: ${newWhen}`,
        `Durasi: ${slot.durationMin} menit`,
        isOnline
          ? `Platform: ${platformLabel}`
          : `Lokasi: ${slot.address ?? "akan diinformasikan tim"}`,
        ...(isOnline && slot.meetingLink ? ["Link meeting: " + slot.meetingLink] : []),
        ...(interviewers.length > 0 ? ["Pewawancara: " + interviewers.join(", ")] : []),
        "",
        `Buka halaman cek status lamaran dengan kode ${code} untuk melihat detail terbaru.`,
        "",
        "Salam hangat,",
        "Tim Lumina Studio",
      ].join("\n"),
      kind: "INVITE",
      applicationId: application.id,
    });

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);

    return NextResponse.json({
      ok: true,
      status: updated.status,
      scheduledAt: slot.scheduledAt.toISOString(),
    });
  } catch (error) {
    if (error instanceof SlotTakenError) {
      return NextResponse.json(
        { error: "Slot baru saja diambil orang lain, pilih yang lain." },
        { status: 409 },
      );
    }
    console.error("[POST /api/public/interview/reschedule-slot]", error);
    return NextResponse.json(
      { error: "Gagal memindahkan jadwal. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
