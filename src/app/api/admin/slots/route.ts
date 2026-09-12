// GET  /api/admin/slots — daftar slot wawancara self-service + status booking (semua role).
// POST /api/admin/slots — buka slot jadwal baru untuk dipilih pelamar (OWNER/HR).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  sanitizeInterviewMode,
  sanitizeInterviewPlatform,
} from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { InterviewMode, InterviewPlatform, InterviewSlot } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

type SlotRow = {
  id: string;
  positionId: string | null;
  position: { title: string } | null;
  scheduledAt: Date;
  durationMin: number;
  mode: string;
  platform: string;
  meetingLink: string | null;
  address: string | null;
  interviewers: string;
  bookedByApplicationId: string | null;
  application: { name: string } | null;
  bookedAt: Date | null;
  createdAt: Date;
};

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

function serializeSlot(row: SlotRow): InterviewSlot {
  return {
    id: row.id,
    positionId: row.positionId,
    positionTitle: row.position?.title ?? null,
    scheduledAt: row.scheduledAt.toISOString(),
    durationMin: row.durationMin,
    mode: sanitizeInterviewMode(row.mode),
    platform: sanitizeInterviewPlatform(row.platform),
    meetingLink: row.meetingLink,
    address: row.address,
    interviewers: parseInterviewers(row.interviewers),
    bookedByApplicationId: row.bookedByApplicationId,
    bookedByName: row.application?.name ?? null,
    bookedAt: row.bookedAt ? row.bookedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const rows = await db.interviewSlot.findMany({
      orderBy: { scheduledAt: "asc" },
      take: 500,
      include: {
        position: { select: { title: true } },
        application: { select: { name: true } },
      },
    });
    return NextResponse.json(rows.map(serializeSlot));
  } catch (error) {
    console.error("[GET /api/admin/slots]", error);
    return NextResponse.json({ error: "Gagal memuat slot wawancara." }, { status: 500 });
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

    const positionId = typeof data.positionId === "string" ? data.positionId.trim() : "";
    if (!positionId) {
      return NextResponse.json({ error: "Posisi wajib dipilih." }, { status: 400 });
    }
    const position = await db.position.findUnique({ where: { id: positionId }, select: { id: true } });
    if (!position) {
      return NextResponse.json({ error: "Posisi tidak ditemukan." }, { status: 404 });
    }

    const scheduledAt = typeof data.scheduledAt === "string" ? new Date(data.scheduledAt) : null;
    if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
      return NextResponse.json({ error: "Tanggal dan jam slot tidak valid." }, { status: 400 });
    }

    let durationMin = 45;
    if (typeof data.durationMin === "number" && Number.isInteger(data.durationMin)) {
      durationMin = Math.min(480, Math.max(10, data.durationMin));
    }

    const mode: InterviewMode = sanitizeInterviewMode(data.mode);
    const platform: InterviewPlatform = sanitizeInterviewPlatform(data.platform);

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
      return NextResponse.json({ error: "Link meeting wajib diisi untuk slot online." }, { status: 400 });
    }
    if (mode === "ONSITE" && !address) {
      return NextResponse.json({ error: "Alamat wajib diisi untuk slot onsite." }, { status: 400 });
    }

    const interviewers = Array.isArray(data.interviewers)
      ? data.interviewers
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim().slice(0, 60))
          .filter((item) => item.length > 0)
          .slice(0, 6)
      : [];

    const created = await db.interviewSlot.create({
      data: {
        positionId,
        scheduledAt,
        durationMin,
        mode,
        platform,
        meetingLink,
        address,
        interviewers: JSON.stringify(interviewers),
      },
      include: {
        position: { select: { title: true } },
        application: { select: { name: true } },
      },
    });

    await db.activityLog.create({
      data: {
        actor: session.name,
        action: "SLOT_CREATED",
        detail: `Slot wawancara ${created.position?.title ?? "-"} dibuka ${scheduledAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`,
      },
    });

    // Slot baru memengaruhi halaman status pelamar (daftar jadwal bisa dipilih).
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(serializeSlot(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/slots]", error);
    return NextResponse.json({ error: "Gagal membuka slot wawancara. Coba lagi nanti." }, { status: 500 });
  }
}
