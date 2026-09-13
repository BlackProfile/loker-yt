// PATCH  /api/admin/slots/[id] — perbarui slot yang BELUM dibooking (OWNER/HR).
// DELETE /api/admin/slots/[id] — hapus slot yang BELUM dibooking (OWNER/HR).
// Slot yang sudah dipilih pelamar tidak boleh diubah/dihapus dari sini
// (batalkan sesi wawancaranya lewat /api/admin/interviews/[id]).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  sanitizeInterviewMode,
  sanitizeInterviewPlatform,
} from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { InterviewSlot } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Slot tidak ditemukan." };
const BOOKED = { error: "Slot sudah dipilih pelamar dan tidak bisa diubah." };

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

function serializeSlot(row: {
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
}): InterviewSlot {
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

const SLOT_INCLUDE = {
  position: { select: { title: true } },
  application: { select: { name: true } },
} as const;

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

    const existing = await db.interviewSlot.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (existing.bookedByApplicationId) {
      return NextResponse.json(BOOKED, { status: 409 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: {
      scheduledAt?: Date;
      durationMin?: number;
      mode?: string;
      platform?: string;
      meetingLink?: string | null;
      address?: string | null;
      interviewers?: string;
    } = {};

    if (data.scheduledAt !== undefined) {
      const parsed = typeof data.scheduledAt === "string" ? new Date(data.scheduledAt) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Tanggal tidak valid." }, { status: 400 });
      }
      updateData.scheduledAt = parsed;
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

    const nextMode = updateData.mode ?? existing.mode;
    const nextLink = updateData.meetingLink !== undefined ? updateData.meetingLink : existing.meetingLink;
    const nextAddress = updateData.address !== undefined ? updateData.address : existing.address;
    if (nextMode === "ONLINE" && !nextLink) {
      return NextResponse.json({ error: "Link meeting wajib diisi untuk slot online." }, { status: 400 });
    }
    if (nextMode === "ONSITE" && !nextAddress) {
      return NextResponse.json({ error: "Alamat wajib diisi untuk slot onsite." }, { status: 400 });
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const updated = await db.interviewSlot.update({
      where: { id },
      data: updateData,
      include: SLOT_INCLUDE,
    });

    await db.activityLog.create({
      data: {
        actor: session.name,
        action: "SLOT_UPDATED",
        detail: `Slot wawancara ${updated.position?.title ?? "-"} diubah ke ${updated.scheduledAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(serializeSlot(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/slots/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui slot. Coba lagi nanti." }, { status: 500 });
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

    const existing = await db.interviewSlot.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (existing.bookedByApplicationId) {
      return NextResponse.json(BOOKED, { status: 409 });
    }

    await db.interviewSlot.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        actor: session.name,
        action: "SLOT_DELETED",
        detail: `Slot wawancara ${existing.scheduledAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })} dihapus`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/slots/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus slot. Coba lagi nanti." }, { status: 500 });
  }
}
