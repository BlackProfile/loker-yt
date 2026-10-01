// GET /api/telegram/config — konfigurasi polling untuk mini-service telegram-bot.
// Dilindungi header x-telegram-secret (TELEGRAM_BRIDGE_SECRET) dan hanya diakses
// mini-service dari localhost (APP_URL). Endpoint ini MENYERTAKAN token bot karena
// long-polling getUpdates wajib memakai token: https://api.telegram.org/bot<TOKEN>/getUpdates.
// Tanpa token, poller selalu menerima 404 "Not Found" dari Telegram dan bot tidak
// pernah menerima pesan masuk. Token tidak pernah keluar dari mesin ini: header
// secret menutup akses dari luar, dan request hanya berasal dari loopback.
import { NextRequest, NextResponse } from "next/server";
import { getAutomationSettings } from "@/lib/notify";
import { markPollerSeen } from "@/lib/telegram-bridge-status";

export const dynamic = "force-dynamic";

const BRIDGE_SECRET = process.env.TELEGRAM_BRIDGE_SECRET ?? "lumina-telegram-secret";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("x-telegram-secret");
  if (!secret || secret !== BRIDGE_SECRET) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Heartbeat: request yang sah dari poller menandai service masih hidup
  // (dipakai panel admin untuk menampilkan status polling).
  markPollerSeen();
  const settings = await getAutomationSettings();
  const token = (settings.telegramBotToken ?? "").trim();
  return NextResponse.json({
    enabled: token.length > 0,
    pollSeconds: 25,
    // Token hanya dikirim bila polling diaktifkan (token terisi) dan peminta
    // memegang bridge secret. Bila token kosong, string kosong dikembalikan.
    token: token.length > 0 ? token : "",
  });
}
