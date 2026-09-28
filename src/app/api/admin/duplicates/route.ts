// GET /api/admin/duplicates — daftar id lamaran yang terdeteksi duplikat
// (isDuplicate=true). Dipakai badge "Duplikat" di kartu kanban, pipeline,
// dan dialog detail. Ringan: hanya id, semua role yang login boleh membaca.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.application.findMany({
      where: { isDuplicate: true },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return NextResponse.json({ ids: rows.map((r) => r.id) });
  } catch (error) {
    console.error("[GET /api/admin/duplicates]", errorMessage(error));
    return NextResponse.json({ error: "Gagal memuat data duplikat. Coba lagi nanti." }, { status: 500 });
  }
}
