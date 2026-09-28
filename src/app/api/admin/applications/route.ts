// GET /api/admin/applications — daftar semua lamaran dengan filter & urutan opsional (semua role).
// Query: status, positionId, q, ratingMin, tag, talentPool ("1"/"true"), hasInterview ("1"),
//        sort ("newest" default | "oldest" | "aiScore").
// Scope & masking: HR dengan scope posisi hanya melihat lamaran pada posisi terkait;
// VIEWER menerima PII tersamar (phone & CV disembunyikan di level respons list).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  maskApplicationForViewer,
  parseApplicationFilters,
  parseAssignedPositions,
  serializeApplication,
} from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const { where: baseWhere, orderBy, valid } = parseApplicationFilters(searchParams);
    if (!valid) {
      return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
    }

    let where = baseWhere;

    // Scope granular HR: bila daftar posisi yang ditugaskan tidak kosong,
    // batasi hasil hanya ke posisi tersebut (kosong = semua posisi).
    if (session.role === "HR") {
      const admin = await db.adminUser.findUnique({
        where: { email: session.email },
        select: { assignedPositions: true },
      });
      const scope = parseAssignedPositions(admin?.assignedPositions);
      if (scope.length > 0) {
        where = { ...where, AND: [{ positionId: { in: scope } }] };
      }
    }

    const rows = await db.application.findMany({
      where,
      orderBy,
      include: APPLICATION_INCLUDE,
    });

    const data = rows.map(serializeApplication);

    // VIEWER: mask PII (phone & CV) hanya pada level respons list.
    return NextResponse.json(
      session.role === "VIEWER" ? data.map(maskApplicationForViewer) : data,
    );
  } catch (error) {
    console.error("[GET /api/admin/applications]", error);
    return NextResponse.json({ error: "Gagal memuat daftar lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
