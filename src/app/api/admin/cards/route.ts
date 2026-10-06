// GET /api/admin/cards — daftar semua kartu karyawan (current + riwayat) untuk panel Kartu Karyawan.
// Semua role boleh membaca; mutasi ada di [id]/route.ts & reissue.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { ensureEmployeeCard, serializeCard } from "@/lib/employee-cards";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    // Backfill malas: karyawan hired tanpa kartu current langsung diterbitkan
    // kartunya (janji "terbit otomatis saat Diterima" — juga menutup data lama).
    const hiredWithoutCard = await db.application.findMany({
      where: { deletedAt: null, hiredAt: { not: null }, employeeCards: { none: { isCurrent: true } } },
      select: { id: true },
      take: 50,
    });
    for (const row of hiredWithoutCard) {
      await ensureEmployeeCard(row.id, { actor: "Sistem" }).catch(() => undefined);
    }

    const rows = await db.employeeCard.findMany({
      orderBy: [{ isCurrent: "desc" }, { issuedAt: "desc" }],
      include: {
        application: {
          select: {
            name: true,
            nik: true,
            hiredAt: true,
            trackingCode: true,
            position: { select: { title: true } },
          },
        },
      },
      take: 200,
    });

    return NextResponse.json(
      rows.map((row) =>
        serializeCard(row, {
          name: row.application.name,
          positionTitle: row.application.position?.title ?? null,
          hiredAt: row.application.hiredAt,
          nik: row.application.nik,
          trackingCode: row.application.trackingCode,
        })
      )
    );
  } catch (error) {
    console.error("[GET /api/admin/cards]", error);
    return NextResponse.json({ error: "Gagal memuat daftar kartu. Coba lagi nanti." }, { status: 500 });
  }
}
