// POST /api/admin/applications/[id]/ai-reply — draft balasan email/WhatsApp sesuai status via AI.
import { NextRequest, NextResponse } from "next/server";
import { generateReplyDraft } from "@/lib/ai";
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

    const draft = await generateReplyDraft(id);
    if (!draft) {
      return NextResponse.json({ error: "Gagal membuat draft balasan, coba lagi." }, { status: 502 });
    }

    return NextResponse.json({ draft });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/ai-reply]", errorMessage(error));
    return NextResponse.json({ error: "Gagal membuat draft balasan, coba lagi." }, { status: 502 });
  }
}
