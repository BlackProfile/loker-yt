// GET /api/admin/position-templates/[id] — detail satu template posisi.
// Field `data` (string JSON tersimpan) di-parse menjadi objek sebelum dikirim.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Template tidak ditemukan." };

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const row = await db.positionTemplate.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    let data: unknown = null;
    try {
      const parsed: unknown = JSON.parse(row.data);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed;
      }
    } catch {
      data = null;
    }
    if (!data) {
      console.error("[GET /api/admin/position-templates/[id]] data JSON rusak:", row.id);
      return NextResponse.json(
        { error: "Data template tidak valid." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      template: {
        id: row.id,
        name: row.name,
        note: row.note,
        data,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/position-templates/[id]]", error);
    return NextResponse.json(
      { error: "Gagal memuat template posisi. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
