// PATCH  /api/admin/applications/[id] — update status/catatan/rating/tags/wawancara/talent pool (OWNER/HR).
// DELETE /api/admin/applications/[id] — hapus lamaran (OWNER/HR).
// Setiap perubahan dicatat ke ActivityLog.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, parseTags, serializeApplication } from "@/lib/seed";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

function labelOf(status: string): string {
  return (APPLICATION_STATUSES as string[]).includes(status) ? STATUS_LABELS[status as ApplicationStatus] : status;
}

function formatDateTimeId(value: Date): string {
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
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

    const updateData: {
      status?: string;
      adminNotes?: string | null;
      rating?: number;
      tags?: string;
      interviewAt?: Date | null;
      talentPool?: boolean;
    } = {};

    if (data.status !== undefined) {
      if (typeof data.status !== "string" || !(APPLICATION_STATUSES as string[]).includes(data.status)) {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      updateData.status = data.status;
    }

    if (data.adminNotes !== undefined) {
      if (data.adminNotes === null) {
        updateData.adminNotes = null;
      } else if (typeof data.adminNotes === "string") {
        const notes = data.adminNotes.trim();
        updateData.adminNotes = notes.length > 0 ? notes : null;
      } else {
        return NextResponse.json({ error: "Catatan admin harus berupa teks." }, { status: 400 });
      }
    }

    if (data.rating !== undefined) {
      if (typeof data.rating !== "number" || !Number.isInteger(data.rating) || data.rating < 0 || data.rating > 5) {
        return NextResponse.json({ error: "Rating harus angka bulat 0-5." }, { status: 400 });
      }
      updateData.rating = data.rating;
    }

    if (data.tags !== undefined) {
      if (!Array.isArray(data.tags)) {
        return NextResponse.json({ error: "Tags harus berupa array teks." }, { status: 400 });
      }
      const tags = data.tags
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      updateData.tags = JSON.stringify(tags);
    }

    if (data.interviewAt !== undefined) {
      if (data.interviewAt === null) {
        updateData.interviewAt = null;
      } else if (typeof data.interviewAt === "string") {
        const parsed = new Date(data.interviewAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Tanggal wawancara tidak valid." }, { status: 400 });
        }
        updateData.interviewAt = parsed;
      } else {
        return NextResponse.json({ error: "Tanggal wawancara tidak valid." }, { status: 400 });
      }
    }

    if (data.talentPool !== undefined) {
      if (typeof data.talentPool !== "boolean") {
        return NextResponse.json({ error: "talentPool harus berupa boolean." }, { status: 400 });
      }
      updateData.talentPool = data.talentPool;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const updated = await db.application.update({
      where: { id },
      data: updateData,
      include: APPLICATION_INCLUDE,
    });

    // Catat setiap field yang berubah ke ActivityLog
    const logs: { actor: string; action: string; detail: string }[] = [];
    if (updateData.status !== undefined && updateData.status !== existing.status) {
      logs.push({
        actor: session.name,
        action: "STATUS_CHANGE",
        detail: `${labelOf(existing.status)} → ${labelOf(updateData.status)}`,
      });
    }
    if (updateData.adminNotes !== undefined &&
      (updateData.adminNotes ?? "") !== (existing.adminNotes ?? "")) {
      logs.push({ actor: session.name, action: "NOTE", detail: "Catatan admin diperbarui" });
    }
    if (updateData.rating !== undefined && updateData.rating !== existing.rating) {
      logs.push({ actor: session.name, action: "RATING", detail: `Rating: ${existing.rating} → ${updateData.rating}` });
    }
    if (updateData.tags !== undefined && updateData.tags !== existing.tags) {
      const oldTags = parseTags(existing.tags).join(", ") || "-";
      const newTags = parseTags(updateData.tags).join(", ") || "-";
      logs.push({ actor: session.name, action: "TAGS", detail: `Tags: ${oldTags} → ${newTags}` });
    }
    if (updateData.interviewAt !== undefined) {
      const oldTime = existing.interviewAt ? existing.interviewAt.toISOString() : null;
      const newTime = updateData.interviewAt ? updateData.interviewAt.toISOString() : null;
      if (oldTime !== newTime) {
        logs.push({
          actor: session.name,
          action: "INTERVIEW_SCHEDULED",
          detail: updateData.interviewAt
            ? `Wawancara dijadwalkan ${formatDateTimeId(updateData.interviewAt)}`
            : "Jadwal wawancara dibatalkan",
        });
      }
    }
    if (updateData.talentPool !== undefined && updateData.talentPool !== existing.talentPool) {
      logs.push({
        actor: session.name,
        action: "TALENT_POOL",
        detail: updateData.talentPool ? "Ditambahkan ke talent pool" : "Dikeluarkan dari talent pool",
      });
    }
    if (logs.length > 0) {
      await db.activityLog.createMany({
        data: logs.map((log) => ({ ...log, applicationId: id })),
      });
    }

    return NextResponse.json(serializeApplication(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/applications/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui lamaran. Coba lagi nanti." }, { status: 500 });
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

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.application.delete({ where: { id } });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/applications/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
