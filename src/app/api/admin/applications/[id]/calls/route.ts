// NR-24 — Riwayat panggilan telepon per pelamar.
// GET  /api/admin/applications/[id]/calls — daftar panggilan urut terbaru (semua role admin).
// POST /api/admin/applications/[id]/calls — catat hasil panggilan baru (OWNER/HR).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { CallLog } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

const CALL_RESULTS = ["DIANGGAT", "TIDAK_DIANGGAT", "SALAH_SAMBUNGAN"] as const;
type CallResult = (typeof CALL_RESULTS)[number];

const SUMMARY_MAX = 500;

function serializeCall(row: {
  id: string;
  result: string;
  summary: string;
  actor: string;
  createdAt: Date;
}): CallLog {
  return {
    id: row.id,
    result: (CALL_RESULTS as readonly string[]).includes(row.result)
      ? (row.result as CallResult)
      : "DIANGGAT",
    summary: row.summary,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const existing = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const rows = await db.applicationCall.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ calls: rows.map(serializeCall) });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/calls]", error);
    return NextResponse.json({ error: "Gagal memuat riwayat panggilan." }, { status: 500 });
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

    const existing = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    if (typeof data.result !== "string" || !(CALL_RESULTS as readonly string[]).includes(data.result)) {
      return NextResponse.json(
        { error: "Hasil panggilan harus DIANGGAT, TIDAK_DIANGGAT, atau SALAH_SAMBUNGAN." },
        { status: 400 }
      );
    }
    const result = data.result as CallResult;
    const summary = typeof data.summary === "string" ? data.summary.trim() : "";
    if (summary.length > SUMMARY_MAX) {
      return NextResponse.json(
        { error: `Ringkasan panggilan maksimal ${SUMMARY_MAX} karakter.` },
        { status: 400 }
      );
    }

    const created = await db.applicationCall.create({
      data: { applicationId: id, result, summary, actor: session.name },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "CALL_LOG",
        detail: `Panggilan dicatat: ${result} — ${summary.slice(0, 80)}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ call: serializeCall(created) }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/calls]", error);
    return NextResponse.json({ error: "Gagal mencatat panggilan. Coba lagi nanti." }, { status: 500 });
  }
}
