// GET /api/telegram/config — konfigurasi polling untuk mini-service telegram-bot.
// Dilindungi header x-telegram-secret (TELEGRAM_BRIDGE_SECRET).
// Token bot TIDAK dikirim dari endpoint ini — mini-service tetap tidak pernah
// menyimpan token; hanya status apakah polling boleh jalan.
import { NextRequest, NextResponse } from "next/server";
import { getAutomationSettings } from "@/lib/notify";

export const dynamic = "force-dynamic";

const BRIDGE_SECRET = process.env.TELEGRAM_BRIDGE_SECRET ?? "lumina-telegram-secret";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-telegram-secret");
  if (!secret || secret !== BRIDGE_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const settings = await getAutomationSettings();
  return NextResponse.json({
    enabled: Boolean(settings.telegramBotToken),
    pollSeconds: 25,
  });
}
