// GET /api/admin/hire — daftar karyawan (application dengan hiredAt terisi) untuk tab Karyawan.
// Menyertakan judul posisi, rencana onboarding & checklist offboarding (JSON sudah diparse
// aman), status siklus hidup (permanentAt/exitAt/exitReason/exitNote), dan semua CheckIn.
// dueAt cek-in yang belum ada dihitung on-the-fly di klien dari hiredAt + n hari.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { employeeInclude, serializeEmployee } from "@/lib/employee-lifecycle";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.application.findMany({
      where: { hiredAt: { not: null } },
      include: employeeInclude,
      orderBy: { hiredAt: "desc" },
    });

    return NextResponse.json(rows.map(serializeEmployee));
  } catch (error) {
    console.error("[GET /api/admin/hire]", error);
    return NextResponse.json({ error: "Gagal memuat daftar karyawan. Coba lagi nanti." }, { status: 500 });
  }
}
