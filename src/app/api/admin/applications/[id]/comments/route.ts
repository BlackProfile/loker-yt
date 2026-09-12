// GET  /api/admin/applications/[id]/comments — diskusi internal satu kandidat (semua role).
// POST /api/admin/applications/[id]/comments — tambah komentar (OWNER/HR).
// @mention pada isi komentar diparse menjadi JSON array `mentions`. Setiap
// komentar baru dicatat ke ActivityLog (COMMENT).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// @mention: kata setelah "@" berisi huruf/angka/underscore/titik/strip (mendukung unicode).
const MENTION_REGEX = /@([\p{L}\p{N}_.-]{2,30})/gu;

/** Parse nama-nama yang di-@mention dari isi komentar (unik, maks 10). */
function parseMentions(body: string): string[] {
  const mentions = new Set<string>();
  for (const match of body.matchAll(MENTION_REGEX)) {
    const name = match[1].trim();
    if (name) mentions.add(name);
    if (mentions.size >= 10) break;
  }
  return Array.from(mentions);
}

type CommentRow = {
  id: string;
  authorName: string;
  authorRole: string;
  body: string;
  mentions: string;
  createdAt: Date;
};

function serializeComment(row: CommentRow) {
  let mentions: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.mentions);
    if (Array.isArray(parsed)) {
      mentions = parsed.filter((m): m is string => typeof m === "string");
    }
  } catch {
    mentions = [];
  }
  return {
    id: row.id,
    authorName: row.authorName,
    authorRole: row.authorRole,
    body: row.body,
    mentions,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const rows = await db.comment.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    return NextResponse.json(rows.map(serializeComment));
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/comments]", errorMessage(error));
    return NextResponse.json({ error: "Gagal memuat diskusi. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, { status: anySession ? 403 : 401 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const text = typeof (body as Record<string, unknown>).body === "string"
      ? (body as Record<string, unknown>).body.trim()
      : "";
    if (!text) {
      return NextResponse.json({ error: "Komentar tidak boleh kosong." }, { status: 400 });
    }
    if (text.length > 2000) {
      return NextResponse.json({ error: "Komentar maksimal 2000 karakter." }, { status: 400 });
    }

    const application = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const mentions = parseMentions(text);
    const created = await db.comment.create({
      data: {
        applicationId: id,
        authorName: session.name,
        authorRole: session.role,
        body: text,
        mentions: JSON.stringify(mentions),
      },
    });

    const mentionLabel = mentions.length > 0 ? ` — mention: ${mentions.join(", ")}` : "";
    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "COMMENT",
        detail: `Komentar diskusi tim ditulis${mentionLabel}`,
      },
    });

    return NextResponse.json(serializeComment(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/comments]", errorMessage(error));
    return NextResponse.json({ error: "Gagal mengirim komentar. Coba lagi nanti." }, { status: 500 });
  }
}
