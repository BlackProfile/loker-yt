// POST /api/admin/positions/[id]/shortlist — shortlist cerdas: LLM meranking
// 5 kandidat terbaik dari seluruh lamaran aktif posisi (JSON ketat, tervalidasi).
import { NextRequest, NextResponse } from "next/server";
import { rankPositionShortlist } from "@/lib/ai";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan." };

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

    const position = await db.position.findUnique({ where: { id }, select: { id: true, title: true } });
    if (!position) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const results = await rankPositionShortlist(id);
    if (results === null) {
      return NextResponse.json(
        { error: "Shortlist AI gagal dibuat atau belum ada kandidat aktif. Coba lagi." },
        { status: 502 },
      );
    }
    return NextResponse.json({ positionTitle: position.title, results });
  } catch (error) {
    console.error("[POST /api/admin/positions/[id]/shortlist]", errorMessage(error));
    return NextResponse.json({ error: "Shortlist AI gagal dibuat, coba lagi." }, { status: 502 });
  }
}
