// POST /api/admin/positions/[id]/duplicate — salin posisi menjadi draft baru (OWNER/HR).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { serializePosition } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const existing = await db.position.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const maxOrder = await db.position.aggregate({ _max: { order: true } });
    const order = (maxOrder._max.order ?? 0) + 1;

    const created = await db.position.create({
      data: {
        title: `${existing.title} (Salinan)`,
        department: existing.department,
        type: existing.type,
        location: existing.location,
        description: existing.description,
        requirements: existing.requirements,
        isActive: false,
        closesAt: null,
        order,
      },
    });

    return NextResponse.json(serializePosition(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/positions/[id]/duplicate]", error);
    return NextResponse.json({ error: "Gagal menduplikasi posisi. Coba lagi nanti." }, { status: 500 });
  }
}
