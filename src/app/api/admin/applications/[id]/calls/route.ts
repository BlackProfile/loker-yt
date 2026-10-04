// /api/admin/applications/[id]/calls — log panggilan telepon per lamaran
// (NR-24, fitur 9). Saluran utama posisi on-site: Supir, POS, PRT.
// GET  : daftar panggilan (urut createdAt desc).
// POST : catat panggilan {outcome, note?} — outcome salah satu CALL_OUTCOMES.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallLog, type CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const NOTE_MAX = 1000;

/** Serialisasi record CallLog menjadi tipe `CallLog` (outcome disanitasi). */
function serializeCallLog(row: {
  id: string;
  applicationId: string;
  outcome: string;
  note: string | null;
  actor: string;
  createdAt: Date;
}): CallLog {
  const outcome: CallOutcome = (CALL_OUTCOMES as string[]).includes(row.outcome)
    ? (row.outcome as CallOutcome)
    : "DIANGKAT";
  return {
    id: row.id,
    applicationId: row.applicationId,
    outcome,
    note: row.note,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadCalls(applicationId: string): Promise<CallLog[]> {
  const rows = await db.callLog.findMany({
    where: { applicationId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(serializeCallLog);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;
    const application = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    const calls = await loadCalls(id);
    return NextResponse.json({ ok: true, calls });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/calls]", error);
    return NextResponse.json({ error: "Gagal memuat log panggilan. Coba lagi nanti." }, { status: 500 });
  }
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

    const outcomeRaw = typeof data.outcome === "string" ? data.outcome : "";
    if (!(CALL_OUTCOMES as string[]).includes(outcomeRaw)) {
      return NextResponse.json({ error: "Hasil panggilan tidak valid." }, { status: 400 });
    }
    const outcome = outcomeRaw as CallOutcome;
    const note =
      typeof data.note === "string" && data.note.trim().length > 0 ? data.note.trim() : null;
    if (note && note.length > NOTE_MAX) {
      return NextResponse.json({ error: `Catatan maksimal ${NOTE_MAX} karakter.` }, { status: 400 });
    }

    const application = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.callLog.create({
      data: {
        applicationId: id,
        outcome,
        note,
        actor: session.name,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "CALL_LOGGED",
        detail: `Panggilan: ${CALL_OUTCOME_LABELS[outcome]}${note ? ` — ${note.slice(0, 120)}` : ""}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    const calls = await loadCalls(id);
    return NextResponse.json({ ok: true, calls });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/calls]", error);
    return NextResponse.json({ error: "Gagal mencatat panggilan. Coba lagi nanti." }, { status: 500 });
  }
}
