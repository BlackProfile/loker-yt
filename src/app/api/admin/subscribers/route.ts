// GET /api/admin/subscribers — daftar email pelanggan notifikasi (semua role, terbaru dulu).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { Subscriber } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

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
