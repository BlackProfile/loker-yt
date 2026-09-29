// GET    /api/admin/position-templates — daftar template posisi (semua role admin).
// POST   /api/admin/position-templates — buat template posisi (OWNER/HR): { name, note?, data }.
// DELETE /api/admin/position-templates?id= — hapus template posisi (hanya OWNER).
// data = objek payload formulir posisi (bentuk sama dengan payload tombol Simpan),
// disimpan sebagai string JSON maksimal 64 KB.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const NAME_MAX = 60;
const NOTE_MAX = 300;
const DATA_MAX_BYTES = 64 * 1024; // 64 KB
const TAKE_LIMIT = 200;

function serializeMeta(row: {
  id: string;
  name: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.positionTemplate.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: TAKE_LIMIT,
    });

    return NextResponse.json(rows.map(serializeMeta));
  } catch (error) {
    console.error("[GET /api/admin/position-templates]", error);
    return NextResponse.json(
      { error: "Gagal memuat template posisi. Coba lagi nanti." },
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

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const input = body as Record<string, unknown>;

    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Nama template wajib diisi (maksimal ${NAME_MAX} karakter).` },
        { status: 400 }
      );
    }

    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (note.length > NOTE_MAX) {
      return NextResponse.json(
        { error: `Catatan template maksimal ${NOTE_MAX} karakter.` },
        { status: 400 }
      );
    }

    const data = input.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json(
        { error: "Data template harus berupa objek formulir posisi." },
        { status: 400 }
      );
    }
    const serialized = JSON.stringify(data);
    if (Buffer.byteLength(serialized, "utf8") > DATA_MAX_BYTES) {
      return NextResponse.json(
        { error: "Data template terlalu besar (maksimal 64 KB)." },
        { status: 400 }
      );
    }

    const created = await db.positionTemplate.create({
      data: { name, note: note === "" ? null : note, data: serialized },
    });

    return NextResponse.json(
      { template: { ...serializeMeta(created), data: created.data } },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/admin/position-templates]", error);
    return NextResponse.json(
      { error: "Gagal membuat template posisi. Coba lagi nanti." },
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
    const id = (searchParams.get("id") ?? "").trim();
    if (!id) {
      return NextResponse.json(
        { error: "Parameter id wajib diisi." },
        { status: 400 }
      );
    }

    const existing = await db.positionTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Template tidak ditemukan." },
        { status: 404 }
      );
    }

    await db.positionTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/position-templates]", error);
    return NextResponse.json(
      { error: "Gagal menghapus template posisi. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
