// GET /api/admin/applications/[id]/dossier — lamaran lain dari orang yang sama
// (NR38-C fitur 6: dossier pelamar ganda). Kecocokan: email sama (case-insensitive)
// ATAU digit nomor WA sama ATAU NIK sama (bila terisi). Maks 20 lamaran terbaru.
// Read-only; dipakai dialog detail untuk memeriksa lamaran ganda secara proaktif.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const DOSSIER_MAX = 20;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const current = await db.application.findUnique({
      where: { id },
      select: { id: true, email: true, phone: true, nik: true },
    });
    if (!current) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const currentEmail = current.email.trim().toLowerCase();
    const currentPhoneDigits = current.phone.replace(/[^0-9]/g, "");
    const currentNik = (current.nik ?? "").trim();

    const rows = await db.application.findMany({
      where: { id: { not: id }, deletedAt: null },
      select: {
        id: true,
        trackingCode: true,
        name: true,
        email: true,
        phone: true,
        nik: true,
        status: true,
        createdAt: true,
        rating: true,
        aiScore: true,
        talentPool: true,
        isDuplicate: true,
        rejectionReason: true,
        position: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const items = rows
      .filter((row) => {
        const emailMatch =
          currentEmail.length > 0 && row.email.trim().toLowerCase() === currentEmail;
        const phoneMatch =
          currentPhoneDigits.length > 0 &&
          row.phone.replace(/[^0-9]/g, "") === currentPhoneDigits;
        const rowNik = (row.nik ?? "").trim();
        const nikMatch = currentNik.length > 0 && rowNik === currentNik;
        return emailMatch || phoneMatch || nikMatch;
      })
      .slice(0, DOSSIER_MAX)
      .map((row) => ({
        id: row.id,
        trackingCode: row.trackingCode ?? "",
        name: row.name,
        positionTitle: row.position?.title ?? null,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        rating: row.rating,
        aiScore: row.aiScore,
        talentPool: row.talentPool,
        isDuplicate: row.isDuplicate,
        rejectionReason: row.rejectionReason,
      }));

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/dossier]", error);
    return NextResponse.json(
      { error: "Gagal memuat dossier pelamar. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
