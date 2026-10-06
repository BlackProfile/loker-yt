// GET    /api/admin/waitlist — daftar entri daftar tunggu kuota posisi (NR-40 butir 13).
//                        Query opsional ?positionId= untuk memfilter per posisi.
// DELETE /api/admin/waitlist?id= — hapus satu entri (OWNER/HR).
// Daftar tunggu diisi pelamar dari halaman publik detail posisi saat kuota penuh.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const positionId = req.nextUrl.searchParams.get("positionId")?.trim() || "";

    const entries = await db.positionWaitlist.findMany({
      where: positionId ? { positionId } : undefined,
      orderBy: { createdAt: "desc" },
      include: { position: { select: { title: true } } },
    });

    // Rekap jumlah pendaftar per posisi (selalu lintas posisi, tak terpengaruh filter).
    const perPositionMap = new Map<
      string,
      { positionId: string | null; positionTitle: string | null; count: number }
    >();
    const all = positionId
      ? await db.positionWaitlist.findMany({ include: { position: { select: { title: true } } } })
      : entries;
    for (const row of all) {
      const key = row.positionId ?? "-";
      const bucket = perPositionMap.get(key) ?? {
        positionId: row.positionId,
        positionTitle: row.position?.title ?? null,
        count: 0,
      };
      bucket.count += 1;
      perPositionMap.set(key, bucket);
    }

    return NextResponse.json({
      entries: entries.map((row) => ({
        id: row.id,
        email: row.email,
        positionId: row.positionId,
        positionTitle: row.position?.title ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      count: entries.length,
      perPosition: [...perPositionMap.values()].sort((a, b) => b.count - a.count),
    });
  } catch (error) {
    console.error("[GET /api/admin/waitlist]", error);
    return NextResponse.json(
      { error: "Gagal memuat daftar tunggu. Coba lagi nanti." },
      { status: 500 },
    );
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

    const id = req.nextUrl.searchParams.get("id")?.trim() || "";
    if (!id) {
      return NextResponse.json({ error: "ID entri daftar tunggu wajib diisi." }, { status: 400 });
    }

    const existing = await db.positionWaitlist.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(
        { error: "Entri daftar tunggu tidak ditemukan." },
        { status: 404 },
      );
    }

    await db.positionWaitlist.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/waitlist]", error);
    return NextResponse.json(
      { error: "Gagal menghapus entri daftar tunggu. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
