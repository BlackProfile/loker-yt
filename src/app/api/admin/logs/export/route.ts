// GET /api/admin/logs/export — unduh log aktivitas sebagai CSV (NR-19-c Tugas 2b).
// Role OWNER|HR saja -> VIEWER mendapat 403.
// Filter sama dengan GET /api/admin/logs (action prefix, actor, from/to, q —
// tanpa applicationId/limit; selalu maksimal 5000 baris terbaru).
// Respons: CSV UTF-8 dengan BOM, kolom: waktu (ISO), aktor, aksi, detail, lamaran
// (nama kandidat, fallback kode tracking bila nama tidak ada). Filename:
// log-aktivitas-YYYY-MM-DD.csv.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya Owner dan HR yang dapat mengunduh log aktivitas." };

const MAX_ROWS = 5000;

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

/** Escape satu sel CSV: beri kutip bila memuat koma/kutip/baris baru. */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "HR") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { searchParams } = new URL(req.url);

    // Filter lanjutan — logika parsing sama dengan /api/admin/logs.
    const rawAction = cleanText(searchParams.get("action"), 40);
    const action = /^[A-Za-z0-9_]+$/.test(rawAction) ? rawAction : "";
    const actor = cleanText(searchParams.get("actor"), 80);
    const q = cleanText(searchParams.get("q"), 80);
    const from = parseIsoDate(searchParams.get("from"));
    const to = parseIsoDate(searchParams.get("to"));

    const rows = await db.activityLog.findMany({
      where: {
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
      take: MAX_ROWS,
      include: { application: { select: { name: true, trackingCode: true } } },
    });

    // Susun CSV: BOM UTF-8 agar Excel mengenali encoding, baris diakhiri CRLF.
    const lines: string[] = ["waktu,aktor,aksi,detail,lamaran"];
    for (const row of rows) {
      lines.push(
        [
          csvCell(row.createdAt.toISOString()),
          csvCell(row.actor),
          csvCell(row.action),
          csvCell(row.detail ?? ""),
          csvCell(row.application?.name ?? row.application?.trackingCode ?? ""),
        ].join(",")
      );
    }
    const csv = `\uFEFF${lines.join("\r\n")}\r\n`;

    const filename = `log-aktivitas-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/logs/export]", error);
    return NextResponse.json(
      { error: "Gagal mengekspor log aktivitas. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
