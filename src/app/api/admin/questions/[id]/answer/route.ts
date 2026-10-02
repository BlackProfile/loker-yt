// POST /api/admin/questions/[id]/answer — admin menjawab pertanyaan pelamar dari
// thread tanya-jawab halaman Cek Status (NR-15, idea 10). Body: { answer }.
// Role OWNER/HR boleh; VIEWER ditolak 403. Jawaban tersimpan + ActivityLog
// QUESTION_ANSWERED (muncul di ringkasan "Apa yang Berubah" pelamar).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Pertanyaan tidak ditemukan." };

const ANSWER_MAX_LENGTH = 1500;

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
    const rawAnswer =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).answer
        : undefined;
    if (typeof rawAnswer !== "string" || !rawAnswer.trim()) {
      return NextResponse.json({ error: "Jawaban tidak boleh kosong." }, { status: 400 });
    }
    const answer = rawAnswer.trim().slice(0, ANSWER_MAX_LENGTH);

    const question = await db.applicationQuestion.findUnique({
      where: { id },
      select: { id: true, applicationId: true },
    });
    if (!question) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.applicationQuestion.update({
      where: { id },
      data: {
        answer,
        answeredBy: session.name,
        answeredAt: new Date(),
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: question.applicationId,
        actor: session.name,
        action: "QUESTION_ANSWERED",
        detail: `Pertanyaan pelamar dijawab: ${answer.slice(0, 80)}`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/admin/questions/[id]/answer]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan jawaban. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
