// NR-24 — Update satu tugas uji (status/skor/feedback).
// PATCH /api/admin/assessments/[id] — (OWNER/HR).
// Bila status berubah ke SUBMITTED/LATE dan submittedAt masih kosong → diisi waktu kini.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { Assessment } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Tugas uji tidak ditemukan" };

const ASSESSMENT_STATUSES = ["SENT", "SUBMITTED", "LATE"] as const;
type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

const FEEDBACK_MAX = 500;
const SCORE_MAX = 100;

function serializeAssessment(row: {
  id: string;
  title: string;
  link: string | null;
  note: string | null;
  dueAt: Date | null;
  status: string;
  score: number | null;
  feedback: string | null;
  submittedAt: Date | null;
  createdAt: Date;
}): Assessment {
  return {
    id: row.id,
    title: row.title,
    link: row.link,
    note: row.note,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    status: (ASSESSMENT_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as AssessmentStatus)
      : "SENT",
    score: row.score,
    feedback: row.feedback,
    createdAt: row.createdAt.toISOString(),
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const existing = await db.applicationAssessment.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: {
      status?: AssessmentStatus;
      score?: number | null;
      feedback?: string | null;
      submittedAt?: Date;
    } = {};

    let nextStatus: AssessmentStatus | undefined;
    if (data.status !== undefined) {
      if (typeof data.status !== "string" || !(ASSESSMENT_STATUSES as readonly string[]).includes(data.status)) {
        return NextResponse.json(
          { error: "Status tugas uji harus SENT, SUBMITTED, atau LATE." },
          { status: 400 }
        );
      }
      nextStatus = data.status as AssessmentStatus;
      updateData.status = nextStatus;
    }

    if (data.score !== undefined) {
      if (data.score === null) {
        updateData.score = null;
      } else if (
        typeof data.score === "number" &&
        Number.isInteger(data.score) &&
        data.score >= 0 &&
        data.score <= SCORE_MAX
      ) {
        updateData.score = data.score;
      } else {
        return NextResponse.json(
          { error: `Skor harus angka bulat antara 0 dan ${SCORE_MAX}, atau null untuk menghapus.` },
          { status: 400 }
        );
      }
    }

    if (data.feedback !== undefined) {
      if (data.feedback === null) {
        updateData.feedback = null;
      } else if (typeof data.feedback === "string") {
        const trimmed = data.feedback.trim();
        if (trimmed.length > FEEDBACK_MAX) {
          return NextResponse.json(
            { error: `Feedback maksimal ${FEEDBACK_MAX} karakter.` },
            { status: 400 }
          );
        }
        updateData.feedback = trimmed.length > 0 ? trimmed : null;
      } else {
        return NextResponse.json({ error: "Feedback harus berupa teks." }, { status: 400 });
      }
    }

    // Tandai waktu pengumpulan pertama kali bila masuk status SUBMITTED/LATE.
    if (
      nextStatus !== undefined &&
      (nextStatus === "SUBMITTED" || nextStatus === "LATE") &&
      !existing.submittedAt
    ) {
      updateData.submittedAt = new Date();
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const updated = await db.applicationAssessment.update({
      where: { id },
      data: updateData,
    });

    // Detail log: status (dan/atau skor) yang diterapkan.
    const parts: string[] = [];
    if (nextStatus !== undefined) parts.push(`status ${nextStatus}`);
    if (updateData.score !== undefined) {
      parts.push(updateData.score === null ? "skor dihapus" : `skor ${updateData.score}`);
    }
    await db.activityLog.create({
      data: {
        applicationId: existing.applicationId,
        actor: session.name,
        action: "ASSESSMENT_UPDATE",
        detail: `Tugas uji "${updated.title}" → ${parts.join(", ")}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ assessment: serializeAssessment(updated) });
  } catch (error) {
    console.error("[PATCH /api/admin/assessments/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui tugas uji. Coba lagi nanti." }, { status: 500 });
  }
}
