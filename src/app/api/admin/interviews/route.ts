// GET  /api/admin/interviews — daftar semua sesi wawancara (semua role), urut terdekat.
// POST /api/admin/interviews — jadwalkan wawancara baru (OWNER/HR).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  sanitizeInterviewMode,
  sanitizeInterviewPlatform,
  serializeInterview,
} from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { Interview } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

type InterviewWithContext = Interview & {
  applicationName?: string;
  applicationPhone?: string;
  positionTitle?: string | null;
  trackingCode?: string;
};

function withContext(
  record: Parameters<typeof serializeInterview>[0],
  app: { name: string; phone: string; trackingCode: string | null; position: { title: string } | null },
): InterviewWithContext {
  return {
    ...serializeInterview(record),
    applicationName: app.name,
    applicationPhone: app.phone,
    positionTitle: app.position?.title ?? null,
    trackingCode: app.trackingCode ?? "",
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const rows = await db.interview.findMany({
      orderBy: { scheduledAt: "asc" },
      include: {
        application: {
          select: { name: true, phone: true, trackingCode: true, position: { select: { title: true } } },
        },
      },
    });
    return NextResponse.json(
      rows.map((row) => withContext(row, row.application)),
    );
  } catch (error) {
    console.error("[GET /api/admin/interviews]", error);
    return NextResponse.json({ error: "Gagal memuat jadwal wawancara." }, { status: 500 });
  }
}

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

    const applicationId = typeof data.applicationId === "string" ? data.applicationId.trim() : "";
    if (!applicationId) {
      return NextResponse.json({ error: "Lamaran wajib dipilih." }, { status: 400 });
    }

    const application = await db.application.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!application) {
      return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
    }

    const scheduledAt = typeof data.scheduledAt === "string" ? new Date(data.scheduledAt) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: "Tanggal dan jam wawancara tidak valid." }, { status: 400 });
    }

    const mode = sanitizeInterviewMode(data.mode);
    const platform = sanitizeInterviewPlatform(data.platform);

    let meetingLink: string | null = null;
    if (typeof data.meetingLink === "string" && data.meetingLink.trim()) {
      const link = data.meetingLink.trim();
      if (!/^https?:\/\//i.test(link)) {
        return NextResponse.json({ error: "Link meeting harus diawali http:// atau https://." }, { status: 400 });
      }
      meetingLink = link.slice(0, 500);
    }

    let address: string | null = null;
    if (typeof data.address === "string" && data.address.trim()) {
      address = data.address.trim().slice(0, 300);
    }
    if (mode === "ONLINE" && !meetingLink) {
      return NextResponse.json({ error: "Link meeting wajib diisi untuk wawancara online." }, { status: 400 });
    }
    if (mode === "ONSITE" && !address) {
      return NextResponse.json({ error: "Alamat wajib diisi untuk wawancara onsite." }, { status: 400 });
    }

    let durationMin = 45;
    if (typeof data.durationMin === "number" && Number.isInteger(data.durationMin)) {
      durationMin = Math.min(480, Math.max(10, data.durationMin));
    }

    const interviewers = Array.isArray(data.interviewers)
      ? data.interviewers
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 60))
          .filter((item) => item.length > 0)
          .slice(0, 6)
      : [];

    // Ronde otomatis: sesi terakhir + 1
    const lastRound = await db.interview.findFirst({
      where: { applicationId },
      orderBy: { round: "desc" },
      select: { round: true },
    });

    const created = await db.interview.create({
      data: {
        applicationId,
        round: (lastRound?.round ?? 0) + 1,
        mode,
        platform,
        meetingLink,
        address,
        scheduledAt,
        durationMin,
        interviewers: JSON.stringify(interviewers),
        status: "SCHEDULED",
      },
    });

    // Sinkronkan kolom interviewAt lama (dipakai kalender/overview) ke sesi terdekat aktif.
    await db.application.update({ where: { id: applicationId }, data: { interviewAt: scheduledAt } });

    await db.activityLog.create({
      data: {
        applicationId,
        actor: session.name,
        action: "INTERVIEW_SCHEDULED",
        detail: `Wawancara ronde ${created.round} dijadwalkan ${scheduledAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
    return NextResponse.json(withContext(created, application), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/interviews]", error);
    return NextResponse.json({ error: "Gagal menjadwalkan wawancara. Coba lagi nanti." }, { status: 500 });
  }
}
