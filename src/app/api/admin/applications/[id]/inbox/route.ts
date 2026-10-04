// /api/admin/applications/[id]/inbox — inbox terpadu satu lamaran (NR-24, fitur 10).
// Thread gabungan 50 item terbaru dari tiga sumber:
//   - EmailOutbox milik lamaran  -> kind "email", direction "out" (subject + body apa adanya).
//   - ApplicationQuestion        -> kind "question", direction "in"; bila terjawab,
//                                   item balasan direction "out" ("Jawaban tim").
//   - CallLog                    -> kind "call", direction "out".
// hasUnanswered = item terbaru di thread adalah pertanyaan pelamar yang belum dijawab
// (menunggu balasan admin).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { CALL_OUTCOMES, CALL_OUTCOME_LABELS, type CallOutcome, type InboxItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const THREAD_LIMIT = 50;

function outcomeLabel(outcome: string): string {
  return (CALL_OUTCOMES as string[]).includes(outcome)
    ? CALL_OUTCOME_LABELS[outcome as CallOutcome]
    : outcome;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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

    const [emails, questions, calls] = await Promise.all([
      db.emailOutbox.findMany({
        where: { applicationId: id },
        orderBy: { createdAt: "desc" },
        take: THREAD_LIMIT,
      }),
      db.applicationQuestion.findMany({
        where: { applicationId: id },
        orderBy: { createdAt: "desc" },
        take: THREAD_LIMIT,
      }),
      db.callLog.findMany({
        where: { applicationId: id },
        orderBy: { createdAt: "desc" },
        take: THREAD_LIMIT,
      }),
    ]);

    const items: InboxItem[] = [];

    for (const email of emails) {
      items.push({
        id: email.id,
        kind: "email",
        direction: "out",
        at: email.createdAt.toISOString(),
        title: email.subject,
        body: email.body,
        unanswered: false,
      });
    }

    for (const q of questions) {
      const answered = Boolean(q.answer && q.answer.trim().length > 0);
      items.push({
        id: q.id,
        kind: "question",
        direction: "in",
        at: q.createdAt.toISOString(),
        title: "Pertanyaan pelamar",
        body: q.question,
        unanswered: !answered,
      });
      if (answered) {
        items.push({
          id: `${q.id}-answer`,
          kind: "question",
          direction: "out",
          // ApplicationQuestion tidak punya kolom updatedAt — pakai answeredAt ?? createdAt.
          at: (q.answeredAt ?? q.createdAt).toISOString(),
          title: "Jawaban tim",
          body: q.answer ?? "",
          unanswered: false,
        });
      }
    }

    for (const call of calls) {
      items.push({
        id: call.id,
        kind: "call",
        direction: "out",
        at: call.createdAt.toISOString(),
        title: `Panggilan: ${outcomeLabel(call.outcome)}`,
        body: call.note,
        unanswered: false,
      });
    }

    items.sort((a, b) => b.at.localeCompare(a.at));
    const thread = items.slice(0, THREAD_LIMIT);

    const latest = thread[0];
    const hasUnanswered = Boolean(latest && latest.direction === "in" && latest.unanswered);

    return NextResponse.json({ ok: true, items: thread, hasUnanswered });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/inbox]", error);
    return NextResponse.json({ error: "Gagal memuat inbox. Coba lagi nanti." }, { status: 500 });
  }
}
