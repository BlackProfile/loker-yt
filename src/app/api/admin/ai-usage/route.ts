// NR49-A — GET /api/admin/ai-usage?days=14 — Log Aktivitas AI (semua role login):
//           total ok/error/blokir, deret harian, dan log terbaru dari tabel AiJobLog.
//           Query ?days= (default 14) di-clamp 1-60 hari.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import { getAiUsageView } from "@/lib/ai-control";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });

    const rawDays = Number(req.nextUrl.searchParams.get("days"));
    const days =
      Number.isFinite(rawDays) && rawDays >= 1 ? Math.min(60, Math.floor(rawDays)) : 14;

    const usage = await getAiUsageView(days);
    return NextResponse.json({ usage });
  } catch (error) {
    console.error("[GET /api/admin/ai-usage]", error);
    return NextResponse.json({ error: "Gagal memuat log aktivitas AI." }, { status: 500 });
  }
}
