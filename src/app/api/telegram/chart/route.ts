// POST /api/telegram/chart — picu grafik mingguan bot Telegram secara manual
// (cron memanggilnya otomatis tiap Senin pagi; endpoint ini untuk pengujian atau
// kirim ulang). Dilindungi header x-telegram-secret (TELEGRAM_BRIDGE_SECRET).
// force=1 mengabaikan jadwal Senin & penanda harian (telegramLastChart).
import { NextRequest, NextResponse } from "next/server";
import { runTelegramWeeklyChart } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

const BRIDGE_SECRET = process.env.TELEGRAM_BRIDGE_SECRET ?? "lumina-telegram-secret";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-telegram-secret");
    if (!secret || secret !== BRIDGE_SECRET) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const force = req.nextUrl.searchParams.get("force") === "1";
    const result = await runTelegramWeeklyChart(force);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[POST /api/telegram/chart]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal menjalankan grafik mingguan." }, { status: 500 });
  }
}
