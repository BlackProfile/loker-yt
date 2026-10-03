// NR-24 — Tes/asesmen yang dikirim ke pelamar.
// GET  /api/admin/applications/[id]/assessments — daftar asesmen urut terlama (semua role admin).
// POST /api/admin/applications/[id]/assessments — kirim tugas uji baru (OWNER/HR), status awal SENT.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { Assessment } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

const ASSESSMENT_STATUSES = ["SENT", "SUBMITTED", "LATE"] as const;
type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

const TITLE_MAX = 120;
const LINK_MAX = 500;
const NOTE_MAX = 500;

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

    const rows = await db.applicationAssessment.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({ assessments: rows.map(serializeAssessment) });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/assessments]", error);
    return NextResponse.json({ error: "Gagal memuat daftar tugas uji." }, { status: 500 });
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

    const existing = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const title = typeof data.title === "string" ? data.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Judul tugas uji wajib diisi." }, { status: 400 });
    }
    if (title.length > TITLE_MAX) {
      return NextResponse.json(
        { error: `Judul tugas uji maksimal ${TITLE_MAX} karakter.` },
        { status: 400 }
      );
    }

    let link: string | null = null;
    if (data.link !== undefined && data.link !== null) {
      if (typeof data.link !== "string") {
        return NextResponse.json({ error: "Link tugas uji harus berupa teks." }, { status: 400 });
      }
      const trimmed = data.link.trim();
      if (trimmed.length > LINK_MAX) {
        return NextResponse.json(
          { error: `Link tugas uji maksimal ${LINK_MAX} karakter.` },
          { status: 400 }
        );
      }
      // URL-ish: harus tampak seperti URL (skema:// atau host.tld) — bebas protokol apa pun.
      if (trimmed && !/^(https?:\/\/|[\w-]+(\.[\w-]+)+)/i.test(trimmed)) {
        return NextResponse.json(
          { error: "Link tugas uji harus berupa URL yang valid." },
          { status: 400 }
        );
      }
      link = trimmed.length > 0 ? trimmed : null;
    }

    let note: string | null = null;
    if (data.note !== undefined && data.note !== null) {
      if (typeof data.note !== "string") {
        return NextResponse.json({ error: "Catatan tugas uji harus berupa teks." }, { status: 400 });
      }
      const trimmed = data.note.trim();
      if (trimmed.length > NOTE_MAX) {
        return NextResponse.json(
          { error: `Catatan tugas uji maksimal ${NOTE_MAX} karakter.` },
          { status: 400 }
        );
      }
      note = trimmed.length > 0 ? trimmed : null;
    }

    let dueAt: Date | null = null;
    if (data.dueAt !== undefined && data.dueAt !== null) {
      if (typeof data.dueAt !== "string") {
        return NextResponse.json({ error: "Tenggat tugas uji tidak valid." }, { status: 400 });
      }
      const parsed = new Date(data.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Tenggat tugas uji tidak valid." }, { status: 400 });
      }
      dueAt = parsed;
    }

    const created = await db.applicationAssessment.create({
      data: { applicationId: id, title, link, note, dueAt, status: "SENT" },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "ASSESSMENT_SENT",
        detail: `Tugas uji dikirim: ${title}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ assessment: serializeAssessment(created) }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/assessments]", error);
    return NextResponse.json({ error: "Gagal mengirim tugas uji. Coba lagi nanti." }, { status: 500 });
  }
}
