// GET  /api/admin/reports/monthly — daftar snapshot rekap bulanan (semua role).
// POST /api/admin/reports/monthly — buat/perbarui snapshot (OWNER/HR).
//   Body: { month?: "YYYY-MM" } — default: bulan sebelumnya.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  buildMonthlySnapshot,
  monthRange,
  previousMonthKey,
  type MonthlyReportData,
} from "@/lib/monthly-report";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

function parseSnapshot(row: { id: string; month: string; data: string; createdAt: Date }): {
  id: string;
  month: string;
  createdAt: string;
  data: MonthlyReportData | null;
} {
  let data: MonthlyReportData | null = null;
  try {
    const parsed: unknown = JSON.parse(row.data);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as MonthlyReportData;
    }
  } catch {
    data = null;
  }
  return { id: row.id, month: row.month, createdAt: row.createdAt.toISOString(), data };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const rows = await db.monthlyReport.findMany({ orderBy: { month: "desc" } });
    return NextResponse.json({ reports: rows.map(parseSnapshot) });
  } catch (error) {
    console.error("[GET /api/admin/reports/monthly]", error);
    return NextResponse.json({ error: "Gagal memuat rekap bulanan. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const body: unknown = await req.json().catch(() => ({}));
    const raw = (body as Record<string, unknown> | null)?.month;
    const monthKey = typeof raw === "string" && monthRange(raw) ? raw : previousMonthKey(new Date());
    if (!monthRange(monthKey)) {
      return NextResponse.json({ error: "Format bulan tidak valid (contoh: 2026-09)." }, { status: 400 });
    }
    const data = await buildMonthlySnapshot(monthKey);
    const row = await db.monthlyReport.upsert({
      where: { month: monthKey },
      update: { data: JSON.stringify(data) },
      create: { month: monthKey, data: JSON.stringify(data) },
    });
    return NextResponse.json({ ok: true, report: parseSnapshot(row) });
  } catch (error) {
    console.error("[POST /api/admin/reports/monthly]", error);
    return NextResponse.json({ error: "Gagal membuat rekap bulanan. Coba lagi nanti." }, { status: 500 });
  }
}
