// POST /api/admin/webhook-test — uji konfigurasi notifikasi Discord & Telegram (khusus OWNER).
import { NextRequest, NextResponse } from "next/server";
import {
  getAutomationSettings,
  sendDiscordNotification,
  sendTelegramNotification,
  type NotifyChannelResult,
} from "@/lib/notify";
import { getSession, requireRole } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const TEST_MESSAGE = "Tes konfigurasi notifikasi Lumina Studio - berhasil";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(_req: NextRequest) {
  try {
    const session = await requireRole(["OWNER"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, { status: anySession ? 403 : 401 });
    }

    const settings = await getAutomationSettings();

    let discord: NotifyChannelResult;
    if (settings.discordWebhookUrl) {
      discord = await sendDiscordNotification(settings.discordWebhookUrl, { content: TEST_MESSAGE });
    } else {
      discord = "nonaktif";
    }

    let telegram: NotifyChannelResult;
    if (settings.telegramBotToken && settings.telegramChatId) {
      telegram = await sendTelegramNotification(settings.telegramBotToken, settings.telegramChatId, TEST_MESSAGE);
    } else {
      telegram = "nonaktif";
    }

    // Detail hanya ke console — JANGAN pernah me-log token.
    console.log(`[webhook-test] Discord: ${discord}; Telegram: ${telegram}`);

    return NextResponse.json({ discord, telegram });
  } catch (error) {
    console.error("[POST /api/admin/webhook-test]", errorMessage(error));
    return NextResponse.json({ error: "Gagal menguji notifikasi. Coba lagi." }, { status: 500 });
  }
}
