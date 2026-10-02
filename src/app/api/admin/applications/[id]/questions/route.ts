// GET /api/admin/applications/[id]/questions — daftar pertanyaan pelamar pada satu
// lamaran (thread tanya-jawab NR-15, idea 10). Dipakai dialog detail admin; terpisah
// dari serializeApplication agar kontrak kandidat tidak tersentuh.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const questions = await db.applicationQuestion.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({
      ok: true,
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        askedBy: q.askedBy,
        answeredBy: q.answeredBy,
        answeredAt: q.answeredAt ? q.answeredAt.toISOString() : null,
        createdAt: q.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/questions]", error);
    return NextResponse.json(
      { error: "Gagal memuat pertanyaan. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
