// POST  /api/admin/hire/[id]/checkins — isi cek-in masa percobaan (day 30|60|90) (OWNER/HR).
// PATCH /api/admin/hire/[id]/checkins — edit rating/catatan cek-in yang sudah ada (OWNER/HR).
// dueAt dihitung dari hiredAt + n hari saat POST; completedAt = waktu pengisian.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Karyawan tidak ditemukan" };

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKIN_DAYS = [30, 60, 90];

/** Validasi rating opsional: null / 1..5 integer. Return pesan error atau null. */
function ratingError(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) {
    return "Rating harus angka 1-5.";
  }
  return null;
}

/** Validasi catatan opsional: null atau teks maks 2000 karakter. */
function sanitizeNotes(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  const notes = value.trim().slice(0, 2000);
  return notes.length > 0 ? notes : null;
}

function serializeCheckIn(row: {
  id: string;
  day: number;
  dueAt: Date | null;
  rating: number | null;
  notes: string | null;
  completedAt: Date | null;
}) {
  return {
    id: row.id,
    day: row.day,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    rating: row.rating,
    notes: row.notes,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const day = typeof data.day === "number" ? data.day : Number(data.day);
    if (!Number.isInteger(day) || !CHECKIN_DAYS.includes(day)) {
      return NextResponse.json({ error: "Cek-in hanya untuk hari ke-30, 60, atau 90." }, { status: 400 });
    }
    const ratingErr = ratingError(data.rating);
    if (ratingErr) {
      return NextResponse.json({ error: ratingErr }, { status: 400 });
    }
    const notes = sanitizeNotes(data.notes);
    if (notes === "invalid") {
      return NextResponse.json({ error: "Catatan harus berupa teks." }, { status: 400 });
    }

    const employee = await db.application.findUnique({
      where: { id },
      select: { hiredAt: true },
    });
    if (!employee || !employee.hiredAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const existing = await db.checkIn.findFirst({
      where: { applicationId: id, day },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `Cek-in hari ke-${day} sudah diisi. Gunakan opsi edit untuk mengubahnya.` },
        { status: 409 },
      );
    }

    const created = await db.checkIn.create({
      data: {
        applicationId: id,
        day,
        dueAt: new Date(employee.hiredAt.getTime() + day * DAY_MS),
        rating: typeof data.rating === "number" ? data.rating : null,
        notes: notes ?? null,
        completedAt: new Date(),
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "CHECK_IN",
        detail: `Cek-in hari ke-${day} selesai${created.rating ? ` — rating ${created.rating}/5` : ""}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(serializeCheckIn(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/hire/[id]/checkins]", error);
    return NextResponse.json({ error: "Gagal menyimpan cek-in. Coba lagi nanti." }, { status: 500 });
  }
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
    if (typeof data.id !== "string" || !data.id.trim()) {
      return NextResponse.json({ error: "ID cek-in wajib dikirim." }, { status: 400 });
    }

    const updateData: { rating?: number | null; notes?: string | null } = {};
    if (data.rating !== undefined) {
      const ratingErr = ratingError(data.rating);
      if (ratingErr) {
        return NextResponse.json({ error: ratingErr }, { status: 400 });
      }
      updateData.rating = typeof data.rating === "number" ? data.rating : null;
    }
    if (data.notes !== undefined) {
      const notes = sanitizeNotes(data.notes);
      if (notes === "invalid") {
        return NextResponse.json({ error: "Catatan harus berupa teks." }, { status: 400 });
      }
      updateData.notes = notes ?? null;
    }
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    // Pastikan cek-in milik karyawan pada URL.
    const existing = await db.checkIn.findFirst({
      where: { id: data.id.trim(), applicationId: id },
    });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const updated = await db.checkIn.update({
      where: { id: existing.id },
      data: updateData,
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "CHECK_IN",
        detail: `Cek-in hari ke-${existing.day} diperbarui`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(serializeCheckIn(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/hire/[id]/checkins]", error);
    return NextResponse.json({ error: "Gagal memperbarui cek-in. Coba lagi nanti." }, { status: 500 });
  }
}
