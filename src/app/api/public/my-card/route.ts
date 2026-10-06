// GET /api/public/my-card?kode=LM-XXXXXX — kartu milik pelamar sendiri via kode pelacakan.
// Hanya untuk lamaran yang sudah diterima (hiredAt terisi). Mengembalikan DTO kartu +
// token QR bertanda tangan (kartu memang miliknya — QR tercetak di kartu).
// Kartu belum ada -> dibuat otomatis (backfill malas, alur yang sama dengan panel admin).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureEmployeeCard, serializeCard, signCardToken } from "@/lib/employee-cards";
import type { EmployeeCardDto } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const kode = (req.nextUrl.searchParams.get("kode") ?? "").trim().toUpperCase().slice(0, 24);
    if (!kode) {
      return NextResponse.json({ error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }

    const app = await db.application.findUnique({
      where: { trackingCode: kode },
      select: {
        id: true,
        hiredAt: true,
        deletedAt: true,
        name: true,
        nik: true,
        trackingCode: true,
        position: { select: { title: true } },
      },
    });
    if (!app || app.deletedAt || !app.hiredAt) {
      return NextResponse.json(
        { error: "Kartu belum tersedia — kartu terbit setelah lamaran diterima." },
        { status: 404 }
      );
    }

    const dto = await ensureEmployeeCard(app.id, { actor: "Sistem" });
    if (!dto) {
      return NextResponse.json(
        { error: "Kartu belum tersedia — kartu terbit setelah lamaran diterima." },
        { status: 404 }
      );
    }

    const row = await db.employeeCard.findUnique({ where: { id: dto.id } });
    const verifyToken = row ? await signCardToken(row.token) : null;

    const card: EmployeeCardDto & { verifyToken: string | null } = { ...dto, verifyToken };
    return NextResponse.json({ card }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/public/my-card]", error);
    return NextResponse.json({ error: "Gagal memuat kartu. Coba lagi nanti." }, { status: 500 });
  }
}
