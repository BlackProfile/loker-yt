// /api/admin/applications/[id]/assessments — tugas uji per lamaran (NR-24, fitur 5).
// GET    : daftar assessment milik lamaran (urut dueAt asc). Status "DIKIRIM" yang
//          sudah lewat tenggat dilaporkan sebagai "TERLAMBAT" saat serialisasi
//          (tanpa menulis DB).
// POST   : kirim tugas uji baru {title, note?, dueAt} — status awal "DIKIRIM".
// PATCH  : edit assessment {id, title?, note?, dueAt?, markCollected?, resultScore?,
//          resultNote?} — penilaian/koleksi menandai status "DIKUMPUL".
// DELETE : hapus assessment (?assessmentId=).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { Assessment } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };
const ASSESSMENT_NOT_FOUND = { error: "Tugas uji tidak ditemukan." };

const TITLE_MAX = 120;
const NOTE_MAX = 1000;

const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTimeId(date: Date): string {
  return dateTimeFmt.format(date);
}

type AssessmentRow = {
  id: string;
  applicationId: string;
  title: string;
  note: string | null;
  dueAt: Date;
  status: string;
  resultScore: number | null;
  resultNote: string | null;
  submittedFileId: string | null;
  completedAt: Date | null;
  createdAt: Date;
};

type FileMeta = { id: string; filename: string };

/** Serialisasi Assessment + status efektif (DIKIRIM lewat tenggat -> TERLAMBAT). */
function serializeAssessment(row: AssessmentRow, fileNameById: Map<string, string>): Assessment {
  let status: Assessment["status"];
  if (row.status === "DIKUMPUL") status = "DIKUMPUL";
  else if (row.status === "TERLAMBAT" || (row.status === "DIKIRIM" && row.dueAt.getTime() < Date.now()))
    status = "TERLAMBAT";
  else status = "DIKIRIM";
  return {
    id: row.id,
    applicationId: row.applicationId,
    title: row.title,
    note: row.note,
    dueAt: row.dueAt.toISOString(),
    status,
    resultScore: row.resultScore,
    resultNote: row.resultNote,
    submittedFileId: row.submittedFileId,
    submittedFileName: row.submittedFileId ? (fileNameById.get(row.submittedFileId) ?? null) : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Muat daftar assessment lamaran (urut dueAt asc) + nama file hasil karya. */
async function loadAssessments(applicationId: string): Promise<Assessment[]> {
  const rows = await db.assessment.findMany({
    where: { applicationId },
    orderBy: { dueAt: "asc" },
    take: 200,
  });
  const fileIds = [...new Set(rows.map((r) => r.submittedFileId).filter((v): v is string => Boolean(v)))];
  const files: FileMeta[] =
    fileIds.length > 0
      ? await db.fileAsset.findMany({ where: { id: { in: fileIds } }, select: { id: true, filename: true } })
      : [];
  const fileNameById = new Map(files.map((f) => [f.id, f.filename]));
  return rows.map((row) => serializeAssessment(row, fileNameById));
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const assessments = await loadAssessments(id);
    return NextResponse.json({ ok: true, assessments });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/assessments]", error);
    return NextResponse.json({ error: "Gagal memuat tugas uji. Coba lagi nanti." }, { status: 500 });
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

    const body: unknown = await req.json().catch(() => null);
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

    const title = typeof data.title === "string" ? data.title.trim() : "";
    if (title.length < 1 || title.length > TITLE_MAX) {
      return NextResponse.json(
        { error: `Judul tugas uji wajib diisi (maksimal ${TITLE_MAX} karakter).` },
        { status: 400 }
      );
    }
    const note =
      typeof data.note === "string" && data.note.trim().length > 0 ? data.note.trim().slice(0, NOTE_MAX) : null;
    const dueAtRaw = typeof data.dueAt === "string" || typeof data.dueAt === "number" ? data.dueAt : null;
    const dueAt = dueAtRaw != null ? new Date(dueAtRaw) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "Tenggat pengumpulan tidak valid." }, { status: 400 });
    }

    const application = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.assessment.create({
      data: {
        applicationId: id,
        title,
        note,
        dueAt,
        status: "DIKIRIM",
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "ASSESSMENT_SENT",
        detail: `Tugas uji "${title}" dikirim — tenggat ${formatDateTimeId(dueAt)}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    const assessments = await loadAssessments(id);
    return NextResponse.json({ ok: true, assessments });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/assessments]", error);
    return NextResponse.json({ error: "Gagal mengirim tugas uji. Coba lagi nanti." }, { status: 500 });
  }
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

    const body: unknown = await req.json().catch(() => null);
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

    const assessmentId = typeof data.id === "string" ? data.id.trim() : "";
    if (!assessmentId) {
      return NextResponse.json({ error: "ID tugas uji wajib diisi." }, { status: 400 });
    }
    const existing = await db.assessment.findFirst({
      where: { id: assessmentId, applicationId: id },
    });
    if (!existing) {
      return NextResponse.json(ASSESSMENT_NOT_FOUND, { status: 404 });
    }

    const updateData: {
      title?: string;
      note?: string | null;
      dueAt?: Date;
      resultScore?: number;
      resultNote?: string | null;
      status?: string;
      completedAt?: Date;
    } = {};

    if (data.title !== undefined) {
      const title = typeof data.title === "string" ? data.title.trim() : "";
      if (title.length < 1 || title.length > TITLE_MAX) {
        return NextResponse.json(
          { error: `Judul tugas uji wajib diisi (maksimal ${TITLE_MAX} karakter).` },
          { status: 400 }
        );
      }
      updateData.title = title;
    }
    if (data.note !== undefined) {
      updateData.note =
        typeof data.note === "string" && data.note.trim().length > 0 ? data.note.trim().slice(0, NOTE_MAX) : null;
    }
    if (data.dueAt !== undefined) {
      const dueAtRaw = typeof data.dueAt === "string" || typeof data.dueAt === "number" ? data.dueAt : null;
      const dueAt = dueAtRaw != null ? new Date(dueAtRaw) : null;
      if (!dueAt || Number.isNaN(dueAt.getTime())) {
        return NextResponse.json({ error: "Tenggat pengumpulan tidak valid." }, { status: 400 });
      }
      updateData.dueAt = dueAt;
    }
    if (data.resultScore !== undefined) {
      const score = typeof data.resultScore === "number" ? data.resultScore : Number(data.resultScore);
      if (!Number.isInteger(score) || score < 0 || score > 100) {
        return NextResponse.json({ error: "Skor hasil harus angka bulat 0-100." }, { status: 400 });
      }
      updateData.resultScore = score;
    }
    if (data.resultNote !== undefined) {
      updateData.resultNote =
        typeof data.resultNote === "string" && data.resultNote.trim().length > 0
          ? data.resultNote.trim().slice(0, NOTE_MAX)
          : null;
    }

    // Koleksi/penilaian menandai tugas selesai dikumpulkan.
    const marksCollected =
      data.markCollected === true || data.resultScore !== undefined || data.resultNote !== undefined;
    if (marksCollected) {
      updateData.status = "DIKUMPUL";
      updateData.completedAt = new Date();
    }

    const updated = await db.assessment.update({
      where: { id: assessmentId },
      data: updateData,
    });

    if (updateData.resultScore !== undefined) {
      await db.activityLog.create({
        data: {
          applicationId: id,
          actor: session.name,
          action: "ASSESSMENT_SCORED",
          detail: `Tugas uji "${updated.title}" dinilai — skor ${updated.resultScore ?? 0}/100`,
        },
      });
    } else {
      await db.activityLog.create({
        data: {
          applicationId: id,
          actor: session.name,
          action: "ASSESSMENT_UPDATED",
          detail: `Tugas uji "${updated.title}" diperbarui`,
        },
      });
    }

    void emitRealtime(REALTIME_EVENTS.applications);
    const assessments = await loadAssessments(id);
    return NextResponse.json({ ok: true, assessments });
  } catch (error) {
    console.error("[PATCH /api/admin/applications/[id]/assessments]", error);
    return NextResponse.json({ error: "Gagal memperbarui tugas uji. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const assessmentId = req.nextUrl.searchParams.get("assessmentId")?.trim() ?? "";
    if (!assessmentId) {
      return NextResponse.json({ error: "ID tugas uji wajib diisi." }, { status: 400 });
    }
    const existing = await db.assessment.findFirst({
      where: { id: assessmentId, applicationId: id },
    });
    if (!existing) {
      return NextResponse.json(ASSESSMENT_NOT_FOUND, { status: 404 });
    }

    await db.assessment.delete({ where: { id: assessmentId } });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "ASSESSMENT_DELETED",
        detail: `Tugas uji "${existing.title}" dihapus`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    const assessments = await loadAssessments(id);
    return NextResponse.json({ ok: true, assessments });
  } catch (error) {
    console.error("[DELETE /api/admin/applications/[id]/assessments]", error);
    return NextResponse.json({ error: "Gagal menghapus tugas uji. Coba lagi nanti." }, { status: 500 });
  }
}
