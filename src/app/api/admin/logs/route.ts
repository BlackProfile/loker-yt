// GET /api/admin/logs — riwayat aktivitas (semua role).
// Query opsional (NR-19-c Tugas 2a — filter lanjutan, semua kompatibel mundur):
//   - applicationId : lamaran tertentu (perilaku lama dipertahankan).
//   - limit         : 1-200, default 50 (perilaku lama dipertahankan).
//   - action        : prefix match aman — "OFFER_" mengembalikan semua aksi
//                     berawalan itu. Whitelist karakter [A-Za-z0-9_], maks 40.
//                     Dieksekusi lewat Prisma startsWith (LIKE ter-escape oleh
//                     Prisma; input sudah disaring whitelist sehingga tidak ada
//                     wildcard/metakarakter yang bisa disisipkan).
//   - actor         : contains, maks 80.
//   - from & to     : ISO date -> filter createdAt gte / lte (diabaikan bila tak valid).
//   - q             : contains pada kolom detail, maks 80.
// Where Prisma dibangun kondisional — hanya filter yang terisi yang disertakan.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { LogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

/** Teks aman: trim + potong panjang maksimum. */
function cleanText(value: string | null, max: number): string {
  return (value ?? "").trim().slice(0, max);
}

/** Parse ISO date; null bila kosong/tidak valid. */
function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const applicationId = searchParams.get("applicationId") ?? undefined;
    const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    // Filter lanjutan (NR-19-c).
    const rawAction = cleanText(searchParams.get("action"), 40);
    const action = /^[A-Za-z0-9_]+$/.test(rawAction) ? rawAction : "";
    const actor = cleanText(searchParams.get("actor"), 80);
    const q = cleanText(searchParams.get("q"), 80);
    const from = parseIsoDate(searchParams.get("from"));
    const to = parseIsoDate(searchParams.get("to"));

    const rows = await db.activityLog.findMany({
      where: {
        ...(applicationId ? { applicationId } : {}),
        ...(action ? { action: { startsWith: action } } : {}),
        ...(actor ? { actor: { contains: actor } } : {}),
        ...(q ? { detail: { contains: q } } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { application: { select: { name: true } } },
    });

    const logs: LogEntry[] = rows.map((row) => ({
      id: row.id,
      applicationId: row.applicationId,
      applicationName: row.application?.name ?? null,
      actor: row.actor,
      action: row.action,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json(logs);
  } catch (error) {
    console.error("[GET /api/admin/logs]", error);
    return NextResponse.json({ error: "Gagal memuat riwayat aktivitas. Coba lagi nanti." }, { status: 500 });
  }
}
