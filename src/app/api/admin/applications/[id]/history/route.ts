// NR-24 — Riwayat melamar pelamar yang sama (lintas posisi).
// GET /api/admin/applications/[id]/history — lamaran lain dengan email sama (case-insensitive),
// belum terhapus, maks 10 terbaru (semua role admin).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { ApplicationHistoryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

const HISTORY_MAX = 10;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const existing = await db.application.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Ambil semua lamaran dengan email sama (tanpa case di SQL), lalu saring persis
    // lowercase di JS agar konsisten lintas basis data.
    const sameEmail = await db.application.findMany({
      where: { email: existing.email, id: { not: id }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        trackingCode: true,
        status: true,
        createdAt: true,
        aiScore: true,
        email: true,
        position: { select: { title: true } },
      },
    });

    const emailLower = existing.email.toLowerCase();
    const history: ApplicationHistoryItem[] = sameEmail
      .filter((row) => row.email.toLowerCase() === emailLower)
      .slice(0, HISTORY_MAX)
      .map((row) => ({
        id: row.id,
        trackingCode: row.trackingCode,
        positionTitle: row.position?.title ?? null,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        aiScore: row.aiScore,
      }));

    return NextResponse.json({ history });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/history]", error);
    return NextResponse.json({ error: "Gagal memuat riwayat melamar." }, { status: 500 });
  }
}
