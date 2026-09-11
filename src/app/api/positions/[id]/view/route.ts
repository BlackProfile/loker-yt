// POST /api/positions/[id]/view — hitung view detail posisi (publik, tanpa auth).
// Param [id] menerima id ATAU slug posisi. Tanpa dedupe server-side (rate-safety di sisi klien).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { PositionViewResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Terima id ATAU slug.
    let position = await db.position.findUnique({ where: { id }, select: { id: true } });
    if (!position) {
      position = await db.position.findUnique({ where: { slug: id }, select: { id: true } });
    }
    if (!position) {
      return NextResponse.json({ error: "Posisi tidak ditemukan" }, { status: 404 });
    }

    const updated = await db.position.update({
      where: { id: position.id },
      data: { views: { increment: 1 } },
      select: { views: true },
    });

    const body: PositionViewResponse = { ok: true, views: updated.views };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[POST /api/positions/[id]/view]", error);
    return NextResponse.json({ error: "Gagal mencatat view posisi. Coba lagi nanti." }, { status: 500 });
  }
}
