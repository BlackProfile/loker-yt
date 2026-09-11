// POST /api/admin/applications/[id]/ai — jalankan AI screening untuk satu lamaran.
import { NextRequest, NextResponse } from "next/server";
import { analyzeApplication } from "@/lib/ai";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";

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

    const result = await analyzeApplication(id);
    if (!result) {
      return NextResponse.json({ error: "Analisis AI gagal, coba lagi." }, { status: 502 });
    }

    return NextResponse.json({
      score: result.score,
      summary: result.summary,
      recommendation: result.recommendation,
      aiAnalyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/ai]", errorMessage(error));
    return NextResponse.json({ error: "Analisis AI gagal, coba lagi." }, { status: 502 });
  }
}
