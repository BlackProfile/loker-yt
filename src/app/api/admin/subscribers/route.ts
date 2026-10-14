// GET    /api/admin/subscribers — daftar email pelanggan notifikasi (semua role, terbaru dulu).
// DELETE /api/admin/subscribers?id=... — hapus satu pelanggan (OWNER/HR; VIEWER ditolak).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { Subscriber } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.subscriber.findMany({ orderBy: { createdAt: "desc" } });
    const subscribers: Subscriber[] = rows.map((row) => ({
      id: row.id,
      email: row.email,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json(subscribers);
  } catch (error) {
    console.error("[GET /api/admin/subscribers]", error);
    return NextResponse.json({ error: "Gagal memuat daftar pelanggan. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
    }

    const existing = await db.subscriber.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Pelanggan tidak ditemukan." }, { status: 404 });
    }

    await db.subscriber.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/subscribers]", error);
    return NextResponse.json({ error: "Gagal menghapus pelanggan. Coba lagi nanti." }, { status: 500 });
  }
}
