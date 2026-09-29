// GET /api/admin/search?q=... — pencarian cepat untuk command palette (semua role).
// q minimal 2 karakter. Hasil: maks 5 posisi (judul mengandung q) dan maks 5
// pelamar (nama ATAU kode pelacakan mengandung q). Lamaran di tong sampah
// (deletedAt != null) dikecualikan. Respons: { positions: [], applications: [] }.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
    if (q.length < 2) {
      return NextResponse.json(
        { error: "Kueri pencarian minimal 2 karakter." },
        { status: 400 },
      );
    }
    const safe = q.slice(0, 60);

    const [positions, applicationRows] = await Promise.all([
      db.position.findMany({
        where: { title: { contains: safe } },
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
        take: 5,
        select: { id: true, title: true, isActive: true },
      }),
      db.application.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: safe } },
            { trackingCode: { contains: safe } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          name: true,
          trackingCode: true,
          status: true,
          position: { select: { title: true } },
        },
      }),
    ]);

    return NextResponse.json({
      positions,
      applications: applicationRows.map((row) => ({
        id: row.id,
        name: row.name,
        trackingCode: row.trackingCode ?? "",
        positionTitle: row.position?.title ?? null,
        status: row.status,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/search]", error);
    return NextResponse.json(
      { error: "Gagal menjalankan pencarian. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
