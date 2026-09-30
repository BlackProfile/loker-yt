// Papan pengumuman internal tim admin (Task 27-c).
// GET    /api/admin/announcements          — daftar (semua role): pinned desc lalu createdAt desc, take 20.
// POST   /api/admin/announcements          — buat (OWNER/HR): { title (3-80), body (1-600), pinned? }.
// DELETE /api/admin/announcements?id=...   — hapus (OWNER saja).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const ANNOUNCEMENT_EVENT = "announcements:changed";
const MAX_LIST = 20;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.announcement.findMany({
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: MAX_LIST,
    });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        authorName: row.authorName,
        createdAt: row.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error("[GET /api/admin/announcements]", error);
    return NextResponse.json(
      { error: "Gagal memuat pengumuman. Coba lagi nanti." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const payload: unknown = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = payload as Record<string, unknown>;

    const title = typeof data.title === "string" ? data.title.trim() : "";
    const body = typeof data.body === "string" ? data.body.trim() : "";
    const pinned = data.pinned === true;

    if (title.length < 3 || title.length > 80) {
      return NextResponse.json(
        { error: "Judul wajib 3-80 karakter." },
        { status: 400 }
      );
    }
    if (body.length < 1 || body.length > 600) {
      return NextResponse.json(
        { error: "Isi pengumuman wajib 1-600 karakter." },
        { status: 400 }
      );
    }

    const row = await db.announcement.create({
      data: {
        title,
        body,
        pinned,
        authorName: session.name,
      },
    });

    void emitRealtime(ANNOUNCEMENT_EVENT);

    return NextResponse.json(
      {
        id: row.id,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        authorName: row.authorName,
        createdAt: row.createdAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/admin/announcements]", error);
    return NextResponse.json(
      { error: "Gagal membuat pengumuman. Coba lagi nanti." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "Parameter id wajib diisi." },
        { status: 400 }
      );
    }

    const existing = await db.announcement.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Pengumuman tidak ditemukan." },
        { status: 404 }
      );
    }

    await db.announcement.delete({ where: { id } });

    void emitRealtime(ANNOUNCEMENT_EVENT);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/announcements]", error);
    return NextResponse.json(
      { error: "Gagal menghapus pengumuman. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
