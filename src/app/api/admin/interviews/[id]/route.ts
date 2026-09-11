// PATCH  /api/admin/interviews/[id] — perbarui sesi wawancara (jadwal, status, scorecard, hasil).
// DELETE /api/admin/interviews/[id] — hapus sesi wawancara.
// Rekomendasi hasil menggerakkan pipeline: TOLAK -> REJECTED, CADANGAN -> talent pool.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  parseScoreRecord,
  parseTags,
  sanitizeInterviewMode,
  sanitizeInterviewPlatform,
  sanitizeInterviewRecommendation,
  sanitizeInterviewStatus,
  serializeApplication,
  serializeInterview,
} from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Sesi wawancara tidak ditemukan." };

function formatDateTimeId(value: Date): string {
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/** Sinkronkan Application.interviewAt ke sesi aktif terdekat (bukan COMPLETED/CANCELLED/NO_SHOW). */
async function syncApplicationInterviewAt(applicationId: string): Promise<void> {
  const next = await db.interview.findFirst({
    where: { applicationId, status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"] } },
    orderBy: { scheduledAt: "asc" },
    select: { scheduledAt: true },
  });
  await db.application.update({
    where: { id: applicationId },
    data: { interviewAt: next ? next.scheduledAt : null },
  });
}

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

    const existing = await db.interview.findUnique({
      where: { id },
      include: { application: { include: APPLICATION_INCLUDE } },
    });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const updateData: {
      scheduledAt?: Date;
      durationMin?: number;
      mode?: string;
      platform?: string;
      meetingLink?: string | null;
      address?: string | null;
      interviewers?: string;
      status?: string;
      scores?: string | null;
      recommendation?: string | null;
      notes?: string | null;
      recordingUrl?: string | null;
      completedAt?: Date | null;
      rescheduleReason?: string | null;
      rescheduleProposedAt?: Date | null;
      reminderDaySent?: boolean;
      reminderHourSent?: boolean;
    } = {};

    if (data.scheduledAt !== undefined) {
      const parsed = typeof data.scheduledAt === "string" ? new Date(data.scheduledAt) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Tanggal tidak valid." }, { status: 400 });
      }
      updateData.scheduledAt = parsed;
      // Jadwal berubah -> status kembali terjadwal & usulan reschedule pelamar selesai diproses.
      updateData.status = "SCHEDULED";
      updateData.rescheduleReason = null;
      updateData.rescheduleProposedAt = null;
      updateData.reminderDaySent = false;
      updateData.reminderHourSent = false;
    }

    if (data.durationMin !== undefined) {
      if (typeof data.durationMin !== "number" || !Number.isInteger(data.durationMin) || data.durationMin < 10 || data.durationMin > 480) {
        return NextResponse.json({ error: "Durasi harus 10-480 menit." }, { status: 400 });
      }
      updateData.durationMin = data.durationMin;
    }

    if (data.mode !== undefined) updateData.mode = sanitizeInterviewMode(data.mode);
    if (data.platform !== undefined) updateData.platform = sanitizeInterviewPlatform(data.platform);

    if (data.meetingLink !== undefined) {
      if (data.meetingLink === null || data.meetingLink === "") {
        updateData.meetingLink = null;
      } else if (typeof data.meetingLink === "string") {
        const link = data.meetingLink.trim();
        if (!/^https?:\/\//i.test(link)) {
          return NextResponse.json({ error: "Link meeting harus diawali http:// atau https://." }, { status: 400 });
        }
        updateData.meetingLink = link.slice(0, 500);
      } else {
        return NextResponse.json({ error: "Link meeting tidak valid." }, { status: 400 });
      }
    }

    if (data.address !== undefined) {
      updateData.address =
        typeof data.address === "string" && data.address.trim()
          ? data.address.trim().slice(0, 300)
          : null;
    }

    if (data.interviewers !== undefined) {
      if (!Array.isArray(data.interviewers)) {
        return NextResponse.json({ error: "Pewawancara harus berupa array teks." }, { status: 400 });
      }
      const names = data.interviewers
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 60))
        .filter((item) => item.length > 0)
        .slice(0, 6);
      updateData.interviewers = JSON.stringify(names);
    }

    // Status: transisi eksplisit (CONFIRMED/NO_SHOW/CANCELLED dari admin; COMPLETED via complete).
    let completing = false;
    if (data.dismissReschedule === true) {
      // Admin menolak usulan ubah jadwal pelamar -> kembali ke jadwal awal.
      updateData.status = "SCHEDULED";
      updateData.rescheduleReason = null;
      updateData.rescheduleProposedAt = null;
    }
    if (data.status !== undefined) {
      const status = sanitizeInterviewStatus(data.status);
      if (!status) {
        return NextResponse.json({ error: "Status wawancara tidak valid." }, { status: 400 });
      }
      if (status === "RESCHEDULE_REQUESTED") {
        return NextResponse.json({ error: "Status tersebut hanya diatur oleh pelamar." }, { status: 400 });
      }
      updateData.status = status;
      if (status === "COMPLETED") {
        completing = true;
        updateData.completedAt = new Date();
      } else if (status === "SCHEDULED" || status === "CONFIRMED") {
        updateData.completedAt = null;
      }
    }

    // Scorecard hasil wawancara (sama seperti rubrik: int 1..5, maks 8 kriteria)
    if (data.scores !== undefined) {
      let raw: unknown = data.scores;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return NextResponse.json({ error: "Skor tidak valid." }, { status: 400 });
        }
      }
      if (raw === null) {
        updateData.scores = null;
      } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const scores: Record<string, number> = {};
        for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
          const key = rawKey.trim().slice(0, 120);
          if (!key || scores[key] !== undefined) continue;
          if (typeof rawValue !== "number" || !Number.isInteger(rawValue) || rawValue < 1 || rawValue > 5) continue;
          scores[key] = rawValue;
          if (Object.keys(scores).length >= 8) break;
        }
        updateData.scores = Object.keys(scores).length > 0 ? JSON.stringify(scores) : null;
      } else {
        return NextResponse.json({ error: "Skor harus objek {kriteria: nilai}." }, { status: 400 });
      }
    }

    if (data.recommendation !== undefined) {
      updateData.recommendation = data.recommendation === null
        ? null
        : sanitizeInterviewRecommendation(data.recommendation);
    }

    if (data.notes !== undefined) {
      updateData.notes =
        typeof data.notes === "string" && data.notes.trim()
          ? data.notes.trim().slice(0, 2000)
          : null;
    }

    if (data.recordingUrl !== undefined) {
      if (data.recordingUrl === null || data.recordingUrl === "") {
        updateData.recordingUrl = null;
      } else if (typeof data.recordingUrl === "string") {
        const url = data.recordingUrl.trim();
        if (!/^https?:\/\//i.test(url)) {
          return NextResponse.json({ error: "URL rekaman harus diawali http:// atau https://." }, { status: 400 });
        }
        updateData.recordingUrl = url.slice(0, 500);
      } else {
        return NextResponse.json({ error: "URL rekaman tidak valid." }, { status: 400 });
      }
    }

    // Menyimpan scorecard/rekomendasi sekaligus menandai selesai bila belum.
    if (
      !completing &&
      (updateData.scores !== undefined || updateData.recommendation !== undefined) &&
      existing.status !== "COMPLETED"
    ) {
      completing = true;
      updateData.status = "COMPLETED";
      updateData.completedAt = new Date();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const updated = await db.interview.update({
      where: { id },
      data: updateData,
    });

    // Catat aktivitas
    const logs: { actor: string; action: string; detail: string }[] = [];
    if (updateData.scheduledAt) {
      logs.push({
        actor: session.name,
        action: "INTERVIEW_SCHEDULED",
        detail: `Wawancara ronde ${updated.round} diubah ke ${formatDateTimeId(updateData.scheduledAt)}`,
      });
    }
    if (updateData.status === "COMPLETED") {
      const rec = updateData.recommendation ?? existing.recommendation;
      const avg = parseScoreRecord(updateData.scores ?? existing.scores);
      const avgVal = avg
        ? (Object.values(avg).reduce((a, b) => a + b, 0) / Object.values(avg).length).toFixed(1)
        : null;
      logs.push({
        actor: session.name,
        action: "INTERVIEW_COMPLETED",
        detail: `Wawancara ronde ${updated.round} selesai${avgVal ? ` (rata-rata skor ${avgVal})` : ""}${rec ? ` — rekomendasi: ${rec}` : ""}`,
      });
    } else if (updateData.status === "NO_SHOW") {
      logs.push({ actor: session.name, action: "INTERVIEW_NO_SHOW", detail: `Pelamar tidak hadir ronde ${updated.round}` });
    } else if (updateData.status === "CANCELLED") {
      logs.push({ actor: session.name, action: "INTERVIEW_CANCELLED", detail: `Wawancara ronde ${updated.round} dibatalkan` });
    }
    if (updateData.status === "CONFIRMED" && existing.status !== "CONFIRMED") {
      logs.push({ actor: session.name, action: "INTERVIEW_CONFIRMED", detail: `Kehadiran ronde ${updated.round} dikonfirmasi admin` });
    }
    if (logs.length > 0) {
      await db.activityLog.createMany({ data: logs.map((l) => ({ ...l, applicationId: existing.applicationId })) });
    }

    // Rekomendasi menggerakkan pipeline
    const recommendation = updateData.recommendation ?? null;
    if (recommendation === "TOLAK") {
      const app = await db.application.update({
        where: { id: existing.applicationId },
        data: {
          status: "REJECTED",
          rejectionReason: "LAINNYA",
          rejectionNote:
            (updateData.notes ?? existing.notes)?.trim().slice(0, 1000) || null,
          rejectedAt: new Date(),
        },
        include: APPLICATION_INCLUDE,
      });
      await db.activityLog.create({
        data: {
          applicationId: existing.applicationId,
          actor: session.name,
          action: "STATUS_CHANGE",
          detail: `Ditolak dari hasil wawancara ronde ${updated.round}`,
        },
      });
      await syncApplicationInterviewAt(existing.applicationId);
      void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
      return NextResponse.json({ interview: serializeInterview(updated), application: serializeApplication(app) });
    }
    if (recommendation === "CADANGAN") {
      await db.application.update({
        where: { id: existing.applicationId },
        data: { talentPool: true },
      });
      await db.activityLog.create({
        data: {
          applicationId: existing.applicationId,
          actor: session.name,
          action: "TALENT_POOL",
          detail: "Dicadangkan dari hasil wawancara (talent pool)",
        },
      });
    }
    if (updateData.scheduledAt || updateData.status) {
      await syncApplicationInterviewAt(existing.applicationId);
    }

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
    return NextResponse.json({ interview: serializeInterview(updated) });
  } catch (error) {
    console.error("[PATCH /api/admin/interviews/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui wawancara. Coba lagi nanti." }, { status: 500 });
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

    const existing = await db.interview.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.interview.delete({ where: { id } });
    await syncApplicationInterviewAt(existing.applicationId);
    await db.activityLog.create({
      data: {
        applicationId: existing.applicationId,
        actor: session.name,
        action: "INTERVIEW_CANCELLED",
        detail: `Wawancara ronde ${existing.round} dihapus`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/interviews/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus wawancara. Coba lagi nanti." }, { status: 500 });
  }
}

// parseTags tetap diekspor via seed untuk route lain
void parseTags;
