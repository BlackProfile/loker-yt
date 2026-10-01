// POST /api/telegram/digest — picu digest pagi bot Telegram (dipanggil cron
// reminders tiap menit via realtime-service, atau manual untuk pengujian).
// Dilindungi header x-telegram-secret (TELEGRAM_BRIDGE_SECRET). Idempoten:
// hanya mengirim sekali per hari (Setting "site".telegramLastDigest).
import { NextRequest, NextResponse } from "next/server";
import { runTelegramDigest } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

const BRIDGE_SECRET = process.env.TELEGRAM_BRIDGE_SECRET ?? "lumina-telegram-secret";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-telegram-secret");
    if (!secret || secret !== BRIDGE_SECRET) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const force = req.nextUrl.searchParams.get("force") === "1";
    const result = await runTelegramDigest(force);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[POST /api/telegram/digest]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal menjalankan digest." }, { status: 500 });
  }
}
