// POST /api/admin/applications/[id]/ai-summary — buat ringkasan AI 2-3 kalimat
// (kekuatan/risiko/rekomendasi) dari experience, motivation, aiScore, transcript,
// dan cvText. Disimpan ke application.aiSummary + aiAnalyzedAt, dicatat ke
// ActivityLog (AI_SUMMARY), dan disebarkan realtime ke panel admin.
import { NextRequest, NextResponse } from "next/server";
import { generateApplicationSummaryText } from "@/lib/ai";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, { status: anySession ? 403 : 401 });
    }
    const { id } = await params;

    const exists = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const summary = await generateApplicationSummaryText(id);
    if (!summary) {
      return NextResponse.json({ error: "Ringkasan AI gagal dibuat, coba lagi." }, { status: 502 });
    }

    const now = new Date();
    await db.application.update({
      where: { id },
      data: { aiSummary: summary, aiAnalyzedAt: now },
    });
    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "AI_SUMMARY",
        detail: "Ringkasan AI dibuat dari data lamaran, skor screening, transkrip, dan CV",
      },
    });

    // Realtime: ringkasan tersimpan — segarkan daftar & statistik admin.
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ aiSummary: summary, aiAnalyzedAt: now.toISOString() });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/ai-summary]", errorMessage(error));
    return NextResponse.json({ error: "Ringkasan AI gagal dibuat, coba lagi." }, { status: 502 });
  }
}
