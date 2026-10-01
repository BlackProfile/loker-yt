// Notifikasi webhook (Discord & Telegram) + bot Telegram admin + pembacaan pengaturan otomasi situs.
// SERVER-ONLY — jangan pernah diimpor dari komponen klien. JANGAN PERNAH me-log token.
import { db } from "@/lib/db";
import { DEFAULT_TELEGRAM_ALERTS, TELEGRAM_ALERT_KEYS, type TelegramAlertKey, type TelegramAlerts } from "@/lib/types";

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
  telegramChatId: string; // chat lama (satu chat) — tetap didukung
  telegramWriteEnabled: boolean; // izinkan aksi tulis dari bot Telegram
  telegramAllowedChats: string[]; // chat terdaftar (hasil pairing); gabungan dengan legacy chatId
  telegramAlerts: TelegramAlerts; // toggle per jenis alert
};

const DEFAULT_AUTOMATION: AutomationSettings = {
  chatbotEnabled: false,
  discordWebhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
  telegramWriteEnabled: true,
  telegramAllowedChats: [],
  telegramAlerts: { ...DEFAULT_TELEGRAM_ALERTS },
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

    // Toggle alert: ambil boolean yang valid; field tidak dikenal fallback ke default.
    const rawAlerts =
      obj.telegramAlerts && typeof obj.telegramAlerts === "object" && !Array.isArray(obj.telegramAlerts)
        ? (obj.telegramAlerts as Record<string, unknown>)
        : {};
    const alerts: TelegramAlerts = { ...DEFAULT_TELEGRAM_ALERTS };
    for (const key of TELEGRAM_ALERT_KEYS) {
      if (typeof rawAlerts[key] === "boolean") alerts[key] = rawAlerts[key];
    }

    // Whitelist chat: gabung daftar hasil pairing dengan legacy chatId (jika terisi).
    const allowedRaw = Array.isArray(obj.telegramAllowedChats) ? obj.telegramAllowedChats : [];
    const allowedChats: string[] = [];
    for (const item of allowedRaw) {
      if (typeof item !== "string") continue;
      const clean = item.trim().slice(0, 60);
      if (clean && !allowedChats.includes(clean)) allowedChats.push(clean);
    }
    const legacyChat = typeof obj.telegramChatId === "string" ? obj.telegramChatId.trim() : "";
    if (legacyChat && !allowedChats.includes(legacyChat)) allowedChats.push(legacyChat);

    return {
      chatbotEnabled: typeof obj.chatbotEnabled === "boolean" ? obj.chatbotEnabled : false,
      discordWebhookUrl: typeof obj.discordWebhookUrl === "string" ? obj.discordWebhookUrl.trim() : "",
      telegramBotToken: typeof obj.telegramBotToken === "string" ? obj.telegramBotToken.trim() : "",
      telegramChatId: legacyChat,
      telegramWriteEnabled: typeof obj.telegramWriteEnabled === "boolean" ? obj.telegramWriteEnabled : true,
      telegramAllowedChats: allowedChats,
      telegramAlerts: alerts,
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

/** Satu baris tombol inline Telegram. */
export type TelegramButton = { text: string; url?: string; callback_data?: string };

/**
 * Kirim pesan teks via Telegram Bot API (POST sendMessage, dukung tombol inline).
 * Return "nonaktif" bila token/chatId kosong, "ok" bila 2xx, "gagal" bila error/bukan 2xx.
 */
export async function sendTelegramNotification(
  botToken: string,
  chatId: string,
  text: string,
  opts?: { buttons?: TelegramButton[][] },
): Promise<NotifyChannelResult> {
  if (!botToken || !chatId) return "nonaktif";
  try {
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, 3900), // batas aman pesan Telegram 4096 karakter
    };
    if (opts?.buttons && opts.buttons.length > 0) {
      payload.reply_markup = {
        inline_keyboard: opts.buttons.map((row) =>
          row.map((btn) =>
            btn.url
              ? { text: btn.text, url: btn.url }
              : { text: btn.text, callback_data: btn.callback_data ?? "noop" },
          ),
        ),
      };
    }
    const res = await fetchWithTimeout(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return res.ok ? "ok" : "gagal";
  } catch {
    return "gagal";
  }
}

/** URL dasar situs untuk tautan di pesan bot (set NEXT_PUBLIC_SITE_URL saat deploy). */
export function getSiteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "") || "http://localhost:3000";
}

/**
 * Kirim alert ke semua chat Telegram terdaftar sesuai jenis event (digate toggle
 * telegramAlerts di Setelan). Tidak pernah melempar error; return jumlah chat yang
 * berhasil dikirimi pesan (0 bila nonaktif).
 */
export async function sendTelegramAlert(
  alertKey: TelegramAlertKey,
  text: string,
  opts?: { buttons?: TelegramButton[][] },
): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    if (!settings.telegramAlerts[alertKey]) return 0;
    if (settings.telegramAllowedChats.length === 0) return 0;
    let sent = 0;
    for (const chat of settings.telegramAllowedChats) {
      const result = await sendTelegramNotification(settings.telegramBotToken, chat, text, opts);
      if (result === "ok") sent += 1;
    }
    return sent;
  } catch {
    return 0;
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

    // Tombol aksi bot Telegram: Tinjau (buka dashboard), Ajak Wawancara & Tolak
    // (callback dua langkah) — hanya bila aksi tulis diizinkan.
    const telegramButtons: TelegramButton[][] = [[
      { text: "Tinjau di Dashboard", url: `${getSiteUrl()}/?kandidat=${encodeURIComponent(trackingCode)}#admin` },
    ]];
    if (settings.telegramWriteEnabled) {
      telegramButtons.push([
        { text: "Ajak Wawancara", callback_data: `app:${app.id}:interview` },
        { text: "Tolak", callback_data: `app:${app.id}:reject` },
      ]);
    }

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

    // Channel Telegram — dikirim ke semua chat terdaftar (whitelist), digate toggle alert.
    if (settings.telegramBotToken && settings.telegramAlerts.newApplication && settings.telegramAllowedChats.length > 0) {
      try {
        for (const chat of settings.telegramAllowedChats) {
          const result = await sendTelegramNotification(settings.telegramBotToken, chat, telegramText, {
            buttons: telegramButtons,
          });
          if (result === "ok") telegram = "ok";
          else telegram = result === "gagal" ? "gagal" : telegram;
        }
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

/**
 * Notifikasi event sistem generik (reminder wawancara, offer, hasil) ke Discord & Telegram.
 * Tidak pernah melempar error. applicationId opsional untuk log per kandidat.
 */
export async function sendSystemEvent(params: {
  title: string;
  detail: string;
  applicationId?: string;
  action?: string; // default "NOTIFY"
  category?: string; // kategori notifikasi in-app: SYSTEM | OFFER | INTERVIEW | APPLICATION | LOGIN
  trackingCode?: string; // untuk tautan "Lihat Kandidat" di tombol Telegram
}): Promise<void> {
  const action = params.action ?? "NOTIFY";
  let discord: NotifyChannelResult = "nonaktif";
  let telegram: NotifyChannelResult = "nonaktif";
  try {
    const settings = await getAutomationSettings();
    const telegramText = `${params.title}\n${params.detail}`;
    if (isValidDiscordWebhook(settings.discordWebhookUrl)) {
      try {
        discord = await sendDiscordNotification(settings.discordWebhookUrl, {
          content: "",
          embeds: [
            {
              title: params.title,
              description: params.detail,
              color: 15158332,
            },
          ],
        });
      } catch {
        discord = "gagal";
      }
    }
    // Telegram: dikirim ke semua chat terdaftar, digate toggle "system" (event sistem).
    if (settings.telegramBotToken && settings.telegramAlerts.system && settings.telegramAllowedChats.length > 0) {
      try {
        for (const chat of settings.telegramAllowedChats) {
          const result = await sendTelegramNotification(
            settings.telegramBotToken,
            chat,
            telegramText,
            params.applicationId && params.trackingCode && settings.telegramWriteEnabled
              ? { buttons: [[{ text: "Lihat Kandidat", url: `${getSiteUrl()}/?kandidat=${encodeURIComponent(params.trackingCode)}#admin` }]] }
              : undefined,
          );
          if (result === "ok") telegram = "ok";
          else if (result === "gagal") telegram = "gagal";
        }
      } catch {
        telegram = "gagal";
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[notify] sendSystemEvent gagal:", message);
  }

  try {
    await db.activityLog.create({
      data: {
        applicationId: params.applicationId ?? null,
        actor: "Sistem",
        action,
        detail: `${params.title} | Discord: ${discord}; Telegram: ${telegram}`,
      },
    });
  } catch {
    // logging tidak boleh menggagalkan alur utama
  }

  // Notifikasi in-app untuk ikon lonceng admin (gagal = diam, jangan ganggu alur utama).
  try {
    await db.notificationItem.create({
      data: {
        title: params.title,
        body: params.detail,
        category: params.category ?? "SYSTEM",
        applicationId: params.applicationId ?? null,
      },
    });
  } catch {
    // diam
  }
}

/**
 * Simpan notifikasi in-app saja (tanpa webhook) — dipakai event yang cukup
 * tampil di pusat notifikasi admin.
 */
export async function pushNotification(params: {
  title: string;
  body?: string;
  category?: string;
  applicationId?: string;
}): Promise<void> {
  try {
    await db.notificationItem.create({
      data: {
        title: params.title,
        body: params.body ?? null,
        category: params.category ?? "SYSTEM",
        applicationId: params.applicationId ?? null,
      },
    });
  } catch {
    // diam
  }
}

/**
 * Masukkan email ke kotak keluar (EmailOutbox). Bila SMTP terkonfigurasi lewat
 * env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM), email dicoba
 * dikirim langsung; selain itu tetap tersimpan berstatus QUEUED untuk arsip
 * dan bisa dikirim ulang manual dari admin.
 * Tidak pernah melempar error.
 */
export async function queueEmail(params: {
  toEmail: string;
  subject: string;
  body: string;
  kind?: string;
  applicationId?: string;
}): Promise<void> {
  let recordId: string | null = null;
  try {
    const record = await db.emailOutbox.create({
      data: {
        toEmail: params.toEmail,
        subject: params.subject,
        body: params.body,
        kind: params.kind ?? "SYSTEM",
        applicationId: params.applicationId ?? null,
        status: "QUEUED",
      },
    });
    recordId = record.id;
  } catch {
    return; // gagal menyimpan — tidak boleh menggagalkan alur utama
  }

  const host = process.env.SMTP_HOST;
  if (!host) return; // tanpa SMTP — email tetap terarsip berstatus QUEUED

  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASS
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "lumina@localhost",
      to: params.toEmail,
      subject: params.subject,
      text: params.body,
    });
    await db.emailOutbox.update({
      where: { id: recordId },
      data: { status: "SENT", sentAt: new Date() },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await db.emailOutbox.update({
        where: { id: recordId },
        data: { status: "FAILED", error: message.slice(0, 300) },
      });
    } catch {
      // diam
    }
    // Alert bot Telegram: email gagal terkirim (digate toggle; fire-and-forget).
    void sendTelegramAlert(
      "emailFailed",
      `Email Gagal Terkirim\nKepada: ${params.toEmail}\nSubjek: ${params.subject}\nPenyebab: ${message.slice(0, 200)}`,
    );
  }
}
