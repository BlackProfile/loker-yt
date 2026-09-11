// GET /api/admin/applications — daftar semua lamaran dengan filter & urutan opsional (semua role).
// Query: status, positionId, q, ratingMin, tag, talentPool ("1"/"true"), hasInterview ("1"),
//        sort ("newest" default | "oldest" | "aiScore").
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, parseApplicationFilters, serializeApplication } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const { where, orderBy, valid } = parseApplicationFilters(searchParams);
    if (!valid) {
      return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
    }

    const rows = await db.application.findMany({
      where,
      orderBy,
      include: APPLICATION_INCLUDE,
    });

    return NextResponse.json(rows.map(serializeApplication));
  } catch (error) {
    console.error("[GET /api/admin/applications]", error);
    return NextResponse.json({ error: "Gagal memuat daftar lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
