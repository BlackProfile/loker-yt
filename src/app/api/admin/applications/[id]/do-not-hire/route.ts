// /api/admin/applications/[id]/do-not-hire — bendera do-not-hire (NR-24, fitur 15).
// POLA KUNCI: alasan WAJIB saat memasang DAN saat melepas (minimal 4 karakter) —
// buka kunci juga harus memberi justifikasi, tercatat di timeline.
// POST   {reason} : pasang bendera (doNotHire=true + doNotHireReason).
// DELETE {reason} : lepas bendera (body JSON — alasan pembukaan wajib).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, serializeApplication } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const REASON_MIN = 4;
const REASON_MAX = 300;

/** Validasi & normalisasi alasan (dipakai POST dan DELETE). */
function parseReason(data: Record<string, unknown>): { reason: string } | { error: string } {
  const reason = typeof data.reason === "string" ? data.reason.trim() : "";
  if (reason.length < REASON_MIN) {
    return { error: `Alasan wajib diisi (minimal ${REASON_MIN} karakter).` };
  }
  return { reason: reason.slice(0, REASON_MAX) };
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
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const parsed = parseReason(data);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const app = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!app) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const updated = await db.application.update({
      where: { id },
      data: { doNotHire: true, doNotHireReason: parsed.reason },
      include: APPLICATION_INCLUDE,
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "DO_NOT_HIRE_SET",
        detail: `Do-not-hire dipasang. Alasan: ${parsed.reason}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, application: serializeApplication(updated) });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/do-not-hire]", error);
    return NextResponse.json({ error: "Gagal memasang do-not-hire. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const parsed = parseReason(data);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const app = await db.application.findUnique({
      where: { id },
      select: { id: true, doNotHire: true, doNotHireReason: true },
    });
    if (!app) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (!app.doNotHire) {
      return NextResponse.json({ error: "Lamaran ini tidak sedang ditandai do-not-hire." }, { status: 400 });
    }

    const updated = await db.application.update({
      where: { id },
      data: { doNotHire: false, doNotHireReason: null },
      include: APPLICATION_INCLUDE,
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "DO_NOT_HIRE_CLEAR",
        detail: `Do-not-hire dilepas. Alasan lama: ${app.doNotHireReason ?? "-"}. Alasan pembukaan: ${parsed.reason}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, application: serializeApplication(updated) });
  } catch (error) {
    console.error("[DELETE /api/admin/applications/[id]/do-not-hire]", error);
    return NextResponse.json({ error: "Gagal melepas do-not-hire. Coba lagi nanti." }, { status: 500 });
  }
}
