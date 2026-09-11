// GET /api/admin/applications — daftar semua lamaran dengan filter opsional (khusus admin).
// Query params: status (NEW|REVIEWED|INTERVIEW|ACCEPTED|REJECTED), positionId, q (cari name/email).
import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/server-auth";
import { serializeApplication } from "@/lib/seed";
import { APPLICATION_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json({ error: "Tidak diizinkan. Silakan login terlebih dahulu." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const positionId = searchParams.get("positionId");
    const q = searchParams.get("q")?.trim() ?? "";

    const where: Prisma.ApplicationWhereInput = {};

    if (status) {
      if (!(APPLICATION_STATUSES as string[]).includes(status)) {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      where.status = status;
    }
    if (positionId) {
      where.positionId = positionId;
    }
    if (q) {
      where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
    }

    const rows = await db.application.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { position: { select: { title: true } } },
    });

    return NextResponse.json(rows.map(serializeApplication));
  } catch (error) {
    console.error("[GET /api/admin/applications]", error);
    return NextResponse.json({ error: "Gagal memuat daftar lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
