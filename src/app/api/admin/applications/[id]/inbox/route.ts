// NR-24 — Kotak masuk gabungan per pelamar.
// GET /api/admin/applications/[id]/inbox — gabungkan email keluar, pertanyaan pelamar,
// dan log panggilan menjadi satu thread urut terbaru (semua role admin).
// Respons: { items: InboxItem[], unanswered: number } — unanswered = pertanyaan tanpa jawaban.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { InboxItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

const BODY_MAX = 600;

const CALL_RESULT_LABELS: Record<string, string> = {
  DIANGGAT: "Dianggat",
  TIDAK_DIANGGAT: "Tidak dianggat",
  SALAH_SAMBUNGAN: "Salah sambungan",
};

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

    const [emails, questions, calls] = await Promise.all([
      db.emailOutbox.findMany({ where: { applicationId: id }, orderBy: { createdAt: "desc" } }),
      db.applicationQuestion.findMany({ where: { applicationId: id }, orderBy: { createdAt: "desc" } }),
      db.applicationCall.findMany({ where: { applicationId: id }, orderBy: { createdAt: "desc" } }),
    ]);

    const items: InboxItem[] = [];

    for (const mail of emails) {
      items.push({
        kind: "EMAIL",
        at: mail.createdAt.toISOString(),
        from: "Lumina Studio",
        title: mail.subject,
        body: mail.body.slice(0, BODY_MAX),
      });
    }

    for (const question of questions) {
      items.push({
        kind: "QUESTION",
        at: question.createdAt.toISOString(),
        from: question.askedBy,
        title: "Pertanyaan pelamar",
        body: question.answer
          ? `${question.question}\n\nJawaban (${question.answeredBy ?? "Admin"}): ${question.answer}`
          : question.question,
        answered: Boolean(question.answer),
      });
    }

    for (const call of calls) {
      items.push({
        kind: "CALL",
        at: call.createdAt.toISOString(),
        from: call.actor,
        title: `Log panggilan — ${CALL_RESULT_LABELS[call.result] ?? call.result}`,
        body: call.summary || "-",
      });
    }

    // Urut terbaru di atas.
    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

    const unanswered = questions.filter((q) => !q.answer).length;
    return NextResponse.json({ items, unanswered });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/inbox]", error);
    return NextResponse.json({ error: "Gagal memuat kotak masuk." }, { status: 500 });
  }
}
