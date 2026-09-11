// Notifikasi webhook (Discord & Telegram) + pembacaan pengaturan otomasi situs.
// SERVER-ONLY — jangan pernah diimpor dari komponen klien. JANGAN PERNAH me-log token.
import { db } from "@/lib/db";

const WEBHOOK_TIMEOUT_MS = 8_000; // 8 detik per channel

const DISCORD_WEBHOOK_PREFIXES = [
  "https://discord.com/api/webhooks",
  "https://discordapp.com/api/webhooks",
];

export type NotifyChannelResult = "ok" | "gagal" | "nonaktif";

export type NotifyResult = {
  discord: NotifyChannelResult;
  telegram: NotifyChannelResult;
};

export type AutomationSettings = {
  chatbotEnabled: boolean;
  discordWebhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
};

const DEFAULT_AUTOMATION: AutomationSettings = {
  chatbotEnabled: true,
  discordWebhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
};

/** Baca Setting "site" dan ambil field otomasi secara aman (fallback default bila rusak). */
export async function getAutomationSettings(): Promise<AutomationSettings> {
  try {
    const setting = await db.setting.findUnique({ where: { key: "site" } });
    if (!setting) return { ...DEFAULT_AUTOMATION };
    const parsed: unknown = JSON.parse(setting.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_AUTOMATION };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      chatbotEnabled: typeof obj.chatbotEnabled === "boolean" ? obj.chatbotEnabled : true,
      discordWebhookUrl: typeof obj.discordWebhookUrl === "string" ? obj.discordWebhookUrl.trim() : "",
      telegramBotToken: typeof obj.telegramBotToken === "string" ? obj.telegramBotToken.trim() : "",
      telegramChatId: typeof obj.telegramChatId === "string" ? obj.telegramChatId.trim() : "",
    };
  } catch {
    return { ...DEFAULT_AUTOMATION };
  }
}

/** True bila URL berformat webhook Discord yang valid. */
export function isValidDiscordWebhook(url: string): boolean {
  return DISCORD_WEBHOOK_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/** fetch dengan timeout (default 8 detik). */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number = WEBHOOK_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kirim payload JSON ke webhook Discord.
 * Return "nonaktif" bila URL tidak valid, "ok" bila 2xx, "gagal" bila error/bukan 2xx.
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  payload: Record<string, unknown>,
): Promise<NotifyChannelResult> {
  if (!isValidDiscordWebhook(webhookUrl)) return "nonaktif";
  try {
    const res = await fetchWithTimeout(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok ? "ok" : "gagal";
  } catch {
    return "gagal";
  }
}

/**
 * Kirim pesan teks via Telegram Bot API (GET sendMessage).
 * Return "nonaktif" bila token/chatId kosong, "ok" bila 2xx, "gagal" bila error/bukan 2xx.
 */
export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  text: string,
): Promise<NotifyChannelResult> {
  if (!botToken || !chatId) return "nonaktif";
  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage?chat_id=${encodeURIComponent(chatId)}&text=${encodeURIComponent(text)}`;
    const res = await fetchWithTimeout(url, { method: "GET" });
    return res.ok ? "ok" : "gagal";
  } catch {
    return "gagal";
  }
}

/**
 * Notifikasi lamaran baru ke Discord & Telegram (jika terkonfigurasi di Setting "site").
 * Tidak pernah melempar error; selalu mencatat SATU ActivityLog ringkas tanpa token.
 */
export async function sendNewApplicationNotifications(app: {
  id: string;
  name: string;
  positionTitle: string | null;
  trackingCode: string | null;
}): Promise<void> {
  let discord: NotifyChannelResult = "nonaktif";
  let telegram: NotifyChannelResult = "nonaktif";
  try {
    const settings = await getAutomationSettings();
    const positionTitle = app.positionTitle?.trim() || "posisi umum";
    const trackingCode = app.trackingCode?.trim() || "-";
    const telegramText = `Lamaran Baru Masuk\n${app.name} melamar posisi ${positionTitle}.\nKode: ${trackingCode}`;

    // Channel Discord (try/catch ditangani di dalam helper, tetap pisahkan logika per channel)
    if (isValidDiscordWebhook(settings.discordWebhookUrl)) {
      try {
        discord = await sendDiscordNotification(settings.discordWebhookUrl, {
          content: "",
          embeds: [
            {
              title: "Lamaran Baru Masuk",
              description: `**${app.name}** melamar posisi **${positionTitle}**.\nKode: \`${trackingCode}\``,
              color: 15158332,
            },
          ],
        });
      } catch {
        discord = "gagal";
      }
    }

    // Channel Telegram
    if (settings.telegramBotToken && settings.telegramChatId) {
      try {
        telegram = await sendTelegramNotification(settings.telegramBotToken, settings.telegramChatId, telegramText);
      } catch {
        telegram = "gagal";
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[notify] sendNewApplicationNotifications gagal:", message);
  }

  try {
    await db.activityLog.create({
      data: {
        applicationId: app.id,
        actor: "Sistem",
        action: "WEBHOOK",
        detail: `Discord: ${discord}; Telegram: ${telegram}`,
      },
    });
  } catch (logError) {
    const message = logError instanceof Error ? logError.message : String(logError);
    console.error("[notify] gagal menulis ActivityLog WEBHOOK:", message);
  }
}
