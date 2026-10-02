// Bot Telegram dua arah untuk admin Lumina Studio — SERVER-ONLY.
// Menerima update dari mini-service poller (mini-services/telegram-bot) via
// POST /api/telegram/update, lalu memproses perintah & callback di sini
// (semua akses DB tetap milik aplikasi Next.js — poller tidak menyentuh DB).
//
// Perintah baca:  /ringkasan /posisi /kandidat /jadwal /laporan /export /bantuan
// Perintah tulis: /skor KODE n, /offer KODE (wizard), /draft KODE (AI), /bandingkan KODE1 KODE2
// Perintah lain:  /catatan KODE teks (catatan internal), /diam (mode diam), /bangun
//                 /setelan (toggle alert & mode), /whoami, /health, /lowongan (subscribe publik)
// Pesan bebas:    teks non-perintah dijawab asisten LLM (read-only, data rekrutmen)
//                 kode pelacakan polos (LM-XXXXXX) -> status kandidat + langganan notifikasi tahap
// Media:          kirim dokumen/foto + caption berisi kode kandidat -> lampiran;
//                 voice note + caption kode -> transkripsi ASR -> catatan; voice dengan
//                 pola perintah ("catatan LM-... ...", "skor LM-... 4") -> dieksekusi sebagai perintah
// Aksi tulis:     tombol inline kartu kandidat (Tinjau / Ajak Wawancara / Lolos /
//                 Tahan / Tolak / Unduh CV / Ingatkan 3 hari / Pindah Tahap) + Tutup Posisi
//                 + Tandai Semua Ditinjau (per posisi)
// Proaktif:       digest pagi & sore, rekap mingguan Senin, pengingat snooze, alert kuota (80% & penuh),
//                 pengingat wawancara H-1 hari & H-2 jam, alert SLA lamaran menginap, notifikasi
//                 aktivitas pelamar, watch perubahan tahap (langganan kandidat), broadcast lowongan baru,
//                 ekspor CSV terjadwal Senin
// Mode tenang:    alert non-kritis di luar 08.00-21.00 WIB ditahan & dirangkum digest pagi
// Keamanan:       hanya chat di whitelist (telegramAllowedChats) dilayani; pairing
//                 via kode dari panel admin (/mulai KODE); rate limit per chat;
//                 semua aksi tulis tercatat di ActivityLog dengan aktor "Telegram (...)".
// JANGAN PERNAH me-log token bot.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "@/lib/db";
import {
  activeChats,
  bangkokHourNow,
  getAutomationSettings,
  getSiteUrl,
  isChatMuted,
  isTelegramQuietNow,
  type TelegramButton,
} from "@/lib/notify";
import { getZai, withTimeout, withZaiRetry } from "@/lib/ai";
import { isBuiltInStage, stageLabel } from "@/lib/stages";
import {
  INTERVIEW_PLATFORM_LABELS,
  STATUS_LABELS,
  TELEGRAM_ALERT_KEYS,
  TELEGRAM_ALERT_LABELS,
  type ApplicationStatus,
  type TelegramAlertKey,
} from "@/lib/types";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { emitWebhook } from "@/lib/webhooks";
import { sendCandidateStatusEmail } from "@/lib/candidate-emails";
import { appendStageHistory } from "@/lib/stage-history";

const execFileAsync = promisify(execFile);

const TG_API_TIMEOUT_MS = 10_000;
const TG_FILE_TIMEOUT_MS = 30_000; // unduh/unggah file butuh waktu lebih
const TG_FILE_MAX_BYTES = 20 * 1024 * 1024; // batas Bot API: 20 MB
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;
const POSISI_PAGE_SIZE = 6;
const PAIR_SETTING_KEY = "telegramPair";
const DIGEST_HOUR_BANGKOK = 7;
const CHART_HOUR_BANGKOK = 8; // grafik mingguan Senin, menyusul digest
const EVENING_DIGEST_HOUR_BANGKOK = 17; // digest sore
const WEEKLY_DIGEST_HOUR_BANGKOK = 8; // rekap mingguan Senin (setelah grafik)
const EXPORT_HOUR_BANGKOK = 9; // ekspor CSV terjadwal Senin
const SLA_STALE_DAYS = 3; // lamaran NEW/REVIEWED menginap > 3 hari -> alert
const SNOOZE_DEFAULT_DAYS = 3;
const VOICE_MAX_SECONDS = 180;
const QUOTA_WARNING_RATIO = 0.8; // peringatan dini kuota 80% terisi

// Alasan tolak cepat (pilihan tombol) — diterjemahkan menjadi rejectionNote.
const REJECT_REASONS = [
  "Belum sesuai kebutuhan posisi saat ini",
  "Kualifikasi teknis belum memadai",
  "Portofolio kurang relevan",
  "Dipilih kandidat lain yang lebih cocok",
  "Tidak hadir / tidak merespons",
];

// Wizard offer via chat: state tersimpan di Setting "site".telegramWizard
type OfferWizardState = { appId: string; step: "salary" | "type" | "start" | "confirm"; salary?: string; type?: string; start?: string };

/* ------------------------------- Tipe Telegram ------------------------------- */

type TgChat = { id: number; type: string; title?: string; username?: string; first_name?: string };
type TgFrom = { username?: string; first_name?: string; last_name?: string };
type TgPhotoSize = { file_id: string; width: number; height: number; file_size?: number };
type TgFileCommon = { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
type TgVoice = TgFileCommon & { duration: number; mime_type?: string };
type TgMessage = {
  message_id: number;
  chat: TgChat;
  text?: string;
  caption?: string;
  from?: TgFrom;
  photo?: TgPhotoSize[];
  document?: TgFileCommon;
  voice?: TgVoice;
  audio?: TgVoice;
  reply_to_message?: { text?: string; caption?: string };
};
type TgCallbackQuery = { id: string; data?: string; from?: TgFrom; message?: TgMessage };
export type TelegramUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

type SendOptions = { buttons?: TelegramButton[][] };

/* --------------------------------- Util dasar --------------------------------- */

// Retry khusus error jaringan (socket tertutup, timeout, DNS) — error HTTP dari
// Telegram (400/403/404/...) sifatnya deterministik dan TIDAK diulang. Tanpa retry,
// tombol/pesan balasan "hilang" diam-diam saat jaringan flaky (pernah terjadi).
const TG_NETWORK_RETRY_MAX = 3;
const TG_NETWORK_RETRY_DELAY_MS = 900;

function isNetworkErrorMessage(message: string): boolean {
  return (
    message.includes("socket") ||
    message.includes("closed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("aborted") ||
    message.includes("Unable to connect") ||
    message.includes("fetch failed")
  );
}

async function tgApi<T = unknown>(token: string, method: string, payload?: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
  let lastError = "unknown error";
  for (let attempt = 1; attempt <= TG_NETWORK_RETRY_MAX; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TG_API_TIMEOUT_MS);
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload ?? {}),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
      if (!res.ok || !json?.ok) return { ok: false, description: json?.description ?? `HTTP ${res.status}` };
      return { ok: true, result: json.result, description: json.description };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "network error";
      if (attempt < TG_NETWORK_RETRY_MAX && isNetworkErrorMessage(lastError)) {
        await new Promise((resolve) => setTimeout(resolve, TG_NETWORK_RETRY_DELAY_MS * attempt));
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  console.warn(`[telegram-bot] tgApi ${method} gagal setelah ${TG_NETWORK_RETRY_MAX} percobaan: ${lastError}`);
  return { ok: false, description: lastError };
}

async function tgSendMessage(token: string, chatId: number | string, text: string, opts?: SendOptions): Promise<boolean> {
  const payload: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true };
  if (opts?.buttons && opts.buttons.length > 0) {
    payload.reply_markup = { inline_keyboard: buildKeyboard(opts.buttons) };
  }
  const res = await tgApi(token, "sendMessage", payload);
  return res.ok;
}

/** Kirim pesan dan kembalikan message_id (untuk diedit belakangan, mis. indikator mengetik). */
async function tgSendMessageTracked(token: string, chatId: number | string, text: string, opts?: SendOptions): Promise<{ message_id?: number }> {
  const payload: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true };
  if (opts?.buttons && opts.buttons.length > 0) {
    payload.reply_markup = { inline_keyboard: buildKeyboard(opts.buttons) };
  }
  const res = await tgApi<{ message_id?: number }>(token, "sendMessage", payload);
  return { message_id: res.result?.message_id };
}

function buildKeyboard(rows: TelegramButton[][]): Record<string, unknown>[][] {
  return rows
    .map((row) => {
      const buttons: Record<string, unknown>[] = [];
      for (const btn of row) {
        if (btn.webAppUrl) {
          // Tombol Telegram Mini App (webview di dalam klien Telegram).
          buttons.push({ text: btn.text, web_app: { url: btn.webAppUrl } });
        } else if (btn.url) {
          buttons.push({ text: btn.text, url: btn.url });
        } else if (btn.callback_data) {
          buttons.push({ text: btn.text, callback_data: btn.callback_data.slice(0, 64) });
        }
      }
      return buttons;
    })
    .filter((row) => row.length > 0);
}

async function tgAnswerCallback(token: string, callbackId: string, text?: string): Promise<void> {
  await tgApi(token, "answerCallbackQuery", { callback_query_id: callbackId, text: text?.slice(0, 190), cache_time: 1 });
}

async function tgEditMessage(token: string, chatId: number | string, messageId: number, text: string, opts?: SendOptions): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
  };
  if (opts?.buttons && opts.buttons.length > 0) {
    payload.reply_markup = { inline_keyboard: buildKeyboard(opts.buttons) };
  }
  const res = await tgApi(token, "editMessageText", payload);
  if (!res.ok) {
    // Pesan lama mungkin tidak bisa diedit (terlalu tua) — kirim pesan baru.
    await tgSendMessage(token, chatId, text, opts);
  }
}

function fmtDT(value: Date): string {
  return value.toLocaleString("id-ID", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "short" });
}

/* ----------------------- Helper penjadwal & status lanjutan ----------------------- */

/** Tanggal (yyyy-mm-dd) menurut zona Asia/Bangkok — kunci idempotensi harian. */
function dateKeyBangkok(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); // en-CA = yyyy-mm-dd
}

/** Kunci minggu ISO (contoh 2026-W40) menurut zona Asia/Bangkok. */
function weekKeyBangkok(d: Date = new Date()): string {
  const parts = d.toLocaleDateString("en-US", { timeZone: "Asia/Bangkok", week: "numeric", year: "numeric" });
  const week = parts.match(/week (\d+)/i)?.[1] ?? "0";
  const year = parts.match(/(\d{4})/)?.[1] ?? "0000";
  return `${year}-W${week.padStart(2, "0")}`;
}

/** Kirim satu pesan ke semua chat admin aktif sesuai toggle alert (tanpa gate jam tenang). */
async function sendToAdminChats(
  settings: Awaited<ReturnType<typeof getAutomationSettings>>,
  alertKey: TelegramAlertKey,
  text: string,
  buttons?: TelegramButton[][],
): Promise<number> {
  if (!settings.telegramBotToken) return 0;
  if (!settings.telegramAlerts[alertKey]) return 0;
  const chats = activeChats(settings);
  let sent = 0;
  for (const chat of chats) {
    const ok = await tgSendMessage(settings.telegramBotToken, chat, text, { buttons });
    if (ok) sent += 1;
  }
  return sent;
}

/** Ambil field dari objek site dengan tipe aman. */
function siteField<T>(site: Record<string, unknown>, key: string, fallback: T): T {
  const value = site[key];
  return value === undefined || value === null ? fallback : (value as T);
}

/** Aplikasi CSV dibangun ulang dari /export — dipakai juga ekspor terjadwal. */
async function buildApplicationCsv(): Promise<{ csv: string; rows: number }> {
  const rows = await db.application.findMany({
    where: { deletedAt: null },
    include: { position: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const header = ["Kode", "Nama", "Email", "Posisi", "Tahap", "Rating", "Masuk"];
  const lines = [header.map(csvCell).join(",")];
  for (const app of rows) {
    lines.push(
      [
        app.trackingCode ?? "",
        app.name,
        app.email,
        app.position?.title ?? "",
        stageLabel(app.status),
        String(app.rating),
        fmtDT(app.createdAt),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return { csv: `\uFEFF${lines.join("\r\n")}`, rows: rows.length };
}

/* ----------------------------- Kirim & unduh file ----------------------------- */

/** tgApi versi multipart (FormData) untuk sendDocument/sendPhoto — butuh timeout lebih panjang. */
async function tgApiForm<T = unknown>(
  token: string,
  method: string,
  form: FormData,
): Promise<{ ok: boolean; result?: T; description?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TG_FILE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!res.ok || !json?.ok) return { ok: false, description: json?.description ?? `HTTP ${res.status}` };
    return { ok: true, result: json.result };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Kirim dokumen (byte buffer) ke chat dengan caption opsional. */
async function tgSendDocument(
  token: string,
  chatId: number | string,
  buffer: Buffer,
  filename: string,
  caption?: string,
): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append("document", new Blob([new Uint8Array(buffer)]), filename.slice(0, 120));
  const res = await tgApiForm(token, "sendDocument", form);
  return res.ok;
}

/** Kirim foto (byte buffer) ke chat dengan caption opsional. */
async function tgSendPhoto(
  token: string,
  chatId: number | string,
  buffer: Buffer,
  filename: string,
  caption?: string,
): Promise<boolean> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) form.append("caption", caption.slice(0, 1000));
  form.append("photo", new Blob([new Uint8Array(buffer)], { type: "image/png" }), filename.slice(0, 120));
  const res = await tgApiForm(token, "sendPhoto", form);
  return res.ok;
}

/** Ambil info file Telegram (file_path untuk unduhan). */
async function tgGetFile(token: string, fileId: string): Promise<{ ok: boolean; filePath?: string; description?: string }> {
  const res = await tgApi<{ file_path?: string }>(token, "getFile", { file_id: fileId });
  if (!res.ok || !res.result?.file_path) {
    return { ok: false, description: res.description ?? "file_path kosong" };
  }
  return { ok: true, filePath: res.result.file_path };
}

/** Unduh isi file dari server Telegram (maks 20 MB sesuai batas Bot API). */
async function tgDownloadFile(token: string, filePath: string): Promise<{ ok: boolean; buffer?: Buffer; description?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TG_FILE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: controller.signal });
    if (!res.ok) return { ok: false, description: `HTTP ${res.status}` };
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > TG_FILE_MAX_BYTES) {
      return { ok: false, description: "file terlalu besar (maks 20 MB)" };
    }
    return { ok: true, buffer: Buffer.from(arrayBuffer) };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

type SavedAsset = { id: string; filename: string; mimeType: string; size: number };

/** Simpan byte yang dikirim admin via bot sebagai FileAsset (konvensi folder uploads/). */
async function saveBotFileAsset(buffer: Buffer, filename: string, mimeType: string): Promise<SavedAsset | null> {
  try {
    const uploadsDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const ext = path.extname(filename).slice(0, 10).replace(/[^A-Za-z0-9.]/g, "") || "";
    const storedName = `${Date.now()}-${randomBytes(6).toString("hex")}${ext}`;
    await writeFile(path.join(uploadsDir, storedName), buffer);
    const asset = await db.fileAsset.create({
      data: { filename: filename.slice(0, 200), mimeType: mimeType.slice(0, 100), size: buffer.byteLength, path: `uploads/${storedName}` },
    });
    return { id: asset.id, filename: asset.filename, mimeType: asset.mimeType, size: asset.size };
  } catch {
    return null;
  }
}

/** Baca FileAsset dari disk untuk dikirim ke Telegram. */
async function readAssetBuffer(fileId: string): Promise<{ ok: boolean; buffer?: Buffer; filename?: string; mimeType?: string }> {
  const asset = await db.fileAsset.findUnique({ where: { id: fileId } });
  if (!asset) return { ok: false };
  try {
    const buffer = await readFile(path.join(process.cwd(), asset.path));
    return { ok: true, buffer, filename: asset.filename || "file", mimeType: asset.mimeType };
  } catch {
    return { ok: false };
  }
}

/** Sinkronkan daftar perintah agar tampil di menu UI Telegram (fire-and-forget). */
let lastMenuSync = 0;
export async function ensureBotMenu(token: string): Promise<void> {
  if (Date.now() - lastMenuSync < 10 * 60_000) return;
  lastMenuSync = Date.now();
  await tgApi(token, "setMyCommands", {
    commands: [
      { command: "ringkasan", description: "Ringkasan pipeline hari ini" },
      { command: "posisi", description: "Daftar posisi + sisa kuota" },
      { command: "kandidat", description: "Cari kandidat (kode/nama)" },
      { command: "jadwal", description: "Wawancara 7 hari ke depan" },
      { command: "laporan", description: "Funnel + rekap bulanan" },
      { command: "export", description: "Kirim rekap lamaran (CSV)" },
      { command: "catatan", description: "Catatan kandidat: /catatan KODE teks" },
      { command: "diam", description: "Tahan notifikasi: /diam 2jam" },
      { command: "bangun", description: "Hentikan mode diam" },
      { command: "bantuan", description: "Daftar perintah" },
    ],
  }).catch(() => undefined);
}

function fmtT(value: Date): string {
  return value.toLocaleTimeString("id-ID", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
}

function bangkokTodayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function bangkokHour(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "numeric", hour12: false }).format(now),
  );
}

function chatLabel(chat: TgChat, from?: TgFrom): string {
  if (chat.type === "private") {
    const name = from?.first_name ?? from?.username ?? "Admin Telegram";
    return from?.username ? `@${from.username}` : name;
  }
  return chat.title ?? `Grup ${chat.id}`;
}

/* ------------------------------- Rate limiter ------------------------------- */

const rateMap = new Map<string, number[]>();

function isRateLimited(chatKey: string): boolean {
  const now = Date.now();
  const hits = (rateMap.get(chatKey) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX_PER_WINDOW) {
    rateMap.set(chatKey, hits);
    return true;
  }
  hits.push(now);
  rateMap.set(chatKey, hits);
  if (rateMap.size > 500) {
    for (const [key, stamps] of rateMap) {
      if (stamps.every((ts) => now - ts >= RATE_WINDOW_MS)) rateMap.delete(key);
    }
  }
  return false;
}

/* ------------------------------ Akses Setting ------------------------------ */

async function readSiteObj(): Promise<Record<string, unknown>> {
  const setting = await db.setting.findUnique({ where: { key: "site" } });
  if (!setting) return {};
  try {
    const parsed: unknown = JSON.parse(setting.value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // JSON rusak — perlakukan sebagai objek baru
  }
  return {};
}

async function writeSiteObj(obj: Record<string, unknown>): Promise<void> {
  await db.setting.upsert({
    where: { key: "site" },
    update: { value: JSON.stringify(obj) },
    create: { key: "site", value: JSON.stringify(obj) },
  });
}

type PairPayload = { code: string; expiresAt: string };

async function readPairPayload(): Promise<PairPayload | null> {
  const setting = await db.setting.findUnique({ where: { key: PAIR_SETTING_KEY } });
  if (!setting) return null;
  try {
    const parsed = JSON.parse(setting.value) as Partial<PairPayload> | null;
    if (parsed && typeof parsed.code === "string" && typeof parsed.expiresAt === "string") {
      return { code: parsed.code, expiresAt: parsed.expiresAt };
    }
  } catch {
    // rusak — anggap tidak ada
  }
  return null;
}

/* --------------------------------- Entry point --------------------------------- */

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<{ replies: string[] }> {
  const replies: string[] = [];
  try {
    const settings = await getAutomationSettings();
    const token = settings.telegramBotToken;
    if (!token) return { replies };

    if (update.callback_query) {
      await handleCallback(update.callback_query, token, settings.telegramWriteEnabled, replies);
      return { replies };
    }

    const message = update.message;
    if (!message || !message.chat) return { replies };
    const hasText = typeof message.text === "string" && message.text.trim().length > 0;
    const hasMedia = Boolean(message.photo || message.document || message.voice || message.audio);
    if (!hasText && !hasMedia) return { replies };

    const chatId = message.chat.id;
    const chatKey = String(chatId);
    if (isRateLimited(chatKey)) {
      const sent = await tgSendMessage(token, chatId, "Terlalu banyak perintah. Tunggu sebentar ya.");
      if (sent) replies.push("rate-limit");
      return { replies };
    }

    const allowed = settings.telegramAllowedChats.includes(chatKey);
    if (!allowed) {
      // Fitur publik tanpa pairing: kode pelacakan polos -> kartu status + langganan
      // tahap (idea 17). Chat bebas mengecek lamarannya sendiri dengan kodenya.
      const publicCode = (message.text ?? "").trim().toUpperCase().match(/^LM-[A-Z0-9]{6}$/);
      if (publicCode) {
        const t = await handleBareTrackingCode(token, chatId, publicCode[0]);
        replies.push(t);
        return { replies };
      }
      await handleUnregisteredChat(message, token, replies);
      return { replies };
    }

    void ensureBotMenu(token);

    // Media dari admin (foto/dokumen/voice) — lampiran & transkripsi ke kandidat.
    if (hasMedia) {
      await handleMediaMessage(message, token, chatId, settings.telegramWriteEnabled, replies);
      return { replies };
    }

    const text = (message.text ?? "").trim();
    const parts = text.split(/\s+/);
    const cmd = (parts[0] ?? "").split("@")[0].toLowerCase();
    const args = parts.slice(1).join(" ").trim();

    // Alias tombol keyboard (teks polos tanpa "/") — "Ringkasan", "Jadwal", dst.
    // dikirim Telegram sebagai pesan biasa. Hanya berlaku bila pesan TEPAT satu
    // kata; kalimat panjang tetap masuk ke asisten jawaban bebas.
    const COMMAND_ALIASES: Record<string, string> = {
      ringkasan: "/ringkasan",
      posisi: "/posisi",
      lowongan: "/posisi",
      jadwal: "/jadwal",
      wawancara: "/jadwal",
      kandidat: "/kandidat",
      pelamar: "/kandidat",
      laporan: "/laporan",
      bantuan: "/bantuan",
      menu: "/menu",
      help: "/help",
    };
    const effectiveCmd = parts.length === 1 ? (COMMAND_ALIASES[cmd] ?? cmd) : cmd;

    switch (effectiveCmd) {
      case "/start":
      case "/menu":
      case "/bantuan":
      case "/help":
        replies.push(await sendHelp(token, chatId, settings.telegramWriteEnabled, args));
        break;
      case "/mulai":
        // Chat terdaftar yang mengirim kode lagi — cukup tampilkan bantuan.
        replies.push(await sendHelp(token, chatId, settings.telegramWriteEnabled, ""));
        break;
      case "/ringkasan": {
        const { text: t, buttons } = await buildRingkasan();
        await tgSendMessage(token, chatId, t, { buttons });
        replies.push(t);
        break;
      }
      case "/posisi": {
        const { text: t, buttons } = await buildPosisiPage(0);
        await tgSendMessage(token, chatId, t, { buttons });
        replies.push(t);
        break;
      }
      case "/kandidat": {
        const { text: t, buttons } = await buildKandidatSearch(args);
        await tgSendMessage(token, chatId, t, { buttons });
        replies.push(t);
        break;
      }
      case "/jadwal": {
        const { text: t, buttons } = await buildJadwal();
        await tgSendMessage(token, chatId, t, { buttons });
        replies.push(t);
        break;
      }
      case "/laporan": {
        const { text: t, buttons } = await buildLaporan();
        await tgSendMessage(token, chatId, t, { buttons });
        replies.push(t);
        break;
      }
      case "/catatan": {
        const t = await handleCatatanCommand(token, chatId, args, chatLabel(message.chat, message.from), settings.telegramWriteEnabled);
        replies.push(t);
        break;
      }
      case "/export": {
        const t = await handleExportCommand(token, chatId);
        replies.push(t);
        break;
      }
      case "/skor": {
        const t = await handleSkorCommand(token, chatId, args, chatLabel(message.chat, message.from));
        replies.push(t);
        break;
      }
      case "/offer": {
        const t = await handleOfferCommand(token, chatId, args);
        replies.push(t);
        break;
      }
      case "/draft": {
        const t = await handleDraftCommand(token, chatId, args);
        replies.push(t);
        break;
      }
      case "/bandingkan": {
        const t = await handleBandingkanCommand(token, chatId, args);
        replies.push(t);
        break;
      }
      case "/setelan": {
        const t = await renderSetelanCard(token, chatId);
        replies.push(t);
        break;
      }
      case "/whoami": {
        const t = await handleWhoamiCommand(token, chatId);
        replies.push(t);
        break;
      }
      case "/health": {
        const t = await handleHealthCommand(token, chatId);
        replies.push(t);
        break;
      }
      case "/lowongan": {
        const t = await handleLowonganCommand(token, chatId);
        replies.push(t);
        break;
      }
      case "/diam": {
        const t = await handleDiamCommand(token, chatId, args);
        replies.push(t);
        break;
      }
      case "/bangun": {
        const t = await handleBangunCommand(token, chatId);
        replies.push(t);
        break;
      }
      default: {
        if (cmd.startsWith("/")) {
          const hint = `Perintah tidak dikenal: ${cmd}\nKirim /bantuan untuk daftar perintah.`;
          await tgSendMessage(token, chatId, hint);
          replies.push(hint);
        } else {
          // Wizard offer aktif untuk chat ini -> teks jadi jawaban wizard.
          if (await handleWizardText(token, chatId, text, replies)) {
            return { replies };
          }
          // Reply ke kartu kandidat -> teks menjadi catatan internal kandidat.
          const repliedText = message.reply_to_message?.text ?? message.reply_to_message?.caption ?? "";
          const repliedCode = repliedText.match(/\bLM-[A-Z0-9]{6}\b/i)?.[0];
          if (repliedCode && text && !text.startsWith("/")) {
            const t = await handleReplyNote(token, chatId, repliedCode.toUpperCase(), text, chatLabel(message.chat, message.from), writeEnabled);
            replies.push(t);
            return;
          }
          // Kode pelacakan polos (LM-XXXXXX) -> status kandidat + langganan (publik).
          const bareCode = text.trim().toUpperCase().match(/^LM-[A-Z0-9]{6}$/);
          if (bareCode) {
            const t = await handleBareTrackingCode(token, chatId, bareCode[0]);
            replies.push(t);
            return;
          }
          // Pesan bebas -> asisten data rekrutmen (read-only, jawaban dari DB).
          const t = await answerFreeQuestion(token, chatId, text);
          replies.push(t);
        }
      }
    }
  } catch (error) {
    console.error("[telegram-bot] handleTelegramUpdate gagal:", error instanceof Error ? error.message : error);
  }
  return { replies };
}

/* ----------------------------- Chat belum terdaftar ----------------------------- */

/** Teks panduan pairing — dipakai pesan biasa & callback tombol (agar tidak "mati" diam-diam). */
function pairingInstructionsText(chatId: number | string): string {
  return [
    "Chat ini belum terhubung ke Lumina Studio.",
    "",
    "Cara menghubungkan:",
    "1. Buka panel admin, tab Pengaturan, kartu Bot Telegram.",
    "2. Klik Buat Kode Pemasangan.",
    "3. Kirim perintah berikut ke chat ini:",
    "/mulai KODE",
    "",
    `Chat ID kamu: ${chatId}`,
  ].join("\n");
}

async function handleUnregisteredChat(message: TgMessage, token: string, replies: string[]): Promise<void> {
  const chatId = message.chat.id;
  const text = (message.text ?? "").trim();
  const pairMatch = text.match(/^\/(start|mulai)(?:@\S+)?\s+(\S+)/i);

  if (pairMatch) {
    const code = pairMatch[2].trim();
    const result = await attemptPair(code, message.chat, message.from);
    await tgSendMessage(token, chatId, result.message);
    replies.push(result.message);
    return;
  }

  const reply = pairingInstructionsText(chatId);
  await tgSendMessage(token, chatId, reply);
  replies.push(reply);
}

async function attemptPair(code: string, chat: TgChat, from?: TgFrom): Promise<{ ok: boolean; message: string }> {
  const payload = await readPairPayload();
  if (!payload) return { ok: false, message: "Tidak ada kode pemasangan aktif. Buat kode baru dari panel admin." };
  if (Date.now() > new Date(payload.expiresAt).getTime()) return { ok: false, message: "Kode pemasangan sudah kedaluwarsa. Buat kode baru dari panel admin." };
  if (payload.code !== code.trim()) return { ok: false, message: "Kode pemasangan salah. Periksa lagi kode dari panel admin." };

  const site = await readSiteObj();
  const raw = Array.isArray(site.telegramAllowedChats) ? site.telegramAllowedChats : [];
  const list: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim() && !list.includes(item.trim())) list.push(item.trim());
  }
  const chatKey = String(chat.id);
  if (!list.includes(chatKey)) list.push(chatKey);
  if (list.length > 20) return { ok: false, message: "Daftar chat sudah penuh (maks 20). Hapus salah satu dari panel admin." };
  site.telegramAllowedChats = list;
  await writeSiteObj(site);
  await db.setting.deleteMany({ where: { key: PAIR_SETTING_KEY } });

  try {
    await db.notificationItem.create({
      data: {
        title: "Bot Telegram terhubung",
        body: `Chat ${chatLabel(chat, from)} (${chatKey}) berhasil dipasangkan ke bot.`,
        category: "SYSTEM",
      },
    });
  } catch {
    // diam — tidak boleh gagalkan pairing
  }

  return {
    ok: true,
    message: `Bot berhasil terhubung ke chat ini (${chatKey}).\n\nKirim /bantuan untuk melihat semua perintah.`,
  };
}

/* ------------------------- Perintah & media baru ------------------------- */

/** Cari lamaran berdasarkan kode pelacakan (exact, tanpa peduli huruf besar/kecil). */
async function findAppByTrackingCode(code: string) {
  const clean = code.trim();
  if (!clean) return null;
  const candidates = await db.application.findMany({
    where: { deletedAt: null, trackingCode: { contains: clean } },
    include: { position: { select: { title: true } } },
    take: 5,
  });
  return candidates.find((app) => (app.trackingCode ?? "").toLowerCase() === clean.toLowerCase()) ?? null;
}

const TRACKING_CODE_RE = /\bLM-[A-Za-z0-9]{3,12}\b/;

/** Tambah catatan internal ke lamaran (dipakai /catatan dan transkrip voice). */
async function appendInternalNote(
  applicationId: string,
  previousNotes: string | null,
  note: string,
  actor: string,
): Promise<void> {
  const stamp = fmtDT(new Date());
  const entry = `[${stamp}] ${note}`;
  const merged = previousNotes ? `${previousNotes}\n${entry}` : entry;
  await db.application.update({
    where: { id: applicationId },
    data: { adminNotes: merged.slice(-8000) },
  });
  await db.activityLog.create({
    data: {
      applicationId,
      actor,
      action: "NOTE",
      detail: `Catatan internal via Telegram: ${note.slice(0, 120)}`,
    },
  });
}

/** /catatan KODE teks — catatan internal ke kandidat langsung dari Telegram. */
async function handleCatatanCommand(
  token: string,
  chatId: number,
  args: string,
  actorLabel: string,
  writeEnabled: boolean,
): Promise<string> {
  if (!writeEnabled) {
    const t = "Aksi tulis via bot sedang nonaktif di panel admin.";
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const match = args.match(/^(\S+)\s+([\s\S]+)$/);
  if (!match) {
    const t = "Format: /catatan KODE teks catatan\nContoh: /catatan LM-ABC123 sudah dihubungi via telepon";
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const app = await findAppByTrackingCode(match[1]);
  if (!app) {
    const t = `Kandidat dengan kode ${match[1].slice(0, 20)} tidak ditemukan.`;
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const note = match[2].trim().slice(0, 1500);
  const actor = `Telegram (${actorLabel})`;
  await appendInternalNote(app.id, app.adminNotes, note, actor);
  const t = `Catatan tersimpan untuk ${app.name} (${app.trackingCode ?? "-"}):\n${note}`;
  await tgSendMessage(token, chatId, t);
  return t;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** /export — kirim rekap lamaran (CSV, kompatibel Excel) sebagai dokumen. */
async function handleExportCommand(token: string, chatId: number): Promise<string> {
  const { csv, rows } = await buildApplicationCsv();
  const buffer = Buffer.from(csv, "utf8");
  const sent = await tgSendDocument(token, chatId, buffer, "lamaran-lumina.csv", `Rekap lamaran (${rows} baris)`);
  const t = sent
    ? `Rekap lamaran terkirim (${rows} baris).`
    : "Gagal mengirim file rekap. Coba lagi sebentar.";
  if (!sent) await tgSendMessage(token, chatId, t);
  return t;
}

/** Parse durasi mode diam: "30", "30m", "2jam", "1.5h", "2d" — return menit atau null. */
function parseMuteDuration(raw: string): number | null {
  const clean = raw.trim().toLowerCase();
  if (!clean) return 60; // default 1 jam
  const match = clean.match(/^(\d+(?:[.,]\d+)?)\s*(m|menit|h|j|jam|d|hari)?$/);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2] ?? "m";
  const minutes = unit === "m" || unit === "menit" ? value : unit === "h" || unit === "j" || unit === "jam" ? value * 60 : value * 1440;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.min(Math.round(minutes), 7 * 24 * 60);
}

function fmtMuteUntil(iso: string): string {
  return fmtDT(new Date(iso));
}

/** /diam [durasi] — tahan notifikasi proaktif untuk chat ini. */
async function handleDiamCommand(token: string, chatId: number, args: string): Promise<string> {
  const minutes = parseMuteDuration(args);
  if (minutes == null) {
    const t = "Format: /diam 30m, /diam 2jam, atau /diam 1d (maks 7 hari). Tanpa angka = 1 jam.";
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  const site = await readSiteObj();
  const mutes = (site.telegramMutes && typeof site.telegramMutes === "object" && !Array.isArray(site.telegramMutes)
    ? { ...(site.telegramMutes as Record<string, unknown>) }
    : {}) as Record<string, string>;
  mutes[String(chatId)] = until;
  site.telegramMutes = mutes;
  await writeSiteObj(site);
  const t = `Mode diam aktif sampai ${fmtMuteUntil(until)}.\nNotifikasi proaktif ditahan; perintah tetap dijawab.`;
  await tgSendMessage(token, chatId, t, {
    buttons: [[{ text: "Bangunkan Sekarang", callback_data: "cb:wake" }]],
  });
  return t;
}

/** /bangun — hentikan mode diam untuk chat ini. */
async function handleBangunCommand(token: string, chatId: number): Promise<string> {
  const site = await readSiteObj();
  const mutes = (site.telegramMutes && typeof site.telegramMutes === "object" && !Array.isArray(site.telegramMutes)
    ? { ...(site.telegramMutes as Record<string, unknown>) }
    : {}) as Record<string, string>;
  delete mutes[String(chatId)];
  site.telegramMutes = mutes;
  await writeSiteObj(site);
  const t = "Mode diam dihentikan. Notifikasi proaktif kembali normal.";
  await tgSendMessage(token, chatId, t);
  return t;
}

/** Callback cb:wake dari tombol "Bangunkan Sekarang". */
async function handleWakeCallback(token: string, chatId: number): Promise<string> {
  return handleBangunCommand(token, chatId);
}

/**
 * Media dari admin: dokumen/foto (lampiran kandidat) & voice/audio (transkrip -> catatan).
 * Caption wajib memuat kode kandidat, mis. "LM-ABC123 portofolio terbaru".
 */
async function handleMediaMessage(
  message: TgMessage,
  token: string,
  chatId: number,
  writeEnabled: boolean,
  replies: string[],
): Promise<void> {
  const caption = (message.caption ?? "").trim();
  const codeMatch = caption.match(TRACKING_CODE_RE);

  // Voice / audio -> transkripsi ASR -> catatan kandidat.
  const voice = message.voice ?? message.audio;
  if (voice) {
    const t = await handleVoiceMessage(token, chatId, voice, codeMatch?.[0] ?? null, writeEnabled, message.chat, message.from);
    replies.push(t);
    return;
  }

  // Dokumen / foto -> simpan sebagai lampiran kandidat.
  const photo = message.photo ? message.photo.reduce((largest, item) => (item.file_size ?? 0) > (largest.file_size ?? 0) ? item : largest, message.photo[0]) : null;
  const fileId = message.document?.file_id ?? photo?.file_id ?? null;
  const fallbackName = message.document?.file_name ?? (photo ? `foto-${Date.now()}.jpg` : "file");
  const mimeType = message.document?.mime_type ?? (photo ? "image/jpeg" : "application/octet-stream");
  const fileSize = message.document?.file_size ?? photo?.file_size ?? 0;

  if (!fileId) {
    const t = "Media tidak dikenali.";
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  if (!writeEnabled) {
    const t = "Aksi tulis via bot sedang nonaktif di panel admin — lampiran tidak disimpan.";
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  if (!codeMatch) {
    const t = [
      "Sertakan kode kandidat di caption, contoh:",
      "LM-ABC123 portofolio terbaru",
      "",
      "Cari kode lewat /kandidat Nama.",
    ].join("\n");
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  if (fileSize > TG_FILE_MAX_BYTES) {
    const t = "File terlalu besar (maks 20 MB).";
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  const app = await findAppByTrackingCode(codeMatch[0]);
  if (!app) {
    const t = `Kandidat dengan kode ${codeMatch[0]} tidak ditemukan.`;
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  const file = await tgGetFile(token, fileId);
  if (!file.ok || !file.filePath) {
    const t = `Gagal mengambil file dari Telegram (${file.description ?? "unknown"}).`;
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  const downloaded = await tgDownloadFile(token, file.filePath);
  if (!downloaded.ok || !downloaded.buffer) {
    const t = `Gagal mengunduh file (${downloaded.description ?? "unknown"}).`;
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  const asset = await saveBotFileAsset(downloaded.buffer, fallbackName, mimeType);
  if (!asset) {
    const t = "Gagal menyimpan file ke penyimpanan aplikasi.";
    await tgSendMessage(token, chatId, t);
    replies.push(t);
    return;
  }
  const botFiles = parseBotFiles(app.botFiles);
  botFiles.push({ fileId: asset.id, filename: asset.filename, mimeType: asset.mimeType, size: asset.size, sentAt: new Date().toISOString() });
  await db.application.update({ where: { id: app.id }, data: { botFiles: JSON.stringify(botFiles.slice(-20)) } });
  await db.activityLog.create({
    data: {
      applicationId: app.id,
      actor: `Telegram (${chatLabel(message.chat, message.from)})`,
      action: "FILE",
      detail: `Lampiran via Telegram: ${asset.filename} (${Math.round(asset.size / 1024)} KB)`,
    },
  });
  const t = `Lampiran tersimpan untuk ${app.name} (${app.trackingCode ?? "-"}):\n${asset.filename}`;
  await tgSendMessage(token, chatId, t);
  replies.push(t);
}

function parseBotFiles(raw: string | null): { fileId: string; filename: string; mimeType: string; size: number; sentAt: string }[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is { fileId: string; filename: string; mimeType: string; size: number; sentAt: string } =>
        Boolean(item) && typeof (item as { fileId?: unknown }).fileId === "string",
    );
  } catch {
    return [];
  }
}

/** Voice/audio note -> ASR -> catatan internal kandidat. */
async function handleVoiceMessage(
  token: string,
  chatId: number,
  voice: TgVoice,
  code: string | null,
  writeEnabled: boolean,
  chat: TgChat,
  from?: TgFrom,
): Promise<string> {
  if (!writeEnabled) {
    const t = "Aksi tulis via bot sedang nonaktif di panel admin — voice note tidak diproses.";
    await tgSendMessage(token, chatId, t);
    return t;
  }
  if (voice.duration > VOICE_MAX_SECONDS) {
    const t = `Voice note terlalu panjang (${voice.duration} detik). Maksimal ${VOICE_MAX_SECONDS} detik.`;
    await tgSendMessage(token, chatId, t);
    return t;
  }
  if (code) {
    const app = await findAppByTrackingCode(code);
    if (!app) {
      const t = `Kandidat dengan kode ${code} tidak ditemukan.`;
      await tgSendMessage(token, chatId, t);
      return t;
    }
  }
  const file = await tgGetFile(token, voice.file_id);
  if (!file.ok || !file.filePath) {
    const t = `Gagal mengambil voice note dari Telegram (${file.description ?? "unknown"}).`;
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const downloaded = await tgDownloadFile(token, file.filePath);
  if (!downloaded.ok || !downloaded.buffer) {
    const t = `Gagal mengunduh voice note (${downloaded.description ?? "unknown"}).`;
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const transcript = await transcribeAudioBuffer(downloaded.buffer);
  if (!transcript) {
    const t = "Gagal mentranskripsi voice note. Coba kirim ulang atau tulis manual via /catatan."
    await tgSendMessage(token, chatId, t);
    return t;
  }
  // Voice dengan pola perintah ("ringkasan", "posisi", "jadwal", "laporan",
  // "catatan KODE ...", "skor KODE 1-5") dieksekusi sebagai perintah — bukan catatan.
  const commandFromVoice = parseVoiceCommand(transcript);
  if (commandFromVoice) {
    const actorLabel = chatLabel(chat, from);
    const cmd = commandFromVoice.command.split(" ")[0];
    let replyText: string;
    switch (cmd) {
      case "ringkasan": {
        const reply = await buildRingkasan();
        await tgSendMessage(token, chatId, reply.text, { buttons: reply.buttons });
        replyText = reply.text;
        break;
      }
      case "posisi": {
        const reply = await buildPosisiPage(0);
        await tgSendMessage(token, chatId, reply.text, { buttons: reply.buttons });
        replyText = reply.text;
        break;
      }
      case "jadwal": {
        const reply = await buildJadwal();
        await tgSendMessage(token, chatId, reply.text, { buttons: reply.buttons });
        replyText = reply.text;
        break;
      }
      case "laporan": {
        const reply = await buildLaporan();
        await tgSendMessage(token, chatId, reply.text, { buttons: reply.buttons });
        replyText = reply.text;
        break;
      }
      case "catatan": {
        replyText = await handleCatatanCommand(token, chatId, commandFromVoice.command.slice("catatan".length), actorLabel, writeEnabled);
        break;
      }
      case "skor": {
        replyText = await handleSkorCommand(token, chatId, commandFromVoice.command.slice("skor".length), actorLabel);
        break;
      }
      default: {
        replyText = "Perintah voice tidak dikenal. Coba: ringkasan, posisi, jadwal, laporan, catatan, atau skor.";
        await tgSendMessage(token, chatId, replyText);
      }
    }
    return replyText ?? `Perintah voice "${commandFromVoice.command}" diproses.`;
  }
  if (!code) {
    const t = [
      "Transkrip tidak berisi perintah dan caption tanpa kode kandidat.",
      "Sertakan kode kandidat di caption (contoh: LM-ABC123) agar transkrip tersimpan sebagai catatan.",
      "",
      `Isi voice note: "${transcript.slice(0, 300)}"`,
    ].join("\n");
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const app = await findAppByTrackingCode(code);
  if (!app) {
    const t = `Kandidat dengan kode ${code} tidak ditemukan.`;
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const actor = `Telegram (${chatLabel(chat, from)})`;
  await appendInternalNote(app.id, app.adminNotes, `Catatan suara: ${transcript}`, actor);
  const t = `Transkrip tersimpan untuk ${app.name} (${app.trackingCode ?? "-"}):\n\n"${transcript.slice(0, 800)}"`;
  await tgSendMessage(token, chatId, t);
  return t;
}

/**
 * Deteksi perintah dari hasil transkrip voice (idea 16): kata pertama harus
 * berupa kata kunci perintah. Return {command: "catatan LM-... teks"} atau null.
 */
function parseVoiceCommand(transcript: string): { command: string } | null {
  const clean = transcript.trim().replace(/^kirim |^jalankan |^buka /i, "");
  const keywords = ["ringkasan", "posisi", "jadwal", "laporan", "catatan", "skor"];
  const first = clean.split(/\s+/)[0]?.toLowerCase().replace(/[.,!?]+$/, "") ?? "";
  if (!keywords.includes(first)) return null;
  // Perintah tanpa argumen (ringkasan/posisi/jadwal/laporan) — langsung valid.
  if (["ringkasan", "posisi", "jadwal", "laporan"].includes(first)) return { command: first };
  // catatan/skor wajib menyertakan kode kandidat.
  if (/\bLM-[A-Z0-9]{6}\b/i.test(clean)) return { command: clean };
  return null;
}

/**
 * Konversi audio ke WAV 16 kHz mono (ffmpeg) lalu transkripsi via ASR SDK.
 * Return teks atau null bila gagal.
 */
async function transcribeAudioBuffer(input: Buffer): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lumina-asr-"));
  try {
    const inputPath = path.join(tmpDir, "input.ogg");
    const outputPath = path.join(tmpDir, "output.wav");
    await fs.writeFile(inputPath, input);
    await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-ac", "1", "-ar", "16000", outputPath], { timeout: 30_000 });
    const wav = await fs.readFile(outputPath);
    const zai = await getZai();
    const result = (await withTimeout(
      zai.audio.asr.create({ file_base64: wav.toString("base64") }),
      "ASR",
      60_000,
    )) as { text?: string } | null;
    const text = (result?.text ?? "").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Asisten data rekrutmen: pesan bebas dijawab LLM dengan konteks angka nyata
 * dari database (read-only — tidak ada aksi tulis).
 */
async function answerFreeQuestion(token: string, chatId: number, question: string): Promise<string> {
  const thinking = await tgSendMessageTracked(token, chatId, "Sebentar, saya cek data...");
  const context = await buildDataContext();
  let answer: string;
  try {
    const zai = await getZai();
    const completion = (await withTimeout(
      zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content:
              "Kamu asisten rekrutmen Lumina Studio di Telegram untuk admin. " +
              "Jawab HANYA berdasarkan data konteks berikut. Ikuti bahasa pengguna: jawab dalam bahasa Indonesia " +
              "bila pertanyaan berbahasa Indonesia, atau bahasa Inggris bila pertanyaannya berbahasa Inggris. " +
              "Singkat dan padat (maksimal 900 karakter), tanpa emoji, tanpa format markdown berat. " +
              "Bila data tidak menjawab pertanyaan, katakan dengan jujur dan sarankan perintah bot yang relevan " +
              "(/ringkasan, /posisi, /kandidat, /jadwal, /laporan). Kamu tidak bisa mengubah data.\n\n" +
              `Konteks data:\n${context}`,
          },
          { role: "user", content: question.slice(0, 500) },
        ],
        thinking: { type: "disabled" },
      }),
      "BotQna",
      60_000,
    )) as { choices?: { message?: { content?: string } }[] } | null;
    answer = (completion?.choices?.[0]?.message?.content ?? "").trim();
  } catch {
    answer = "";
  }
  if (!answer) {
    answer = "Maaf, saya tidak bisa menjawab sekarang. Coba lagi sebentar atau pakai /ringkasan.";
  }
  if (typeof thinking.message_id === "number") {
    await tgEditMessage(token, chatId, thinking.message_id, answer);
  } else {
    await tgSendMessage(token, chatId, answer);
  }
  return answer;
}

/** Konteks ringkas untuk asisten LLM — angka nyata dari DB, read-only. */
async function buildDataContext(): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [statusGroups, newToday, pendingOffers, interviewsSoon, positions, recent] = await Promise.all([
    db.application.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    db.application.count({ where: { deletedAt: null, createdAt: { gte: todayStart } } }),
    db.application.count({ where: { deletedAt: null, offerStatus: "PENDING" } }),
    db.interview.count({ where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: now, lte: weekLater } } }),
    db.position.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, title: true, maxApplicants: true },
      take: 12,
    }),
    db.application.findMany({
      where: { deletedAt: null },
      include: { position: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);
  const grouped = await db.application.groupBy({
    by: ["positionId"],
    where: { deletedAt: null, positionId: { not: null } },
    _count: { _all: true },
  });
  const countMap = new Map<string, number>();
  for (const row of grouped) if (row.positionId) countMap.set(row.positionId, row._count._all);

  const lines: string[] = [];
  lines.push(`Tanggal: ${fmtDT(now)} (Asia/Bangkok)`);
  lines.push("Pipeline total:");
  for (const g of statusGroups) lines.push(`- ${stageLabel(g.status)}: ${g._count._all}`);
  lines.push(`Lamaran masuk hari ini: ${newToday}`);
  lines.push(`Offer menunggu jawaban: ${pendingOffers}`);
  lines.push(`Wawancara 7 hari ke depan: ${interviewsSoon}`);
  lines.push("Posisi aktif:");
  for (const p of positions) {
    const count = countMap.get(p.id) ?? 0;
    lines.push(`- ${p.title}: ${count} lamaran${p.maxApplicants != null ? ` (kuota ${p.maxApplicants}, sisa ${Math.max(p.maxApplicants - count, 0)})` : ""}`);
  }
  lines.push("5 lamaran terbaru:");
  for (const app of recent) {
    lines.push(`- ${app.name} | ${app.position?.title ?? "-"} | ${stageLabel(app.status)} | ${app.trackingCode ?? "-"}`);
  }
  return lines.join("\n");
}

/* --------------------------------- Perintah baca --------------------------------- */

const HELP_HEADER = (writeEnabled: boolean) =>
  [
    "Lumina Studio Bot — asisten rekrutmen admin.",
    "",
    "Perintah baca:",
    "/ringkasan — ringkasan pipeline hari ini",
    "/posisi — daftar posisi + sisa kuota",
    "/kandidat — cari kandidat + filter cepat",
    "/jadwal — wawancara 7 hari ke depan",
    "/laporan — funnel + rekap bulanan",
    "/export — kirim rekap lamaran (CSV)",
    "",
    "Perintah tulis:",
    "/skor KODE 1-5 — set rating kandidat",
    "/offer KODE — kirim penawaran (wizard)",
    "/draft KODE — draft balasan AI untuk kandidat",
    "/bandingkan KODE1 KODE2 — bandingkan kandidat (AI)",
    "/catatan KODE teks — catat internal ke kandidat",
    "",
    "Perintah lain:",
    "/setelan — toggle alert & mode tenang",
    "/whoami — identitas & izin chat ini",
    "/health — kesehatan bot & jadwal terakhir",
    "/lowongan — langganan info lowongan baru",
    "/diam 2jam — tahan notifikasi (m/menit, j/jam, d/hari)",
    "/bangun — hentikan mode diam",
    "",
    "Lainnya:",
    "- Kirim dokumen/foto + caption berisi KODE kandidat = lampiran kandidat",
    "- Kirim voice note + caption KODE = catatan otomatis; voice dengan pola \"catatan KODE ...\" atau \"skor KODE 4\" dieksekusi sebagai perintah",
    "- Reply kartu kandidat dengan teks = catatan internal",
    "- Tanya apa saja dengan bahasa biasa (ID/EN), mis. \"berapa lamaran hari ini?\"",
    "",
    writeEnabled
      ? "Aksi tulis via bot: AKTIF (tombol aksi tampil pada kartu kandidat)."
      : "Aksi tulis via bot: NONAKTIF (hanya notifikasi & tautan).",
  ].join("\n");

async function sendHelp(token: string, chatId: number, writeEnabled: boolean, _args: string): Promise<string> {
  const text = HELP_HEADER(writeEnabled);
  await tgSendMessage(token, chatId, text, {
    buttons: [
      [
        { text: "Ringkasan", callback_data: "cb:ringkasan" },
        { text: "Posisi", callback_data: "cb:posisi" },
        { text: "Jadwal", callback_data: "cb:jadwal" },
      ],
      [
        { text: "Setelan", callback_data: "cb:setelan" },
        { text: "Buka Lumina Mini", webAppUrl: `${getSiteUrl()}/?mini=1` },
      ],
    ],
  });
  return text;
}

type BotReply = { text: string; buttons: TelegramButton[][] };

async function buildRingkasan(): Promise<BotReply> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [newToday, unreviewed, upcomingInterviews, pendingOffers, accepted] = await Promise.all([
    db.application.count({ where: { deletedAt: null, createdAt: { gte: todayStart } } }),
    db.application.count({ where: { deletedAt: null, status: "NEW" } }),
    db.interview.count({
      where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: now, lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) } },
    }),
    db.application.count({ where: { deletedAt: null, offerStatus: "PENDING" } }),
    db.application.count({ where: { deletedAt: null, status: "ACCEPTED" } }),
  ]);

  const text = [
    "Ringkasan Pipeline",
    "",
    `Lamaran masuk hari ini: ${newToday}`,
    `Belum ditinjau (Baru): ${unreviewed}`,
    `Wawancara 24 jam ke depan: ${upcomingInterviews}`,
    `Penawaran menunggu jawaban: ${pendingOffers}`,
    `Total diterima: ${accepted}`,
  ].join("\n");

  return {
    text,
    buttons: [
      [
        { text: "Posisi", callback_data: "cb:posisi" },
        { text: "Jadwal", callback_data: "cb:jadwal" },
        { text: "Laporan", callback_data: "cb:laporan" },
      ],
      [{ text: "Buka Dashboard", url: getSiteUrl() }],
    ],
  };
}

type PosisiRow = {
  id: string;
  title: string;
  department: string;
  isActive: boolean;
  maxApplicants: number | null;
  count: number;
};

async function loadPosisiRows(): Promise<PosisiRow[]> {
  const positions = await db.position.findMany({
    where: { deletedAt: null },
    orderBy: [{ isActive: "desc" }, { order: "asc" }, { createdAt: "desc" }],
    select: { id: true, title: true, department: true, isActive: true, maxApplicants: true },
  });
  const grouped = await db.application.groupBy({
    by: ["positionId"],
    where: { deletedAt: null, positionId: { not: null } },
    _count: { _all: true },
  });
  const countMap = new Map<string, number>();
  for (const row of grouped) {
    if (row.positionId) countMap.set(row.positionId, row._count._all);
  }
  return positions.map((p) => ({ ...p, count: countMap.get(p.id) ?? 0 }));
}

function posisiQuotaLabel(row: PosisiRow): string {
  if (row.maxApplicants == null) return `${row.count} lamaran (tanpa kuota)`;
  const remaining = row.maxApplicants - row.count;
  return `${row.count}/${row.maxApplicants} lamaran (sisa ${Math.max(remaining, 0)})`;
}

async function buildPosisiPage(page: number): Promise<BotReply> {
  const rows = await loadPosisiRows();
  if (rows.length === 0) {
    return { text: "Belum ada posisi terdaftar.", buttons: [] };
  }
  const total = rows.length;
  const pageCount = Math.ceil(total / POSISI_PAGE_SIZE);
  const safePage = Math.min(Math.max(page, 0), pageCount - 1);
  const slice = rows.slice(safePage * POSISI_PAGE_SIZE, (safePage + 1) * POSISI_PAGE_SIZE);

  const lines = [`Daftar Posisi (halaman ${safePage + 1}/${pageCount})`, ""];
  for (const row of slice) {
    lines.push(`${row.title} — ${row.isActive ? "aktif" : "nonaktif"}`);
    lines.push(`   ${row.department} | ${posisiQuotaLabel(row)}`);
  }

  const buttons: TelegramButton[][] = slice.map((row) => [
    { text: `Detail: ${row.title}`.slice(0, 60), callback_data: `pos:${row.id}:${safePage}` },
  ]);
  if (pageCount > 1) {
    const nav: TelegramButton[] = [];
    if (safePage > 0) nav.push({ text: "Sebelumnya", callback_data: `pos:page:${safePage - 1}` });
    if (safePage < pageCount - 1) nav.push({ text: "Berikutnya", callback_data: `pos:page:${safePage + 1}` });
    if (nav.length > 0) buttons.push(nav);
  }
  return { text: lines.join("\n"), buttons };
}

async function renderPosisiDetail(
  position: {
    id: string;
    title: string;
    slug: string | null;
    department: string;
    type: string;
    location: string;
    isActive: boolean;
    applyOpen: boolean;
    closesAt: Date | null;
    maxApplicants: number | null;
  } | null,
  page: number,
): Promise<BotReply> {
  if (!position) {
    return { text: "Posisi tidak ditemukan.", buttons: [[{ text: "Kembali", callback_data: "pos:page:0" }]] };
  }
  const [count, waitlist] = await Promise.all([
    db.application.count({ where: { deletedAt: null, positionId: position.id } }),
    db.positionWaitlist.count({ where: { positionId: position.id } }),
  ]);
  const remaining = position.maxApplicants == null ? null : Math.max(position.maxApplicants - count, 0);
  const lines = [
    position.title,
    "",
    `${position.department} | ${position.type} | ${position.location}`,
    `Status: ${position.isActive ? "aktif" : "nonaktif"} | Formulir: ${position.applyOpen ? "buka" : "tutup"}`,
    `Batas daftar: ${position.closesAt ? fmtDT(position.closesAt) : "-"}`,
    `Lamaran masuk: ${count}${position.maxApplicants != null ? ` dari kuota ${position.maxApplicants}` : ""}${remaining != null ? ` (sisa ${remaining})` : ""}`,
    `Daftar tunggu: ${waitlist} email`,
  ];
  const buttons: TelegramButton[][] = [
    [{ text: "Kembali ke daftar", callback_data: `pos:page:${page}` }],
  ];
  if (position.slug) {
    buttons.push([{ text: "Lihat halaman lowongan", url: `${getSiteUrl()}/?posisi=${encodeURIComponent(position.slug)}` }]);
  }
  return { text: lines.join("\n"), buttons };
}

// Callback filter cepat /kandidat (idea 12): kandidat:filter:{key}
async function buildKandidatFilteredList(filter: string): Promise<BotReply> {
  const filters: Record<string, { label: string; where: Record<string, unknown>; order: Record<string, unknown> }> = {
    new: {
      label: "Lamaran Baru",
      where: { deletedAt: null, status: "NEW" },
      order: { createdAt: "desc" },
    },
    unreviewed: {
      label: "Belum Ditinjau (Baru + Ditinjau)",
      where: { deletedAt: null, status: { in: ["NEW", "REVIEWED"] } },
      order: { createdAt: "asc" },
    },
    interview: {
      label: "Tahap Wawancara",
      where: { deletedAt: null, status: "INTERVIEW" },
      order: { stageUpdatedAt: "desc" },
    },
    topai: {
      label: "Skor AI Tertinggi",
      where: { deletedAt: null, aiScore: { not: null } },
      order: { aiScore: "desc" },
    },
    toprated: {
      label: "Rating Admin Tertinggi",
      where: { deletedAt: null, rating: { gte: 4 } },
      order: { rating: "desc" },
    },
  };
  const chosen = filters[filter];
  if (!chosen) {
    return { text: "Filter tidak dikenal. Kirim /kandidat untuk melihat pilihan.", buttons: [] };
  }
  const apps = await db.application.findMany({
    where: chosen.where,
    include: { position: { select: { title: true } } },
    orderBy: chosen.order,
    take: 6,
  });
  const lines = [`Kandidat — ${chosen.label}`, apps.length > 0 ? "" : "Tidak ada kandidat pada filter ini."];
  for (const app of apps) {
    lines.push(`${app.name} — ${app.position?.title ?? "tanpa posisi"} (${app.trackingCode ?? "-"})`);
  }
  const buttons: TelegramButton[][] = apps.map((app) => [
    { text: `${app.name} (${app.trackingCode ?? "-"})`.slice(0, 60), callback_data: `app:${app.id}:card` },
  ]);
  buttons.push([{ text: "Kembali ke Filter", callback_data: "kandidat:filter" }]);
  return { text: lines.join("\n"), buttons };
}

/** Menu filter cepat /kandidat tanpa argumen. */
async function buildKandidatFilterMenu(): Promise<BotReply> {
  return {
    text: [
      "Pencarian Kandidat",
      "",
      "Pilih filter cepat, atau kirim:",
      "/kandidat KODE atau /kandidat Nama",
      "Contoh: /kandidat LM-ABC123",
    ].join("\n"),
    buttons: [
      [
        { text: "Lamaran Baru", callback_data: "kandidat:filter:new" },
        { text: "Belum Ditinjau", callback_data: "kandidat:filter:unreviewed" },
      ],
      [
        { text: "Tahap Wawancara", callback_data: "kandidat:filter:interview" },
        { text: "Skor AI Tertinggi", callback_data: "kandidat:filter:topai" },
      ],
      [
        { text: "Rating Tertinggi", callback_data: "kandidat:filter:toprated" },
      ],
    ],
  };
}

async function buildKandidatSearch(query: string): Promise<BotReply> {
  const q = query.trim();
  if (!q) {
    return buildKandidatFilterMenu();
  }
  const filterMatch = q.match(/^filter:([a-z]+)$/);
  if (filterMatch) {
    return buildKandidatFilteredList(filterMatch[1]);
  }
  const apps = await db.application.findMany({
    where: {
      deletedAt: null,
      OR: [{ trackingCode: { contains: q } }, { name: { contains: q } }],
    },
    include: { position: { select: { title: true } } },
    orderBy: { createdAt: "desc" },
    take: 6,
  });
  if (apps.length === 0) {
    return { text: `Tidak ada kandidat yang cocok dengan "${q.slice(0, 60)}".`, buttons: [] };
  }
  if (apps.length === 1) {
    return renderKandidatCard(apps[0].id);
  }
  const lines = [`Ditemukan ${apps.length} kandidat. Pilih salah satu:`, ""];
  for (const app of apps) {
    lines.push(`${app.name} — ${app.position?.title ?? "tanpa posisi"} (${app.trackingCode ?? "-"})`);
  }
  return {
    text: lines.join("\n"),
    buttons: apps.map((app) => [
      { text: `${app.name} (${app.trackingCode ?? "-"})`.slice(0, 60), callback_data: `app:${app.id}:card` },
    ]),
  };
}

async function renderKandidatCard(applicationId: string): Promise<BotReply> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: { position: { select: { title: true, stages: true } } },
  });
  if (!app || app.deletedAt) {
    return { text: "Lamaran tidak ditemukan.", buttons: [] };
  }
  const [nextInterview, settings] = await Promise.all([
    db.interview.findFirst({
      where: { applicationId: app.id, status: { in: ["SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: "asc" },
      select: { round: true, scheduledAt: true },
    }),
    getAutomationSettings(),
  ]);

  const lines = [
    app.name,
    "",
    `Kode: ${app.trackingCode ?? "-"}`,
    `Posisi: ${app.position?.title ?? "-"}`,
    `Tahap: ${stageLabel(app.status)}`,
    `Masuk: ${fmtDT(app.createdAt)}`,
  ];
  if (app.rating > 0) lines.push(`Rating: ${app.rating}/5`);
  if (nextInterview) lines.push(`Wawancara berikutnya: ronde ${nextInterview.round}, ${fmtDT(nextInterview.scheduledAt)}`);
  if (app.snoozeUntil && app.snoozeUntil.getTime() > Date.now()) {
    lines.push(`Diingatkan lagi: ${fmtDT(app.snoozeUntil)}`);
  }
  if (app.cvFileId) lines.push("CV: tersedia (klik Unduh CV)");
  const botFiles = parseBotFiles(app.botFiles);
  if (botFiles.length > 0) lines.push(`Lampiran via bot: ${botFiles.length} file`);

  const writeEnabled = settings.telegramWriteEnabled;
  const buttons: TelegramButton[][] = [
    [{ text: "Tinjau di Dashboard", url: `${getSiteUrl()}/?kandidat=${encodeURIComponent(app.trackingCode ?? "")}#admin` }],
  ];
  if (app.cvFileId) {
    buttons.push([{ text: "Unduh CV", callback_data: `app:${app.id}:cv` }]);
  }
  if (writeEnabled) {
    const row: TelegramButton[] = [];
    if (app.status === "NEW") row.push({ text: "Tandai Ditinjau", callback_data: `app:${app.id}:review` });
    if (app.status === "NEW" || app.status === "REVIEWED") {
      row.push({ text: "Ajak Wawancara", callback_data: `app:${app.id}:interview` });
    }
    if (row.length > 0) buttons.push(row);
    // Putusan pasca-wawancara: tahap Wawancara (bawaan) — Lolos/Gugur/Tahan.
    if (app.status === "INTERVIEW") {
      buttons.push([
        { text: "Lolos", callback_data: `app:${app.id}:pass` },
        { text: "Gugur", callback_data: `app:${app.id}:reject` },
        { text: "Tahan", callback_data: `app:${app.id}:hold` },
      ]);
    }
    if (app.status !== "REJECTED" && app.status !== "ACCEPTED") {
      buttons.push([{ text: "Tolak", callback_data: `app:${app.id}:reject` }]);
      buttons.push([{ text: "Ingatkan 3 Hari Lagi", callback_data: `app:${app.id}:snooze` }]);
    }
    // Pindah tahap bebas (dropdown inline) — NR-14 idea 7.
    if (app.status !== "ACCEPTED") {
      buttons.push([{ text: "Pindah Tahap", callback_data: `app:${app.id}:stage` }]);
    }
  }
  return { text: lines.join("\n"), buttons };
}

async function buildJadwal(): Promise<BotReply> {
  const now = new Date();
  const interviews = await db.interview.findMany({
    where: {
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      scheduledAt: { gte: now, lte: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) },
    },
    include: {
      application: { select: { id: true, name: true, trackingCode: true, position: { select: { title: true } } } },
    },
    orderBy: { scheduledAt: "asc" },
    take: 6,
  });
  if (interviews.length === 0) {
    return { text: "Tidak ada wawancara terjadwal dalam 7 hari ke depan.", buttons: [] };
  }
  const lines = ["Wawancara 7 hari ke depan", ""];
  const buttons: TelegramButton[][] = [];
  for (const iv of interviews) {
    const platform =
      iv.mode === "ONSITE" ? "di lokasi" : (INTERVIEW_PLATFORM_LABELS[iv.platform as keyof typeof INTERVIEW_PLATFORM_LABELS] ?? iv.platform);
    lines.push(`${fmtDT(iv.scheduledAt)} — ${iv.application.name}`);
    lines.push(`   Ronde ${iv.round} (${platform}) | ${iv.application.position?.title ?? "-"}`);
    buttons.push([{ text: `Lihat kandidat: ${iv.application.name}`.slice(0, 60), callback_data: `app:${iv.application.id}:card` }]);
  }
  return { text: lines.join("\n"), buttons };
}

async function buildLaporan(): Promise<BotReply> {
  const [grouped, offerGrouped, lastReport] = await Promise.all([
    db.application.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    db.application.groupBy({
      by: ["offerStatus"],
      where: { deletedAt: null, offerStatus: { not: null } },
      _count: { _all: true },
    }),
    db.monthlyReport.findFirst({ orderBy: { month: "desc" } }),
  ]);

  const countMap = new Map<string, number>();
  for (const row of grouped) countMap.set(row.status, row._count._all);

  const lines = ["Laporan Singkat", "", "Pipeline:"];
  for (const status of Object.keys(STATUS_LABELS) as ApplicationStatus[]) {
    lines.push(`   ${STATUS_LABELS[status]}: ${countMap.get(status) ?? 0}`);
  }
  const custom = [...countMap.entries()].filter(([status]) => !isBuiltInStage(status));
  for (const [status, count] of custom) {
    lines.push(`   ${status}: ${count}`);
  }
  lines.push("", "Penawaran:");
  const offerLabels: Record<string, string> = {
    PENDING: "Menunggu jawaban",
    ACCEPTED: "Diterima pelamar",
    DECLINED: "Ditolak pelamar",
    EXPIRED: "Kedaluwarsa",
  };
  let hasOffer = false;
  for (const row of offerGrouped) {
    if (!row.offerStatus) continue;
    hasOffer = true;
    lines.push(`   ${offerLabels[row.offerStatus] ?? row.offerStatus}: ${row._count._all}`);
  }
  if (!hasOffer) lines.push("   Belum ada penawaran");

  if (lastReport) {
    try {
      const data = JSON.parse(lastReport.data) as {
        newApplications?: number;
        interviewsScheduled?: number;
        hired?: number;
        rejected?: number;
        avgSurveyScore?: number | null;
      };
      lines.push(
        "",
        `Rekap bulanan terakhir (${lastReport.month}):`,
        `   Lamaran baru: ${data.newApplications ?? 0} | Wawancara: ${data.interviewsScheduled ?? 0}`,
        `   Diterima: ${data.hired ?? 0} | Ditolak: ${data.rejected ?? 0}`,
        data.avgSurveyScore != null ? `   Skor survei rata-rata: ${data.avgSurveyScore}/5` : "   Skor survei: belum ada",
      );
    } catch {
      // data rekap rusak — lewati
    }
  } else {
    lines.push("", "Rekap bulanan: belum ada (dibuat otomatis tanggal 1).");
  }

  return {
    text: lines.join("\n"),
    buttons: [
      [
        { text: "Ringkasan", callback_data: "cb:ringkasan" },
        { text: "Posisi", callback_data: "cb:posisi" },
      ],
      [{ text: "Buka Dashboard", url: getSiteUrl() }],
    ],
  };
}

/* --------------------------------- Callback tombol --------------------------------- */

async function handleCallback(
  callback: TgCallbackQuery,
  token: string,
  writeEnabled: boolean,
  replies: string[],
): Promise<void> {
  const data = (callback.data ?? "").trim();
  const message = callback.message;
  if (!message) {
    await tgAnswerCallback(token, callback.id);
    return;
  }
  const chatId = message.chat.id;
  const messageId = message.message_id;
  const settings = await getAutomationSettings();
  if (!settings.telegramAllowedChats.includes(String(chatId))) {
    // Callback PUBLIK (boleh dari chat belum terhubung): langganan notifikasi
    // tahap kandidat (subs) & langganan lowongan baru (jobs) — idea 17/18.
    const subsMatch = data.match(/^subs:([A-Za-z0-9-]+):(on|off)$/);
    if (subsMatch) {
      await tgAnswerCallback(token, callback.id, subsMatch[2] === "on" ? "Notifikasi tahap AKTIF" : "Notifikasi dimatikan");
      const site = await readSiteObj();
      const subs = siteField<{ jobs?: string[]; track?: Record<string, string[]> }>(site, "telegramSubs", {});
      const track = subs.track && typeof subs.track === "object" ? { ...subs.track } : {};
      const code = subsMatch[1].toUpperCase();
      const list = new Set(Array.isArray(track[code]) ? track[code] : []);
      if (subsMatch[2] === "on") list.add(String(chatId));
      else list.delete(String(chatId));
      track[code] = [...list];
      subs.track = track;
      site.telegramSubs = subs;
      await writeSiteObj(site);
      const text =
        subsMatch[2] === "on"
          ? `Aktif: kamu akan diberi tahu setiap tahap lamaran ${code} berubah.`
          : `Notifikasi untuk lamaran ${code} dimatikan. Kamu tetap bisa cek manual kapan saja.`;
      await tgSendMessage(token, chatId, text, { buttons: [[{ text: "Cek Status", url: `${getSiteUrl()}/#status` }]] });
      replies.push(text);
      return;
    }
    if (data === "jobs:on" || data === "jobs:off") {
      await tgAnswerCallback(token, callback.id, data === "jobs:on" ? "Langganan lowongan AKTIF" : "Langganan dimatikan");
      const site = await readSiteObj();
      const subs = siteField<{ jobs?: string[]; track?: Record<string, string[]> }>(site, "telegramSubs", {});
      const jobChats = new Set(Array.isArray(subs.jobs) ? subs.jobs : []);
      if (data === "jobs:on") jobChats.add(String(chatId));
      else jobChats.delete(String(chatId));
      subs.jobs = [...jobChats];
      site.telegramSubs = subs;
      await writeSiteObj(site);
      const text =
        data === "jobs:on"
          ? "Aktif: kamu akan diberi tahu setiap ada lowongan baru di Lumina Studio."
          : "Langganan lowongan dimatikan. Kirim /lowongan untuk berlangganan lagi.";
      await tgSendMessage(token, chatId, text);
      replies.push(text);
      return;
    }
    // Jangan diam-diam: toast + pesan panduan pairing yang terlihat, supaya
    // tombol tidak terasa "mati" untuk chat yang belum terhubung.
    await tgAnswerCallback(token, callback.id, "Chat tidak terdaftar.");
    await tgSendMessage(token, chatId, pairingInstructionsText(chatId));
    replies.push("pairing-instructions");
    return;
  }

  // Navigasi cepat
  if (data === "cb:ringkasan" || data === "cb:posisi" || data === "cb:jadwal" || data === "cb:laporan" || data === "cb:help") {
    await tgAnswerCallback(token, callback.id, "Memuat...");
    let reply: BotReply;
    if (data === "cb:ringkasan") reply = await buildRingkasan();
    else if (data === "cb:posisi") reply = await buildPosisiPage(0);
    else if (data === "cb:jadwal") reply = await buildJadwal();
    else if (data === "cb:laporan") reply = await buildLaporan();
    else {
      reply = { text: HELP_HEADER(writeEnabled), buttons: [] };
    }
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  // pos:page:{n} — pagination daftar posisi
  const pageMatch = data.match(/^pos:page:(\d+)$/);
  if (pageMatch) {
    await tgAnswerCallback(token, callback.id, "Memuat...");
    const reply = await buildPosisiPage(Number(pageMatch[1]));
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  // pos:{id}:{page} — detail posisi
  const posMatch = data.match(/^pos:([A-Za-z0-9]+):(\d+)$/);
  if (posMatch) {
    await tgAnswerCallback(token, callback.id, "Memuat...");
    const position = await db.position.findUnique({
      where: { id: posMatch[1] },
      select: {
        id: true,
        title: true,
        slug: true,
        department: true,
        type: true,
        location: true,
        isActive: true,
        applyOpen: true,
        closesAt: true,
        maxApplicants: true,
        deletedAt: true,
      },
    });
    let reply: BotReply;
    if (!position || position.deletedAt) {
      reply = {
        text: "Posisi tidak ditemukan atau sudah dihapus.",
        buttons: [[{ text: "Kembali", callback_data: `pos:page:${posMatch[2]}` }]],
      };
    } else {
      const { deletedAt: _deletedAt, ...detail } = position;
      reply = await renderPosisiDetail(detail, Number(posMatch[2]));
    }
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  // app:{id}:* — kartu & aksi kandidat
  const appMatch = data.match(
    /^app:([A-Za-z0-9]+):(card|review|interview|reject|reject:yes|pass|pass:yes|hold|snooze|cv)$/,
  );
  if (appMatch) {
    const appId = appMatch[1];
    const action = appMatch[2];

    if (action === "card" || action === "reject:no" || action === "pass:no") {
      await tgAnswerCallback(token, callback.id, "Memuat...");
      const reply = await renderKandidatCard(appId);
      await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
      replies.push(reply.text);
      return;
    }

    // Unduh CV — aksi baca (tidak butuh izin tulis).
    if (action === "cv") {
      await tgAnswerCallback(token, callback.id, "Menyiapkan CV...");
      const app = await db.application.findUnique({
        where: { id: appId },
        select: { name: true, trackingCode: true, cvFileId: true },
      });
      if (!app || !app.cvFileId) {
        await tgSendMessage(token, chatId, "CV tidak tersedia untuk kandidat ini.");
        replies.push("CV tidak tersedia.");
        return;
      }
      const asset = await readAssetBuffer(app.cvFileId);
      if (!asset.ok || !asset.buffer) {
        await tgSendMessage(token, chatId, "File CV tidak bisa dibaca dari penyimpanan.");
        replies.push("File CV tidak bisa dibaca.");
        return;
      }
      const sent = await tgSendDocument(token, chatId, asset.buffer, asset.filename ?? "cv", `CV ${app.name} (${app.trackingCode ?? "-"})`);
      if (!sent) {
        await tgSendMessage(token, chatId, "Gagal mengirim CV. Coba lagi sebentar.");
      }
      replies.push(sent ? `CV ${app.name} terkirim.` : "Gagal mengirim CV.");
      return;
    }

    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }

    // Snooze / Tahan — tidak mengubah tahap, hanya mengatur pengingat.
    if (action === "hold" || action === "snooze") {
      const app = await db.application.findUnique({
        where: { id: appId },
        select: { name: true, trackingCode: true, status: true },
      });
      if (!app) {
        await tgAnswerCallback(token, callback.id, "Kandidat tidak ditemukan.");
        return;
      }
      const until = new Date(Date.now() + SNOOZE_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
      await db.application.update({ where: { id: appId }, data: { snoozeUntil: until } });
      await db.activityLog.create({
        data: {
          applicationId: appId,
          actor: `Telegram (${chatLabel(message.chat, callback.from)})`,
          action: "SNOOZE",
          detail: `Pengingat ditunda ${SNOOZE_DEFAULT_DAYS} hari (via Telegram)`,
        },
      });
      await tgAnswerCallback(token, callback.id, "Pengingat diatur");
      const reply = await renderKandidatCard(appId);
      const text = `${app.name} akan diingatkan lagi ${fmtDT(until)} (${SNOOZE_DEFAULT_DAYS} hari).\n\n${reply.text}`;
      await tgEditMessage(token, chatId, messageId, text, { buttons: reply.buttons });
      replies.push(text);
      return;
    }

    // Lolos pasca-wawancara — konfirmasi dua langkah (sama seperti Tolak).
    if (action === "pass") {
      const app = await db.application.findUnique({
        where: { id: appId },
        select: { name: true, trackingCode: true, position: { select: { title: true } }, status: true },
      });
      if (!app || app.status === "REJECTED" || app.status === "ACCEPTED") {
        await tgAnswerCallback(token, callback.id, "Kandidat tidak bisa diproses (tahap akhir).");
        return;
      }
      await tgAnswerCallback(token, callback.id, "Konfirmasi diperlukan");
      const confirmText = [
        "Loloskan kandidat ini ke tahap Penawaran?",
        "",
        `${app.name} (${app.trackingCode ?? "-"})`,
        `Posisi: ${app.position?.title ?? "-"}`,
        "",
        "Tahap akan berubah menjadi Penawaran.",
      ].join("\n");
      await tgEditMessage(token, chatId, messageId, confirmText, {
        buttons: [
          [
            { text: "Ya, Loloskan", callback_data: `app:${appId}:pass:yes` },
            { text: "Batal", callback_data: `app:${appId}:card` },
          ],
        ],
      });
      replies.push(confirmText);
      return;
    }

    if (action === "reject") {
      const app = await db.application.findUnique({
        where: { id: appId },
        select: { name: true, trackingCode: true, position: { select: { title: true } }, status: true },
      });
      if (!app || app.status === "REJECTED" || app.status === "ACCEPTED") {
        await tgAnswerCallback(token, callback.id, "Kandidat tidak bisa ditolak (tahap akhir).");
        return;
      }
      await tgAnswerCallback(token, callback.id, "Konfirmasi diperlukan");
      const confirmText = [
        "Tolak kandidat ini?",
        "",
        `${app.name} (${app.trackingCode ?? "-"})`,
        `Posisi: ${app.position?.title ?? "-"}`,
        "",
        "Pilih alasan cepat (tercatat di catatan penolakan) atau tolak tanpa alasan:",
      ].join("\n");
      const rejectButtons: TelegramButton[][] = REJECT_REASONS.map((reason, index) => [
        { text: reason.slice(0, 60), callback_data: `app:${app.id}:reject:r:${index}` },
      ]);
      rejectButtons.push([
        { text: "Tolak Tanpa Alasan", callback_data: `app:${appId}:reject:yes` },
        { text: "Batal", callback_data: `app:${appId}:card` },
      ]);
      await tgEditMessage(token, chatId, messageId, confirmText, { buttons: rejectButtons });
      replies.push(confirmText);
      return;
    }

    if (action === "review" || action === "interview" || action === "reject:yes" || action === "pass:yes") {
      const toStatus =
        action === "review" ? "REVIEWED"
        : action === "interview" ? "INTERVIEW"
        : action === "pass:yes" ? "OFFER"
        : "REJECTED";
      const actor = `Telegram (${chatLabel(message.chat, callback.from)})`;
      const result = await performStageChange(appId, toStatus, actor);
      await tgAnswerCallback(token, callback.id, result.ok ? result.message : result.message);
      const reply = await renderKandidatCard(appId);
      const text = result.ok ? `Tahap diperbarui.\n\n${reply.text}` : result.message;
      await tgEditMessage(token, chatId, messageId, text, { buttons: result.ok ? reply.buttons : [] });
      replies.push(text);
      return;
    }
  }

  // pos:{id}:close / pos:{id}:close:yes — tutup formulir posisi (dari alert kuota)
  const closeMatch = data.match(/^pos:([A-Za-z0-9]+):close(?::(yes))?$/);
  if (closeMatch) {
    const positionId = closeMatch[1];
    const position = await db.position.findUnique({
      where: { id: positionId },
      select: { title: true, applyOpen: true, deletedAt: true },
    });
    if (!position || position.deletedAt) {
      await tgAnswerCallback(token, callback.id, "Posisi tidak ditemukan.");
      return;
    }
    if (!closeMatch[2]) {
      await tgAnswerCallback(token, callback.id, "Konfirmasi diperlukan");
      const confirmText = [
        "Tutup formulir lamaran posisi ini?",
        "",
        position.title,
        "",
        "Pelamar baru tidak bisa lagi mendaftar posisi ini.",
      ].join("\n");
      await tgEditMessage(token, chatId, messageId, confirmText, {
        buttons: [
          [
            { text: "Ya, Tutup Posisi", callback_data: `pos:${positionId}:close:yes` },
            { text: "Batal", callback_data: `pos:${positionId}:0` },
          ],
        ],
      });
      replies.push(confirmText);
      return;
    }
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    await db.position.update({ where: { id: positionId }, data: { applyOpen: false } });
    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: `Telegram (${chatLabel(message.chat, callback.from)})`,
        action: "POSITION_CLOSED",
        detail: `Formulir posisi "${position.title}" ditutup via Telegram`,
      },
    });
    void emitRealtime(REALTIME_EVENTS.positions);
    await tgAnswerCallback(token, callback.id, "Posisi ditutup");
    const text = `Formulir posisi "${position.title}" telah ditutup.`;
    await tgEditMessage(token, chatId, messageId, text, { buttons: [] });
    replies.push(text);
    return;
  }

  // cb:wake — tombol "Bangunkan Sekarang" pada mode diam
  if (data === "cb:wake") {
    await tgAnswerCallback(token, callback.id, "Memproses...");
    const text = await handleWakeCallback(token, chatId);
    await tgEditMessage(token, chatId, messageId, text, { buttons: [] });
    replies.push(text);
    return;
  }

  // cb:setelan — tombol "Setelan" pada menu /bantuan
  if (data === "cb:setelan") {
    await tgAnswerCallback(token, callback.id, "Memuat...");
    const reply = await buildSetelanBody();
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  /* -------------------- Callback NR-14: tahap, massal, setelan, langganan, wizard, draft -------------------- */

  // app:{id}:stage — menu pindah tahap (dropdown inline)
  const stageMenuMatch = data.match(/^app:([A-Za-z0-9]+):stage$/);
  if (stageMenuMatch) {
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    await tgAnswerCallback(token, callback.id, "Memuat...");
    const reply = await renderStageMenu(stageMenuMatch[1]);
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  // app:{id}:stage:{i} — terapkan tahap (indeks PIPELINE_STAGES)
  const stageApplyMatch = data.match(/^app:([A-Za-z0-9]+):stage:(\d)$/);
  if (stageApplyMatch) {
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    const target = PIPELINE_STAGES[Number(stageApplyMatch[2])];
    if (!target) {
      await tgAnswerCallback(token, callback.id, "Tahap tidak dikenal.");
      return;
    }
    const actor = `Telegram (${chatLabel(message.chat, callback.from)})`;
    const result = await performStageChange(stageApplyMatch[1], target, actor);
    await tgAnswerCallback(token, callback.id, result.ok ? "Tahap diperbarui" : result.message);
    const reply = await renderKandidatCard(stageApplyMatch[1]);
    const text = result.ok ? `Tahap diperbarui ke ${stageLabel(target)}.\n\n${reply.text}` : result.message;
    await tgEditMessage(token, chatId, messageId, text, { buttons: result.ok ? reply.buttons : [] });
    replies.push(text);
    return;
  }

  // app:{id}:reject:r:{i} — tolak dengan alasan cepat (tercatat sebagai catatan penolakan)
  const rejectReasonMatch = data.match(/^app:([A-Za-z0-9]+):reject:r:(\d)$/);
  if (rejectReasonMatch) {
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    const appId = rejectReasonMatch[1];
    const reason = REJECT_REASONS[Number(rejectReasonMatch[2])];
    if (!reason) {
      await tgAnswerCallback(token, callback.id, "Alasan tidak dikenal.");
      return;
    }
    const actor = `Telegram (${chatLabel(message.chat, callback.from)})`;
    await db.application.update({ where: { id: appId }, data: { rejectionNote: reason } }).catch(() => undefined);
    const result = await performStageChange(appId, "REJECTED", actor);
    await tgAnswerCallback(token, callback.id, result.ok ? `Ditolak: ${reason}` : result.message);
    const reply = await renderKandidatCard(appId);
    const text = result.ok ? `Kandidat ditolak.\nAlasan: ${reason}\n\n${reply.text}` : result.message;
    await tgEditMessage(token, chatId, messageId, text, { buttons: result.ok ? reply.buttons : [] });
    replies.push(text);
    return;
  }

  // pos:{id}:reviewAll(:yes) — tandai semua lamaran NEW pada posisi sebagai REVIEWED (massal)
  const reviewAllMatch = data.match(/^pos:([A-Za-z0-9]+):reviewAll(?::(yes))?$/);
  if (reviewAllMatch) {
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    const positionId = reviewAllMatch[1];
    const position = await db.position.findUnique({
      where: { id: positionId },
      select: { title: true, deletedAt: true },
    });
    if (!position || position.deletedAt) {
      await tgAnswerCallback(token, callback.id, "Posisi tidak ditemukan.");
      return;
    }
    if (!reviewAllMatch[2]) {
      const pending = await db.application.count({ where: { positionId, deletedAt: null, status: "NEW" } });
      await tgAnswerCallback(token, callback.id, "Konfirmasi diperlukan");
      const confirmText = [
        "Tandai semua lamaran baru sebagai Ditinjau?",
        "",
        position.title,
        `Lamaran berstatus Baru: ${pending}`,
      ].join("\n");
      await tgEditMessage(token, chatId, messageId, confirmText, {
        buttons: [[
          { text: "Ya, Tandai Semua", callback_data: `pos:${positionId}:reviewAll:yes` },
          { text: "Batal", callback_data: `pos:${positionId}:0` },
        ]],
      });
      replies.push(confirmText);
      return;
    }
    const actor = `Telegram (${chatLabel(message.chat, callback.from)})`;
    const pendingApps = await db.application.findMany({
      where: { positionId, deletedAt: null, status: "NEW" },
      select: { id: true },
      take: 100,
    });
    await db.application.updateMany({
      where: { positionId, deletedAt: null, status: "NEW" },
      data: { status: "REVIEWED", stageUpdatedAt: new Date() },
    });
    await db.activityLog.createMany({
      data: pendingApps.map((app) => ({
        applicationId: app.id,
        actor,
        action: "STATUS_CHANGE",
        detail: "Tahap: Baru -> Ditinjau (tandai semua via Telegram)",
      })),
    }).catch(() => undefined);
    emitRealtime(REALTIME_EVENTS.applications);
    await tgAnswerCallback(token, callback.id, `${pendingApps.length} lamaran ditandai`);
    const text = `Selesai: ${pendingApps.length} lamaran pada "${position.title}" ditandai sebagai Ditinjau.`;
    await tgEditMessage(token, chatId, messageId, text, { buttons: [] });
    replies.push(text);
    return;
  }

  // set:* — toggle setelan dari /setelan (mode tulis, jam tenang, alert per jenis)
  const setMatch = data.match(/^set:(write|quiet|alert:([a-zA-Z]+))$/);
  if (setMatch) {
    const site = await readSiteObj();
    if (setMatch[1] === "write") {
      const next = !(await getAutomationSettings()).telegramWriteEnabled;
      site.telegramWriteEnabled = next;
      await writeSiteObj(site);
      await tgAnswerCallback(token, callback.id, next ? "Aksi tulis AKTIF" : "Aksi tulis NONAKTIF");
    } else if (setMatch[1] === "quiet") {
      const current = await getAutomationSettings();
      const quiet = { ...current.telegramQuietHours, enabled: !current.telegramQuietHours.enabled };
      site.telegramQuietHours = quiet;
      await writeSiteObj(site);
      await tgAnswerCallback(token, callback.id, quiet.enabled ? "Mode tenang AKTIF" : "Mode tenang NONAKTIF");
    } else {
      const key = setMatch[2] as TelegramAlertKey;
      if (!TELEGRAM_ALERT_KEYS.includes(key)) {
        await tgAnswerCallback(token, callback.id, "Jenis alert tidak dikenal.");
        return;
      }
      const current = await getAutomationSettings();
      const alerts = { ...current.telegramAlerts, [key]: !current.telegramAlerts[key] };
      site.telegramAlerts = alerts;
      await writeSiteObj(site);
      await tgAnswerCallback(token, callback.id, `${TELEGRAM_ALERT_LABELS[key]}: ${alerts[key] ? "AKTIF" : "NONAKTIF"}`);
    }
    const reply = await buildSetelanBody();
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  // subs:{code}:on|off — langganan notifikasi perubahan tahap (kandidat, publik)
  const subsMatch = data.match(/^subs:([A-Za-z0-9-]+):(on|off)$/);
  if (subsMatch) {
    const code = subsMatch[1].toUpperCase();
    const site = await readSiteObj();
    const subs = siteField<{ jobs?: string[]; track?: Record<string, string[]> }>(site, "telegramSubs", {});
    const track = subs.track && typeof subs.track === "object" ? { ...subs.track } : {};
    const list = new Set(Array.isArray(track[code]) ? track[code] : []);
    const chatKey = String(chatId);
    if (subsMatch[2] === "on") {
      list.add(chatKey);
    } else {
      list.delete(chatKey);
    }
    track[code] = [...list];
    subs.track = track;
    site.telegramSubs = subs;
    await writeSiteObj(site);
    await tgAnswerCallback(
      token,
      callback.id,
      subsMatch[2] === "on" ? "Notifikasi tahap AKTIF" : "Notifikasi tahap dimatikan",
    );
    const text =
      subsMatch[2] === "on"
        ? `Aktif: kamu akan diberi tahu setiap tahap lamaran ${code} berubah.`
        : `Notifikasi untuk lamaran ${code} dimatikan. Kamu tetap bisa cek manual kapan saja.`;
    await tgSendMessage(token, chatId, text, { buttons: [[{ text: "Cek Status", url: `${getSiteUrl()}/#status` }]] });
    replies.push(text);
    return;
  }

  // jobs:on|off — langganan broadcast lowongan baru (publik)
  if (data === "jobs:on" || data === "jobs:off") {
    const site = await readSiteObj();
    const subs = siteField<{ jobs?: string[]; track?: Record<string, string[]> }>(site, "telegramSubs", {});
    const jobChats = new Set(Array.isArray(subs.jobs) ? subs.jobs : []);
    const chatKey = String(chatId);
    if (data === "jobs:on") jobChats.add(chatKey);
    else jobChats.delete(chatKey);
    subs.jobs = [...jobChats];
    site.telegramSubs = subs;
    await writeSiteObj(site);
    await tgAnswerCallback(token, callback.id, data === "jobs:on" ? "Langganan lowongan AKTIF" : "Langganan dimatikan");
    const text =
      data === "jobs:on"
        ? "Aktif: kamu akan diberi tahu setiap ada lowongan baru di Lumina Studio."
        : "Langganan lowongan dimatikan. Kirim /lowongan untuk berlangganan lagi.";
    await tgSendMessage(token, chatId, text);
    replies.push(text);
    return;
  }

  // wiz:type:{i} — wizard offer: pilih tipe pekerjaan
  const wizTypeMatch = data.match(/^wiz:type:(\d)$/);
  if (wizTypeMatch) {
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    const type = OFFER_TYPES[Number(wizTypeMatch[1])];
    if (!type) {
      await tgAnswerCallback(token, callback.id, "Tipe tidak dikenal.");
      return;
    }
    await tgAnswerCallback(token, callback.id, `Tipe: ${type}`);
    const reply = await advanceOfferWizard(chatId, { type });
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  // wiz:send — wizard offer: kirim offer
  if (data === "wiz:send") {
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    await tgAnswerCallback(token, callback.id, "Mengirim offer...");
    const result = await sendOfferFromBot(chatId, `Telegram (${chatLabel(message.chat, callback.from)})`);
    await tgEditMessage(token, chatId, messageId, result, { buttons: [] });
    replies.push(result);
    return;
  }

  // wiz:cancel — wizard offer: batalkan
  if (data === "wiz:cancel") {
    await clearOfferWizard(chatId);
    await tgAnswerCallback(token, callback.id, "Wizard dibatalkan");
    await tgEditMessage(token, chatId, messageId, "Wizard offer dibatalkan.", { buttons: [] });
    replies.push("Wizard offer dibatalkan.");
    return;
  }

  // draft:{appId}:send|ok — kirim draft balasan AI ke kandidat via email / buang
  const draftMatch = data.match(/^draft:([A-Za-z0-9]+):(send|ok)$/);
  if (draftMatch) {
    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
      return;
    }
    const site = await readSiteObj();
    const drafts = siteField<Record<string, { text: string; createdAt: string }>>(site, "telegramDrafts", {});
    const draft = drafts[draftMatch[1]];
    if (!draft) {
      await tgAnswerCallback(token, callback.id, "Draft tidak ditemukan (mungkin sudah dibuang).");
      return;
    }
    if (draftMatch[2] === "ok") {
      delete drafts[draftMatch[1]];
      site.telegramDrafts = drafts;
      await writeSiteObj(site);
      await tgAnswerCallback(token, callback.id, "Draft dibuang");
      await tgEditMessage(token, chatId, messageId, "Draft dibuang tanpa dikirim.", { buttons: [] });
      replies.push("Draft dibuang.");
      return;
    }
    const app = await db.application.findUnique({
      where: { id: draftMatch[1] },
      select: { name: true, email: true, trackingCode: true },
    });
    if (!app || !app.email) {
      await tgAnswerCallback(token, callback.id, "Email kandidat tidak tersedia.");
      return;
    }
    const { queueEmail } = await import("@/lib/notify");
    await queueEmail({
      toEmail: app.email,
      subject: `Kabar terbaru dari Lumina Studio — ${app.trackingCode ?? "lamaranmu"}`,
      body: draft.text,
      applicationId: draftMatch[1],
      kind: "draft-ai",
    });
    const actor = `Telegram (${chatLabel(message.chat, callback.from)})`;
    await db.activityLog.create({
      data: {
        applicationId: draftMatch[1],
        actor,
        action: "DRAFT_SENT",
        detail: `Draft balasan AI dikirim via email ke kandidat`,
      },
    }).catch(() => undefined);
    delete drafts[draftMatch[1]];
    site.telegramDrafts = drafts;
    await writeSiteObj(site);
    await tgAnswerCallback(token, callback.id, "Email masuk antrean kirim");
    const text = `Draft dijadwalkan kirim ke email kandidat (${app.email}).\nCek tab Data untuk status pengiriman.`;
    await tgEditMessage(token, chatId, messageId, text, { buttons: [] });
    replies.push(text);
    return;
  }

  // kandidat:filter / kandidat:filter:{key} — filter cepat pencarian kandidat
  const kandidatFilterMatch = data.match(/^kandidat:filter(?::([a-z]+))?$/);
  if (kandidatFilterMatch) {
    await tgAnswerCallback(token, callback.id, "Memuat...");
    const reply = kandidatFilterMatch[1]
      ? await buildKandidatFilteredList(kandidatFilterMatch[1])
      : await buildKandidatFilterMenu();
    await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return;
  }

  await tgAnswerCallback(token, callback.id);
}

/* --------------------------------- Aksi tulis tahap --------------------------------- */

async function performStageChange(
  applicationId: string,
  toStatus: string,
  actor: string,
): Promise<{ ok: boolean; message: string }> {
  const existing = await db.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      stageHistory: true,
      trackingCode: true,
      offerStatus: true,
      deletedAt: true,
      position: { select: { title: true } },
    },
  });
  if (!existing || existing.deletedAt) {
    return { ok: false, message: "Lamaran tidak ditemukan." };
  }
  if (existing.status === toStatus) {
    return { ok: false, message: `Kandidat sudah berada di tahap ${stageLabel(toStatus)}.` };
  }
  if (toStatus === "REJECTED" && existing.status === "ACCEPTED") {
    return { ok: false, message: "Kandidat sudah diterima — tidak bisa ditolak." };
  }

  const labelOf = (status: string): string => (isBuiltInStage(status) ? STATUS_LABELS[status as ApplicationStatus] : status);
  const updateData: { status: string; stageUpdatedAt: Date; stageHistory: string; offerStatus?: string | null } = {
    status: toStatus,
    stageUpdatedAt: new Date(),
    // Riwayat tahap (NR-15): perpindahan via bot juga tercatat di timeline pelamar.
    stageHistory: appendStageHistory(existing.stageHistory, toStatus, existing.status),
  };
  // Sama seperti PATCH admin: tolak kandidat -> penawaran aktif otomatis dibatalkan.
  if (toStatus === "REJECTED" && existing.offerStatus === "PENDING") {
    updateData.offerStatus = null;
  }

  const updated = await db.application.update({
    where: { id: applicationId },
    data: updateData,
    include: { position: { select: { title: true } } },
  });

  const logs: { actor: string; action: string; detail: string }[] = [
    {
      actor,
      action: "STATUS_CHANGE",
      detail: `${labelOf(existing.status)} → ${labelOf(toStatus)} (via Telegram)`,
    },
  ];
  if (updateData.offerStatus === null) {
    logs.push({
      actor,
      action: "OFFER_CANCELLED",
      detail: "Penawaran aktif dibatalkan otomatis — lamaran ditolak",
    });
  }
  await db.activityLog.createMany({ data: logs.map((log) => ({ ...log, applicationId })) });

  // Efek samping sama seperti PATCH admin (fire-and-forget, tidak pernah gagalkan aksi).
  await emitWebhook("application.stage_changed", {
    id: applicationId,
    name: existing.name,
    from: existing.status,
    to: toStatus,
  }).catch(() => undefined);
  void sendCandidateStatusEmail({
    applicationId,
    name: existing.name,
    email: existing.email,
    trackingCode: existing.trackingCode,
    toStatus,
    positionTitle: updated.position?.title ?? null,
  });
  void emitRealtime(REALTIME_EVENTS.applications);

  return { ok: true, message: `${existing.name} dipindah ke tahap ${labelOf(toStatus)}.` };
}

/* --------------------------------- Digest pagi --------------------------------- */

/**
 * Digest pagi 07.00 WIB — dipanggil cron reminders tiap menit; internal idempoten
 * (sekali per hari, dicatat di Setting "site".telegramLastDigest). force=true untuk
 * uji tanpa melihat jam.
 */
export async function runTelegramDigest(force = false): Promise<{ sent: number; reason?: string; preview?: string }> {
  const settings = await getAutomationSettings();
  if (!settings.telegramBotToken) return { sent: 0, reason: "no-token" };
  if (!settings.telegramAlerts.digest) return { sent: 0, reason: "toggle-off" };
  if (settings.telegramAllowedChats.length === 0) return { sent: 0, reason: "no-chat" };
  if (!force) {
    if (bangkokHour() < DIGEST_HOUR_BANGKOK) return { sent: 0, reason: "not-time" };
  }
  const today = bangkokTodayKey();
  const site = await readSiteObj();
  if (typeof site.telegramLastDigest === "string" && site.telegramLastDigest === today) {
    return { sent: 0, reason: "already-sent" };
  }

  const dayStart = new Date(`${today}T00:00:00+07:00`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [todayInterviews, newCount, staleList] = await Promise.all([
    db.interview.findMany({
      where: {
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        scheduledAt: { gte: dayStart, lt: dayEnd },
      },
      include: { application: { select: { id: true, name: true, position: { select: { title: true } } } } },
      orderBy: { scheduledAt: "asc" },
      take: 5,
    }),
    db.application.count({ where: { deletedAt: null, status: "NEW" } }),
    db.application.findMany({
      where: {
        deletedAt: null,
        status: { in: ["NEW", "REVIEWED"] },
        AND: [
          { OR: [{ stageUpdatedAt: { lt: staleThreshold } }, { stageUpdatedAt: null, createdAt: { lt: staleThreshold } }] },
          // Kandidat yang di-snooze lewat bot tidak muncul di digest sampai waktunya.
          { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: new Date() } }] },
        ],
      },
      select: { id: true, name: true, status: true },
      orderBy: { createdAt: "asc" },
      take: 5,
    }),
  ]);

  const staleCountTotal = await db.application.count({
    where: {
      deletedAt: null,
      status: { in: ["NEW", "REVIEWED"] },
      AND: [
        { OR: [{ stageUpdatedAt: { lt: staleThreshold } }, { stageUpdatedAt: null, createdAt: { lt: staleThreshold } }] },
        { OR: [{ snoozeUntil: null }, { snoozeUntil: { lte: new Date() } }] },
      ],
    },
  });

  // Kuota hampir penuh: posisi aktif dengan sisa <= 1 (termasuk penuh).
  const rows = await loadPosisiRows();
  const tight = rows
    .filter((r) => r.isActive && r.maxApplicants != null)
    .map((r) => ({ title: r.title, remaining: (r.maxApplicants as number) - r.count }))
    .filter((r) => r.remaining <= 1)
    .slice(0, 5);

  const lines: string[] = [
    `Digest Pagi Lumina Studio`,
    dayStart.toLocaleDateString("id-ID", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    "",
  ];
  lines.push(`Wawancara hari ini: ${todayInterviews.length} sesi`);
  for (const iv of todayInterviews) {
    lines.push(`   ${fmtT(iv.scheduledAt)} — ${iv.application.name} (${iv.application.position?.title ?? "-"})`);
  }
  lines.push("", `Belum ditinjau: ${newCount} lamaran baru`);
  if (staleCountTotal > 0) lines.push(`   ${staleCountTotal} melewati 7 hari tanpa perubahan`);
  lines.push("", `Kuota hampir penuh: ${tight.length > 0 ? "" : "tidak ada"}`);
  for (const item of tight) {
    lines.push(`   ${item.title} — sisa ${Math.max(item.remaining, 0)}`);
  }
  // Notifikasi yang ditahan mode tenang semalam (dirangkum sekali, lalu direset).
  const quietHeld = typeof site.telegramQuietCount === "number" ? site.telegramQuietCount : 0;
  if (quietHeld > 0) {
    lines.push("", `Mode tenang semalam menahan ${quietHeld} notifikasi non-kritis.`);
    site.telegramQuietCount = 0;
  }

  const buttons: TelegramButton[][] = [
    [
      { text: "Ringkasan", callback_data: "cb:ringkasan" },
      { text: "Jadwal", callback_data: "cb:jadwal" },
    ],
    [{ text: "Buka Lumina Mini", webAppUrl: `${getSiteUrl()}/?mini=1` }],
  ];
  if (settings.telegramWriteEnabled && staleList.length > 0) {
    for (const item of staleList.slice(0, 5)) {
      buttons.push([
        { text: `Tandai Ditinjau: ${item.name}`.slice(0, 60), callback_data: `app:${item.id}:review` },
      ]);
    }
  }

  let sent = 0;
  for (const chat of activeChats(settings)) {
    const ok = await tgSendMessage(settings.telegramBotToken, chat, lines.join("\n"), { buttons });
    if (ok) sent += 1;
  }

  // preview = isi digest yang dihasilkan (terkirim atau tidak) — berguna untuk
  // pengujian endpoint /api/telegram/digest tanpa token asli.
  const preview = lines.join("\n");

  if (sent > 0) {
    site.telegramLastDigest = today;
    await writeSiteObj(site);
    try {
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: "Sistem",
          action: "TELEGRAM_DIGEST",
          detail: `Digest pagi dikirim ke ${sent} chat Telegram`,
        },
      });
    } catch {
      // diam
    }
  }
  return { sent, preview };
}

/* ------------------- Proaktif: snooze, kuota, grafik mingguan ------------------- */

/**
 * Kirim pengingat snooze yang jatuh tempo: kandidat yang di-"Tahan"/"Ingatkan 3 hari"
 * akan dikirim ulang kartunya ke chat admin, lalu penandanya dibersihkan.
 * Dipanggil cron reminders tiap menit. Return jumlah kartu terkirim.
 */
export async function runTelegramSnoozeDispatch(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken || settings.telegramAllowedChats.length === 0) return 0;
    const now = new Date();
    const due = await db.application.findMany({
      where: { deletedAt: null, snoozeUntil: { lte: now } },
      select: { id: true },
      take: 10,
    });
    let sent = 0;
    for (const item of due) {
      const reply = await renderKandidatCard(item.id);
      const text = `Pengingat Terjadwal\nWaktunya menindaklanjuti kandidat ini.\n\n${reply.text}`;
      for (const chat of activeChats(settings)) {
        const ok = await tgSendMessage(settings.telegramBotToken, chat, text, { buttons: reply.buttons });
        if (ok) sent += 1;
      }
      await db.application.update({ where: { id: item.id }, data: { snoozeUntil: null } });
      await db.activityLog.create({
        data: {
          applicationId: item.id,
          actor: "Sistem",
          action: "SNOOZE_SENT",
          detail: "Pengingat snooze terkirim ke chat admin via Telegram",
        },
      });
    }
    return sent;
  } catch {
    return 0;
  }
}

/**
 * Alert kuota posisi: posisi aktif berkuota dengan sisa <= 1 (atau penuh) memicu
 * peringatan + tombol Tutup Posisi (dua langkah). Dedup via site.telegramQuotaAlerts
 * (positionId -> sisa saat terakhir diingatkan) agar tidak spam tiap menit; alert
 * diulang bila sisa berkurang lagi (mis. 1 -> 0). Dipanggil cron reminders tiap menit.
 */
export async function runTelegramQuotaCheck(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    if (!settings.telegramAlerts.quota) return 0;
    const chats = activeChats(settings);
    if (chats.length === 0) return 0;

    const rows = await loadPosisiRows();
    const site = await readSiteObj();
    const dedup = (site.telegramQuotaAlerts && typeof site.telegramQuotaAlerts === "object" && !Array.isArray(site.telegramQuotaAlerts)
      ? { ...(site.telegramQuotaAlerts as Record<string, unknown>) }
      : {}) as Record<string, number>;

    let alerts = 0;
    let changed = false;
    for (const row of rows) {
      if (!row.isActive || row.maxApplicants == null) continue;
      const remaining = row.maxApplicants - row.count;
      const key = row.id;
      // Peringatan dini 80% terisi: sisa <= 20% kuota tapi masih >= 2 slot.
      const eightyPercentReached =
        remaining >= 2 && remaining <= Math.ceil(row.maxApplicants * (1 - QUOTA_WARNING_RATIO));
      if (remaining > 1 && !eightyPercentReached) {
        // Kuota longgar kembali — bersihkan penanda agar alert bisa muncul lagi nanti.
        if (dedup[key] !== undefined) {
          delete dedup[key];
          changed = true;
        }
        continue;
      }
      if (dedup[key] === remaining) continue; // sudah diingatkan pada level ini
      dedup[key] = remaining;
      changed = true;
      const label = remaining <= 0 ? "KUOTA PENUH" : eightyPercentReached ? "KUOTA 80% TERISI" : "Kuota hampir penuh";
      const text = [
        `Alert Kuota Posisi — ${label}`,
        "",
        `${row.title}`,
        `${row.count}/${row.maxApplicants} lamaran (sisa ${Math.max(remaining, 0)})`,
        "",
        remaining <= 0
          ? "Kuota lamaran sudah terpenuhi. Tutup formulir agar pelamar baru tidak mendaftar lagi."
          : "Sisa kuota tinggal sedikit. Pertimbangkan menutup formulir atau menambah kuota.",
      ].join("\n");
      for (const chat of chats) {
        const ok = await tgSendMessage(settings.telegramBotToken, chat, text, {
          buttons: [[{ text: "Tutup Posisi", callback_data: `pos:${row.id}:close` }]],
        });
        if (ok) alerts += 1;
      }
    }
    if (changed) {
      site.telegramQuotaAlerts = dedup;
      await writeSiteObj(site);
    }
    return alerts;
  } catch {
    return 0;
  }
}

/* ----------------------------- Grafik mingguan (PNG) ----------------------------- */

type ChartDay = { label: string; value: number };

/** Bangun PNG grafik batang 7 hari via ImageResponse (next/og) — tanpa dependensi baru. */
async function buildWeeklyChartPng(days: ChartDay[]): Promise<Buffer | null> {
  try {
    const { ImageResponse } = await import("next/og");
    const React = await import("react");
    const max = Math.max(...days.map((d) => d.value), 1);
    const barAreaHeight = 260;
    const elements = days.map((day) => {
      const height = Math.max(Math.round((day.value / max) * barAreaHeight), day.value > 0 ? 8 : 2);
      return React.createElement(
        "div",
        {
          key: day.label,
          style: { display: "flex", flexDirection: "column", alignItems: "center", width: 88, gap: 8 },
        },
        React.createElement(
          "div",
          { style: { display: "flex", fontSize: 22, color: "#3f3f46", fontWeight: 700 } },
          String(day.value),
        ),
        React.createElement("div", {
          style: {
            display: "flex",
            width: 56,
            height,
            backgroundColor: day.value > 0 ? "#e11d48" : "#e4e4e7",
            borderRadius: 8,
          },
        }),
        React.createElement(
          "div",
          { style: { display: "flex", fontSize: 18, color: "#71717a" } },
          day.label,
        ),
      );
    });
    const image = new ImageResponse(
      React.createElement(
        "div",
        {
          style: {
            display: "flex",
            flexDirection: "column",
            width: 800,
            height: 420,
            backgroundColor: "#ffffff",
            padding: "36px 44px",
            fontFamily: "sans-serif",
          },
        },
        React.createElement(
          "div",
          { style: { display: "flex", fontSize: 30, fontWeight: 700, color: "#18181b" } },
          "Lamaran Masuk — 7 Hari Terakhir",
        ),
        React.createElement(
          "div",
          { style: { display: "flex", fontSize: 18, color: "#71717a", marginBottom: 20 } },
          "Lumina Studio · dikirim otomatis oleh bot Telegram",
        ),
        React.createElement(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              flex: 1,
              borderTop: "1px solid #e4e4e7",
              paddingTop: 16,
            },
          },
          elements,
        ),
      ),
      { width: 800, height: 420 },
    );
    const arrayBuffer = await image.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Grafik mingguan tiap SENIN jam 08.xx WIB (menyusul digest pagi) — PNG batang
 * lamaran masuk 7 hari terakhir, dikirim sebagai foto. Idempoten via
 * site.telegramLastChart; mengikuti toggle alert "digest" (keluarga laporan terjadwal).
 */
export async function runTelegramWeeklyChart(force = false): Promise<{ sent: number; reason?: string }> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return { sent: 0, reason: "no-token" };
    if (!settings.telegramAlerts.digest) return { sent: 0, reason: "toggle-off" };
    const chats = activeChats(settings);
    if (chats.length === 0) return { sent: 0, reason: "no-chat" };
    const today = bangkokTodayKey();
    if (!force) {
      const weekday = new Date(`${today}T12:00:00+07:00`).getUTCDay(); // Senin = 1
      if (weekday !== 1) return { sent: 0, reason: "not-monday" };
      if (bangkokHour() < CHART_HOUR_BANGKOK) return { sent: 0, reason: "not-time" };
    }
    const site = await readSiteObj();
    if (!force && typeof site.telegramLastChart === "string" && site.telegramLastChart === today) {
      return { sent: 0, reason: "already-sent" };
    }

    // Hitung lamaran per hari (batas hari Asia/Bangkok).
    const todayStart = new Date(`${today}T00:00:00+07:00`);
    const dayNames = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
    const days: ChartDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const start = new Date(todayStart.getTime() - i * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const value = await db.application.count({ where: { deletedAt: null, createdAt: { gte: start, lt: end } } });
      const weekdayIndex = new Date(start.getTime() + 4 * 60 * 60 * 1000).getUTCDay(); // tetap di hari yang sama (UTC+7)
      days.push({ label: dayNames[weekdayIndex] ?? "-", value });
    }

    const png = await buildWeeklyChartPng(days);
    if (!png) return { sent: 0, reason: "chart-failed" };

    const caption = `Grafik Mingguan — lamaran masuk 7 hari terakhir (total ${days.reduce((sum, d) => sum + d.value, 0)}).`;
    let sent = 0;
    for (const chat of chats) {
      const ok = await tgSendPhoto(settings.telegramBotToken, chat, png, `lamaran-${today}.png`, caption);
      if (ok) sent += 1;
    }
    if (sent > 0) {
      site.telegramLastChart = today;
      await writeSiteObj(site);
      await db.activityLog
        .create({
          data: {
            applicationId: null,
            actor: "Sistem",
            action: "TELEGRAM_CHART",
            detail: `Grafik mingguan dikirim ke ${sent} chat Telegram`,
          },
        })
        .catch(() => undefined);
    }
    return { sent };
  } catch {
    return { sent: 0, reason: "error" };
  }
}

/* ============================ Penjadwal lanjutan (NR-14) ============================ */

/**
 * Pengingat wawancara berjenjang ke chat admin: H-1 hari (jendela 23-25 jam)
 * dan H-2 jam (jendela 1,5-2,5 jam). Dedup per sesi via site.telegramReminderSent
 * ({interviewId: "day"|"hour"}), entri lama dibersihkan otomatis.
 */
export async function runTelegramInterviewReminders(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    if (!settings.telegramAlerts.interviewReminder) return 0;
    const chats = activeChats(settings);
    if (chats.length === 0) return 0;

    const now = Date.now();
    const windows = [
      { kind: "day" as const, from: now + 23 * 3600_000, to: now + 25 * 3600_000, label: "H-1 hari" },
      { kind: "hour" as const, from: now + 1.5 * 3600_000, to: now + 2.5 * 3600_000, label: "H-2 jam" },
    ];

    const site = await readSiteObj();
    const sentMap = siteField<Record<string, string>>(site, "telegramReminderSent", {});
    const validIds = new Set<string>();
    let sentTotal = 0;
    let changed = false;

    for (const win of windows) {
      const interviews = await db.interview.findMany({
        where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: new Date(win.from), lte: new Date(win.to) } },
        include: {
          application: { select: { id: true, name: true, trackingCode: true, position: { select: { title: true } } } },
        },
      });
      for (const iv of interviews) {
        validIds.add(iv.id);
        if (sentMap[iv.id] === win.kind) continue; // sudah diingatkan untuk jendela ini
        sentMap[iv.id] = win.kind;
        changed = true;
        const app = iv.application;
        const text = [
          `Pengingat Wawancara (${win.label})`,
          "",
          `${app.name} — ${app.position?.title ?? "-"}`,
          `Ronde ${iv.round} | ${fmtDT(iv.scheduledAt)}`,
          iv.meetingLink ? `Tautan: ${iv.meetingLink}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const buttons: TelegramButton[][] = [[{ text: "Lihat Kandidat", callback_data: `app:${app.id}:card` }]];
        if (app.trackingCode) {
          buttons.push([
            { text: "Buka Panel", url: `${getSiteUrl()}/?kandidat=${encodeURIComponent(app.trackingCode)}#admin` },
          ]);
        }
        sentTotal += await sendToAdminChats(settings, "interviewReminder", text, buttons);
      }
    }

    // Bersihkan entri untuk sesi yang sudah lewat (> 3 hari).
    for (const id of Object.keys(sentMap)) {
      if (!validIds.has(id)) {
        delete sentMap[id];
        changed = true;
      }
    }
    if (changed) {
      site.telegramReminderSent = sentMap;
      await writeSiteObj(site);
    }
    return sentTotal;
  } catch {
    return 0;
  }
}

/**
 * Alert SLA lamaran menginap: NEW/REVIEWED lebih dari SLA_STALE_DAYS hari tanpa
 * perubahan (dan tidak di-snooze). Dedup per kandidat per hari via
 * site.telegramSlaSent ({appId: dateKey}) — menginap lama tidak mengspam.
 */
export async function runTelegramSlaCheck(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    if (!settings.telegramAlerts.slaStale) return 0;
    const chats = activeChats(settings);
    if (chats.length === 0) return 0;

    const cutoff = new Date(Date.now() - SLA_STALE_DAYS * 24 * 60 * 60 * 1000);
    const stale = await db.application.findMany({
      where: {
        deletedAt: null,
        status: { in: ["NEW", "REVIEWED"] },
        createdAt: { lt: cutoff },
        OR: [{ snoozeUntil: null }, { snoozeUntil: { lt: new Date() } }],
      },
      include: { position: { select: { title: true } } },
      orderBy: { createdAt: "asc" },
      take: 10,
    });
    if (stale.length === 0) return 0;

    const site = await readSiteObj();
    const slaSent = siteField<Record<string, string>>(site, "telegramSlaSent", {});
    const today = dateKeyBangkok();
    let sent = 0;
    let changed = false;

    for (const app of stale) {
      if (slaSent[app.id] === today) continue; // sudah diingatkan hari ini
      slaSent[app.id] = today;
      changed = true;
      const days = Math.floor((Date.now() - app.createdAt.getTime()) / (24 * 60 * 60 * 1000));
      const text = [
        `Lamaran Menginap (${days} hari)`,
        "",
        `${app.name} (${app.trackingCode ?? "-"})`,
        `Posisi: ${app.position?.title ?? "-"}`,
        `Tahap: ${stageLabel(app.status)}`,
        `Masuk: ${fmtDT(app.createdAt)}`,
        "",
        "Melewati batas tinjauan. Proses atau tunda dengan snooze.",
      ].join("\n");
      const buttons: TelegramButton[][] = [[
        { text: "Lihat Kandidat", callback_data: `app:${app.id}:card` },
      ]];
      if (settings.telegramWriteEnabled && app.status === "NEW") {
        buttons.push([{ text: "Tandai Ditinjau", callback_data: `app:${app.id}:review` }]);
      }
      buttons.push([{ text: "Ingatkan 3 Hari Lagi", callback_data: `app:${app.id}:snooze` }]);
      for (const chat of chats) {
        const ok = await tgSendMessage(settings.telegramBotToken, chat, text, { buttons });
        if (ok) sent += 1;
      }
    }
    if (changed) {
      site.telegramSlaSent = slaSent;
      await writeSiteObj(site);
    }
    return sent;
  } catch {
    return 0;
  }
}

/**
 * Digest sore (17.00 WIB, sekali per hari): wawancara besok, lamaran baru hari ini
 * yang belum ditinjau, offer mendekati deadline, plus jumlah notifikasi yang
 * ditahan mode tenang sejak digest pagi.
 */
export async function runTelegramDigestEvening(force = false): Promise<{ sent: number; reason?: string }> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return { sent: 0, reason: "no-token" };
    if (!settings.telegramAlerts.digestEvening) return { sent: 0, reason: "toggle-off" };
    if (!force && bangkokHourNow() < EVENING_DIGEST_HOUR_BANGKOK) return { sent: 0, reason: "not-time" };

    const site = await readSiteObj();
    const today = dateKeyBangkok();
    if (!force && siteField<string>(site, "telegramLastDigestEvening", "") === today) {
      return { sent: 0, reason: "already" };
    }

    const now = new Date();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [tomorrowInterviews, newToday, offersSoon] = await Promise.all([
      db.interview.findMany({
        where: { status: { in: ["SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: tomorrowStart, lt: tomorrowEnd } },
        include: { application: { select: { name: true, position: { select: { title: true } } } } },
        orderBy: { scheduledAt: "asc" },
      }),
      db.application.count({ where: { deletedAt: null, createdAt: { gte: todayStart }, status: "NEW" } }),
      db.application.findMany({
        where: { deletedAt: null, offerStatus: "PENDING", offerDeadline: { lte: new Date(now.getTime() + 48 * 3600_000) } },
        select: { name: true, trackingCode: true, offerDeadline: true },
      }),
    ]);

    const quietHeld = typeof site.telegramQuietCount === "number" ? site.telegramQuietCount : 0;
    const lines: string[] = ["Digest Sore Lumina Studio", today, ""];
    lines.push(`Wawancara besok: ${tomorrowInterviews.length} sesi`);
    for (const iv of tomorrowInterviews) {
      lines.push(`   ${fmtDT(iv.scheduledAt)} — ${iv.application.name} (${iv.application.position?.title ?? "-"})`);
    }
    lines.push("", `Lamaran baru hari ini belum ditinjau: ${newToday}`);
    if (offersSoon.length > 0) {
      lines.push(`Offer menunggu jawaban (<= 48 jam): ${offersSoon.length}`);
      for (const app of offersSoon.slice(0, 5)) {
        lines.push(`   ${app.name} — batas ${app.offerDeadline ? fmtDT(app.offerDeadline) : "-"}`);
      }
    }
    if (quietHeld > 0) {
      lines.push("", `Mode tenang menahan ${quietHeld} notifikasi non-kritis sejak pagi — dirangkum normal kembali besok.`);
    }

    const buttons: TelegramButton[][] = [
      [
        { text: "Ringkasan", callback_data: "cb:ringkasan" },
        { text: "Jadwal", callback_data: "cb:jadwal" },
      ],
    ];
    const miniUrl = `${getSiteUrl()}/?mini=1`;
    buttons.push([{ text: "Buka Lumina Mini", webAppUrl: miniUrl }]);

    const sent = await sendToAdminChats(settings, "digestEvening", lines.join("\n"), buttons);
    if (sent > 0 || force) {
      site.telegramLastDigestEvening = today;
      // Penghitung mode tenang dianggap "dilaporkan" oleh digest sore — reset.
      site.telegramQuietCount = 0;
      await writeSiteObj(site);
      await db.activityLog
        .create({
          data: {
            applicationId: null,
            actor: "Sistem",
            action: "TELEGRAM_DIGEST_EVENING",
            detail: `Digest sore dikirim ke ${sent} chat Telegram`,
          },
        })
        .catch(() => undefined);
    }
    return { sent };
  } catch {
    return { sent: 0, reason: "error" };
  }
}

/**
 * Rekap mingguan (Senin >= 08.00 WIB, setelah grafik): funnel 7 hari terakhir,
 * posisi terpopuler, testimoni survei berbintang tinggi.
 */
export async function runTelegramDigestWeekly(force = false): Promise<{ sent: number; reason?: string }> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return { sent: 0, reason: "no-token" };
    if (!settings.telegramAlerts.digestWeekly) return { sent: 0, reason: "toggle-off" };
    const now = new Date();
    const dayBangkok = String(now.toLocaleDateString("en-US", { timeZone: "Asia/Bangkok", weekday: "short" }));
    if (!force && dayBangkok !== "Mon") return { sent: 0, reason: "not-monday" };
    if (!force && bangkokHourNow() < WEEKLY_DIGEST_HOUR_BANGKOK) return { sent: 0, reason: "not-time" };

    const site = await readSiteObj();
    const week = weekKeyBangkok(now);
    if (!force && siteField<string>(site, "telegramLastDigestWeekly", "") === week) {
      return { sent: 0, reason: "already" };
    }

    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [newWeek, interviewedWeek, acceptedWeek, rejectedWeek, byPosition] = await Promise.all([
      db.application.count({ where: { deletedAt: null, createdAt: { gte: weekAgo } } }),
      db.interview.count({ where: { status: "COMPLETED", updatedAt: { gte: weekAgo } } }),
      db.application.count({ where: { deletedAt: null, status: "ACCEPTED", stageUpdatedAt: { gte: weekAgo } } }),
      db.application.count({ where: { deletedAt: null, status: "REJECTED", stageUpdatedAt: { gte: weekAgo } } }),
      db.application.groupBy({
        by: ["positionId"],
        where: { deletedAt: null, createdAt: { gte: weekAgo }, positionId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { positionId: "desc" } },
        take: 3,
      }),
    ]);
    const topIds = byPosition.map((row) => row.positionId).filter((id): id is string => Boolean(id));
    const topPositions = topIds.length
      ? await db.position.findMany({ where: { id: { in: topIds } }, select: { id: true, title: true } })
      : [];
    const topLines = byPosition.map((row) => {
      const pos = topPositions.find((p) => p.id === row.positionId);
      return `   ${pos?.title ?? "-"}: ${row._count._all} lamaran`;
    });

    const testimonials = siteField<string[]>(site, "telegramTestimonials", []).slice(-3);
    const lines: string[] = [
      "Rekap Mingguan Lumina Studio",
      `Periode 7 hari terakhir (${week})`,
      "",
      `Lamaran masuk: ${newWeek}`,
      `Wawancara selesai: ${interviewedWeek}`,
      `Diterima: ${acceptedWeek} | Ditolak: ${rejectedWeek}`,
    ];
    if (topLines.length > 0) {
      lines.push("", "Posisi terpopuler minggu ini:");
      lines.push(...topLines);
    }
    if (testimonials.length > 0) {
      lines.push("", "Testimoni kandidat:");
      for (const t of testimonials) lines.push(`   "${t.slice(0, 140)}"`);
    }

    const buttons: TelegramButton[][] = [
      [
        { text: "Laporan", callback_data: "cb:laporan" },
        { text: "Ringkasan", callback_data: "cb:ringkasan" },
      ],
    ];
    const sent = await sendToAdminChats(settings, "digestWeekly", lines.join("\n"), buttons);
    if (sent > 0 || force) {
      site.telegramLastDigestWeekly = week;
      await writeSiteObj(site);
      await db.activityLog
        .create({
          data: {
            applicationId: null,
            actor: "Sistem",
            action: "TELEGRAM_DIGEST_WEEKLY",
            detail: `Rekap mingguan dikirim ke ${sent} chat Telegram`,
          },
        })
        .catch(() => undefined);
    }
    return { sent };
  } catch {
    return { sent: 0, reason: "error" };
  }
}

/** Ekspor CSV terjadwal (Senin >= 09.00 WIB) sebagai dokumen ke chat admin. */
export async function runTelegramScheduledExport(force = false): Promise<{ sent: number; reason?: string }> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return { sent: 0, reason: "no-token" };
    if (!settings.telegramAlerts.exportScheduled) return { sent: 0, reason: "toggle-off" };
    const dayBangkok = String(new Date().toLocaleDateString("en-US", { timeZone: "Asia/Bangkok", weekday: "short" }));
    if (!force && dayBangkok !== "Mon") return { sent: 0, reason: "not-monday" };
    if (!force && bangkokHourNow() < EXPORT_HOUR_BANGKOK) return { sent: 0, reason: "not-time" };

    const site = await readSiteObj();
    const week = weekKeyBangkok();
    if (!force && siteField<string>(site, "telegramLastExport", "") === week) {
      return { sent: 0, reason: "already" };
    }

    const chats = activeChats(settings);
    if (chats.length === 0) return { sent: 0, reason: "no-chat" };
    const { csv, rows } = await buildApplicationCsv();
    const buffer = Buffer.from(csv, "utf8");
    let sent = 0;
    for (const chat of chats) {
      const ok = await tgSendDocument(
        settings.telegramBotToken,
        chat,
        buffer,
        `lamaran-lumina-${week}.csv`,
        `Ekspor mingguan lamaran (${rows} baris)`,
      );
      if (ok) sent += 1;
    }
    if (sent > 0 || force) {
      site.telegramLastExport = week;
      await writeSiteObj(site);
    }
    return { sent };
  } catch {
    return { sent: 0, reason: "error" };
  }
}

/**
 * Broadcast lowongan baru ke chat pelanggan (site.telegramSubs.jobs — chat publik,
 * bukan chat admin). Idempoten via site.telegramJobAnnounced (daftar id posisi
 * yang sudah diumumkan) sehingga posisi lama tidak diulang.
 */
export async function runTelegramJobBroadcast(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    const site = await readSiteObj();
    const subs = siteField<{ jobs?: string[] }>(site, "telegramSubs", {});
    const jobChats = Array.isArray(subs.jobs) ? subs.jobs : [];
    const announced = siteField<string[]>(site, "telegramJobAnnounced", []);

    const positions = await db.position.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, title: true, slug: true, department: true, location: true, workMode: true, salaryText: true },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    const fresh = positions.filter((p) => !announced.includes(p.id)).slice(0, 5);
    if (fresh.length === 0) return 0;

    announced.push(...fresh.map((p) => p.id));
    if (announced.length > 200) announced.splice(0, announced.length - 200); // jaga ukuran
    site.telegramJobAnnounced = announced;
    await writeSiteObj(site);

    if (jobChats.length === 0) return 0;
    let sent = 0;
    for (const p of fresh) {
      const text = [
        "Lowongan Baru di Lumina Studio",
        "",
        p.title,
        `${p.department ?? "-"} | ${p.location ?? "-"} | ${p.workMode ?? "-"}`,
        p.salaryText ? `Gaji: ${p.salaryText}` : "",
        "",
        "Buka detail untuk melamar:",
      ]
        .filter(Boolean)
        .join("\n");
      for (const chat of jobChats) {
        const ok = await tgSendMessage(settings.telegramBotToken, chat, text, {
          buttons: [[
            { text: "Lihat & Lamar", url: `${getSiteUrl()}/?posisi=${encodeURIComponent(p.slug ?? "")}` },
            { text: "Berhenti Langganan", callback_data: "jobs:off" },
          ]],
        });
        if (ok) sent += 1;
      }
    }
    return sent;
  } catch {
    return 0;
  }
}

/**
 * Watch perubahan tahap untuk langganan kandidat (idea 17): aplikasi dengan
 * stageUpdatedAt lebih baru dari watermark dikirim ke chat yang berlangganan
 * kode pelacakannya (site.telegramSubs.track = {trackingCode: chatId[]}).
 */
export async function runTelegramStageWatch(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    const site = await readSiteObj();
    const subs = siteField<{ track?: Record<string, string[]> }>(site, "telegramSubs", {});
    const track = subs.track && typeof subs.track === "object" ? subs.track : {};
    const watchedCodes = Object.keys(track).filter((code) => Array.isArray(track[code]) && track[code].length > 0);
    if (watchedCodes.length === 0) {
      site.telegramStageWatchSince = new Date().toISOString();
      await writeSiteObj(site);
      return 0;
    }

    const watermarkRaw = siteField<string>(site, "telegramStageWatchSince", "");
    const watermark = watermarkRaw ? new Date(watermarkRaw) : new Date(Date.now() - 3600_000);
    const nowIso = new Date().toISOString();

    const apps = await db.application.findMany({
      where: { deletedAt: null, stageUpdatedAt: { gt: watermark }, trackingCode: { in: watchedCodes } },
      include: { position: { select: { title: true } } },
      take: 20,
      orderBy: { stageUpdatedAt: "asc" },
    });
    if (apps.length === 0) {
      site.telegramStageWatchSince = nowIso;
      await writeSiteObj(site);
      return 0;
    }

    let sent = 0;
    for (const app of apps) {
      const code = (app.trackingCode ?? "").toUpperCase();
      const chats = (track[code] ?? []).slice(0, 10);
      if (chats.length === 0) continue;
      const final = app.status === "REJECTED" || app.status === "ACCEPTED";
      const text = [
        "Pembaruan Lamaran Lumina Studio",
        "",
        `${app.name} — ${app.position?.title ?? "-"}`,
        `Kode: ${code}`,
        `Tahap baru: ${stageLabel(app.status)}`,
        app.status === "INTERVIEW" && app.interviewAt ? `Wawancara: ${fmtDT(app.interviewAt)}` : "",
        "",
        final
          ? "Lamaran sudah memasuki tahap akhir. Terima kasih sudah mengikuti prosesnya."
          : "Buka halaman status untuk detail langkah berikutnya.",
      ]
        .filter(Boolean)
        .join("\n");
      const buttons: TelegramButton[][] = [
        [{ text: "Cek Status", url: `${getSiteUrl()}/#status` }],
      ];
      if (!final) {
        buttons.push([{ text: "Berhenti Notifikasi", callback_data: `subs:${code}:off` }]);
      }
      for (const chat of chats) {
        const ok = await tgSendMessage(settings.telegramBotToken, chat, text, { buttons });
        if (ok) sent += 1;
      }
    }
    site.telegramStageWatchSince = nowIso;
    await writeSiteObj(site);
    return sent;
  } catch {
    return 0;
  }
}

/**
 * Watch aktivitas pelamar (idea 4): ActivityLog baru dengan aksi berasal dari
 * alur publik (slot, konfirmasi, reschedule, offer, withdraw) dikirim sebagai
 * kartu ke chat admin. Watermark site.telegramActivityWatchSince.
 */
export async function runTelegramActivityWatch(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    if (!settings.telegramAlerts.candidateActivity) return 0;
    const chats = activeChats(settings);
    if (chats.length === 0) return 0;

    const site = await readSiteObj();
    const watermarkRaw = siteField<string>(site, "telegramActivityWatchSince", "");
    const watermark = watermarkRaw ? new Date(watermarkRaw) : new Date(Date.now() - 3600_000);
    const nowIso = new Date().toISOString();

    const CANDIDATE_ACTIONS = [
      "INTERVIEW_CONFIRMED",
      "INTERVIEW_CANCELLED",
      "INTERVIEW_RESCHEDULE",
      "INTERVIEW_RESCHEDULED",
      "OFFER_ACCEPTED",
      "OFFER_DECLINED",
      "WITHDRAW",
      "SLOT_BOOKED",
    ];
    const logs = await db.activityLog.findMany({
      where: { createdAt: { gt: watermark }, action: { in: CANDIDATE_ACTIONS } },
      include: { application: { select: { id: true, name: true, trackingCode: true } } },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    if (logs.length === 0) {
      site.telegramActivityWatchSince = nowIso;
      await writeSiteObj(site);
      return 0;
    }

    let sent = 0;
    for (const log of logs) {
      const app = log.application;
      const text = [
        "Aktivitas Pelamar",
        "",
        log.detail || log.action,
        app ? `Kandidat: ${app.name} (${app.trackingCode ?? "-"})` : "",
        `Waktu: ${fmtDT(log.createdAt)}`,
      ]
        .filter(Boolean)
        .join("\n");
      const buttons: TelegramButton[][] = app
        ? [[{ text: "Lihat Kandidat", callback_data: `app:${app.id}:card` }]]
        : undefined;
      for (const chat of chats) {
        const ok = await tgSendMessage(settings.telegramBotToken, chat, text, { buttons });
        if (ok) sent += 1;
      }
    }
    site.telegramActivityWatchSince = nowIso;
    await writeSiteObj(site);
    return sent;
  } catch {
    return 0;
  }
}

/* ==================== Reminder kandidat via langganan (NR-15) ==================== */

// Pengingat KANDIDAT dikirim ke chat pribadi yang berlangganan kode lamaran
// (site.telegramSubs.track = {kode: chatId[]}) — jalur publik, berbeda dari
// reminder admin (Interview.reminderDaySent/HourSent milik alur admin).
// Tidak ada callback data khusus status — tombol memakai URL halaman #status.

type CandidateReminderFlags = { day?: boolean; hour?: boolean };

/** Batas entri dedupe pengingat kandidat agar blob Setting tidak membesar tanpa batas. */
const CANDIDATE_REMINDER_CAP = 200;

/**
 * Pengingat wawancara untuk kandidat pelanggan (NR-15, idea 7): sesi
 * SCHEDULED/CONFIRMED pada jendela H-2 hari (46-50 jam) atau H-2 jam (1,5-2,5 jam)
 * dikirim ke chat yang berlangganan kode lamaran terkait. Dedupe per sesi per
 * jendela via site.telegramCandReminderSent ({interviewId: {day, hour}}).
 */
export async function runTelegramCandidateInterviewReminders(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    const site = await readSiteObj();
    const subs = siteField<{ track?: Record<string, string[]> }>(site, "telegramSubs", {});
    const track = subs.track && typeof subs.track === "object" ? subs.track : {};
    if (Object.keys(track).length === 0) return 0;

    const now = Date.now();
    const windows = [
      { kind: "day" as const, from: now + 46 * 3600_000, to: now + 50 * 3600_000, label: "H-2 hari" },
      { kind: "hour" as const, from: now + 1.5 * 3600_000, to: now + 2.5 * 3600_000, label: "H-2 jam" },
    ];

    const sentMap = siteField<Record<string, CandidateReminderFlags>>(site, "telegramCandReminderSent", {});
    let changed = false;
    let sent = 0;
    const activeIds = new Set<string>();

    for (const win of windows) {
      const interviews = await db.interview.findMany({
        where: {
          status: { in: ["SCHEDULED", "CONFIRMED"] },
          scheduledAt: { gte: new Date(win.from), lte: new Date(win.to) },
        },
        include: {
          application: {
            select: {
              id: true,
              name: true,
              trackingCode: true,
              position: { select: { title: true, address: true } },
            },
          },
        },
      });
      for (const iv of interviews) {
        activeIds.add(iv.id);
        const flags = sentMap[iv.id] ?? {};
        if (flags[win.kind]) continue;
        const code = (iv.application.trackingCode ?? "").toUpperCase();
        const chats = (track[code] ?? []).slice(0, 10);
        if (chats.length === 0) continue;
        // Tandai lebih dulu (pola sama dengan reminder admin) agar chat yang
        // memblokir bot tidak memicu kirim ulang tiap menit.
        sentMap[iv.id] = { ...flags, [win.kind]: true };
        changed = true;
        const platformLabel =
          iv.mode === "ONSITE"
            ? `di lokasi (${iv.address ?? iv.application.position?.address ?? "-"})`
            : `via ${iv.platform.replaceAll("_", " ").toLowerCase()}`;
        const text = [
          `Halo ${iv.application.name}, pengingat wawancara kamu untuk posisi ${iv.application.position?.title ?? "-"}.`,
          "",
          `Ronde ${iv.round} — ${win.label}`,
          `Waktu: ${fmtDT(iv.scheduledAt)} (durasi ±${iv.durationMin} menit)`,
          `Tempat: ${platformLabel}`,
          iv.meetingLink ? `Tautan: ${iv.meetingLink}` : "",
          "",
          "Jangan lupa konfirmasi kehadiranmu di halaman status lamaran, ya!",
        ]
          .filter(Boolean)
          .join("\n");
        const buttons: TelegramButton[][] = [
          [{ text: "Buka Status Lamaran", url: `${getSiteUrl()}/#status` }],
        ];
        for (const chat of chats) {
          const ok = await tgSendMessage(settings.telegramBotToken, chat, text, { buttons });
          if (ok) sent += 1;
        }
      }
    }

    // Bersihkan entri sesi yang sudah lewat/dibatalkan + cap jumlah entri.
    for (const id of Object.keys(sentMap)) {
      if (!activeIds.has(id)) {
        delete sentMap[id];
        changed = true;
      }
    }
    let entries = Object.entries(sentMap);
    if (entries.length > CANDIDATE_REMINDER_CAP) {
      entries = entries.slice(entries.length - CANDIDATE_REMINDER_CAP);
      site.telegramCandReminderSent = Object.fromEntries(entries);
      changed = true;
    }
    if (changed) {
      site.telegramCandReminderSent = sentMap;
      await writeSiteObj(site);
    }
    return sent;
  } catch {
    return 0;
  }
}

/**
 * Pengingat penawaran untuk kandidat pelanggan (NR-15, idea 7): offer PENDING
 * dengan batas jawaban dalam 24 jam ke depan dikirim ke chat yang berlangganan
 * kode lamaran. Dedupe per lamaran via site.telegramOfferRemindSent ({appId: iso}).
 */
export async function runTelegramCandidateOfferReminders(): Promise<number> {
  try {
    const settings = await getAutomationSettings();
    if (!settings.telegramBotToken) return 0;
    const site = await readSiteObj();
    const subs = siteField<{ track?: Record<string, string[]> }>(site, "telegramSubs", {});
    const track = subs.track && typeof subs.track === "object" ? subs.track : {};
    const watchedCodes = Object.keys(track).filter(
      (code) => Array.isArray(track[code]) && track[code]!.length > 0,
    );
    if (watchedCodes.length === 0) return 0;

    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 3600_000);
    const apps = await db.application.findMany({
      where: {
        offerStatus: "PENDING",
        offerDeadline: { gte: now, lte: in24h },
        deletedAt: null,
        trackingCode: { in: watchedCodes },
      },
      include: { position: { select: { title: true } } },
      take: 50,
      orderBy: { offerDeadline: "asc" },
    });

    const sentMap = siteField<Record<string, string>>(site, "telegramOfferRemindSent", {});
    let changed = false;
    let sent = 0;
    const activeIds = new Set<string>();

    for (const app of apps) {
      activeIds.add(app.id);
      if (sentMap[app.id]) continue;
      const code = (app.trackingCode ?? "").toUpperCase();
      const chats = (track[code] ?? []).slice(0, 10);
      if (chats.length === 0) continue;
      sentMap[app.id] = new Date().toISOString();
      changed = true;
      const deadlineLabel = app.offerDeadline
        ? app.offerDeadline.toLocaleDateString("id-ID", { dateStyle: "long" })
        : "-";
      const text = [
        `Pengingat: penawaran untuk posisi ${app.position?.title ?? "-"} menunggu jawabanmu sampai ${deadlineLabel}.`,
        "",
        "Buka halaman status lamaran untuk menerima atau menolak penawaran ini.",
      ].join("\n");
      const buttons: TelegramButton[][] = [
        [{ text: "Buka Status Lamaran", url: `${getSiteUrl()}/#status` }],
      ];
      for (const chat of chats) {
        const ok = await tgSendMessage(settings.telegramBotToken, chat, text, { buttons });
        if (ok) sent += 1;
      }
    }

    // Bersihkan entri lamaran yang tidak lagi dalam jendela 24 jam + cap entri.
    for (const id of Object.keys(sentMap)) {
      if (!activeIds.has(id)) {
        delete sentMap[id];
        changed = true;
      }
    }
    let offerEntries = Object.entries(sentMap);
    if (offerEntries.length > CANDIDATE_REMINDER_CAP) {
      offerEntries = offerEntries.slice(offerEntries.length - CANDIDATE_REMINDER_CAP);
      site.telegramOfferRemindSent = Object.fromEntries(offerEntries);
      changed = true;
    }
    if (changed) {
      site.telegramOfferRemindSent = sentMap;
      await writeSiteObj(site);
    }
    return sent;
  } catch {
    return 0;
  }
}

/* ========================= Interaksi lanjutan NR-14 ========================= */

// Urutan tahap pipeline untuk tombol "Pindah Tahap".
const PIPELINE_STAGES = ["NEW", "REVIEWED", "INTERVIEW", "OFFER", "ACCEPTED", "REJECTED"] as const;
// Tipe pekerjaan untuk wizard offer.
const OFFER_TYPES = ["Full-time", "Part-time", "Kontrak", "Magang"] as const;

function isTelegramAdminChat(settings: Awaited<ReturnType<typeof getAutomationSettings>>, chatId: number | string): boolean {
  return settings.telegramAllowedChats.includes(String(chatId));
}

/** Menu pindah tahap kandidat (dropdown inline). */
async function renderStageMenu(applicationId: string): Promise<BotReply> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { name: true, trackingCode: true, status: true, position: { select: { title: true } } },
  });
  if (!app) return { text: "Lamaran tidak ditemukan.", buttons: [] };
  const lines = [
    "Pindah Tahap Kandidat",
    "",
    `${app.name} (${app.trackingCode ?? "-"})`,
    `Posisi: ${app.position?.title ?? "-"}`,
    `Tahap sekarang: ${stageLabel(app.status)}`,
    "",
    "Pilih tahap tujuan:",
  ];
  const buttons: TelegramButton[][] = PIPELINE_STAGES
    .map((stage, index) => [
      {
        text: `${stageLabel(stage)}${stage === app.status ? " (sekarang)" : ""}`,
        callback_data: `app:${app.id}:stage:${index}`,
      },
    ])
    .filter((row, index) => PIPELINE_STAGES[index] !== app.status);
  buttons.push([{ text: "Kembali", callback_data: `app:${app.id}:card` }]);
  return { text: lines.join("\n"), buttons };
}

/** Isi kartu /setelan — toggle mode tulis, jam tenang, dan alert per jenis. */
async function buildSetelanBody(): Promise<BotReply> {
  const settings = await getAutomationSettings();
  const quiet = settings.telegramQuietHours;
  const lines = [
    "Setelan Bot Telegram",
    "",
    `Aksi tulis via bot: ${settings.telegramWriteEnabled ? "AKTIF" : "NONAKTIF"}`,
    `Mode tenang (${quiet.startHour}.00-${quiet.endHour}.00 WIB): ${quiet.enabled ? "AKTIF" : "NONAKTIF"}`,
    "",
    "Alert per jenis (AKTIF/NONAKTIF):",
  ];
  for (const key of TELEGRAM_ALERT_KEYS) {
    lines.push(`- ${TELEGRAM_ALERT_LABELS[key]}: ${settings.telegramAlerts[key] ? "AKTIF" : "nonaktif"}`);
  }
  const buttons: TelegramButton[][] = [
    [
      { text: settings.telegramWriteEnabled ? "Tulis: Matikan" : "Tulis: Aktifkan", callback_data: "set:write" },
      { text: quiet.enabled ? "Tenang: Matikan" : "Tenang: Aktifkan", callback_data: "set:quiet" },
    ],
  ];
  const alertRows: TelegramButton[] = TELEGRAM_ALERT_KEYS.map((key) => ({
    text: `${settings.telegramAlerts[key] ? "On" : "Off"}: ${TELEGRAM_ALERT_LABELS[key].split(" (")[0]}`.slice(0, 60),
    callback_data: `set:alert:${key}`,
  }));
  // Susun 2 tombol per baris agar ringkas.
  for (let i = 0; i < alertRows.length; i += 2) {
    buttons.push(alertRows.slice(i, i + 2));
  }
  return { text: lines.join("\n"), buttons };
}

async function renderSetelanCard(_token: string, _chatId: number): Promise<string> {
  const reply = await buildSetelanBody();
  const settings = await getAutomationSettings();
  await tgSendMessage(settings.telegramBotToken, _chatId, reply.text, { buttons: reply.buttons });
  return reply.text;
}

/** /whoami — identitas & izin chat saat ini. */
async function handleWhoamiCommand(token: string, chatId: number): Promise<string> {
  const settings = await getAutomationSettings();
  const registered = isTelegramAdminChat(settings, chatId);
  const muted = isChatMuted(settings, String(chatId));
  const lines = [
    "Identitas Chat",
    "",
    `Chat ID: ${chatId}`,
    `Status: ${registered ? "terdaftar (chat admin)" : "belum terhubung"}`,
    registered ? `Aksi tulis: ${settings.telegramWriteEnabled ? "boleh" : "tidak (mode baca)"}` : "Aksi tulis: -",
    registered ? `Mode diam: ${muted ? "aktif (notifikasi ditahan)" : "tidak"}` : "",
    registered ? `Jenis alert aktif: ${TELEGRAM_ALERT_KEYS.filter((k) => settings.telegramAlerts[k]).length}/${TELEGRAM_ALERT_KEYS.length}` : "",
    "",
    registered
      ? "Kamu bisa memakai semua perintah baca + aksi tulis (jika diizinkan)."
      : "Hubungkan chat ini dengan /mulai KODE dari panel admin, atau kirim kode pelacakan (LM-XXXXXX) untuk cek status lamaran.",
  ].filter(Boolean);
  await tgSendMessage(token, chatId, lines.join("\n"));
  return lines.join("\n");
}

/** /health — kesehatan bot: poller, token, chat, jadwal terakhir. */
async function handleHealthCommand(token: string, chatId: number): Promise<string> {
  const settings = await getAutomationSettings();
  const { getPollerStatus } = await import("@/lib/telegram-bridge-status");
  const poller = getPollerStatus();
  const site = await readSiteObj();
  const lines = [
    "Kesehatan Bot",
    "",
    `Poller: ${poller.healthy ? `hidup (terlihat ${poller.secondsAgo ?? "?"} detik lalu)` : "TIDAK TERLIHAT — cek mini-service telegram-bot"}`,
    `Token bot: ${settings.telegramBotToken ? "terpasang" : "kosong"}`,
    `Chat admin terdaftar: ${settings.telegramAllowedChats.length}`,
    `Mode tulis: ${settings.telegramWriteEnabled ? "aktif" : "nonaktif"}`,
    `Mode tenang: ${settings.telegramQuietHours.enabled ? `aktif (${settings.telegramQuietHours.startHour}.00-${settings.telegramQuietHours.endHour}.00 WIB)` : "nonaktif"}`,
    `Digest pagi terakhir: ${siteField<string>(site, "telegramLastDigest", "-")}`,
    `Digest sore terakhir: ${siteField<string>(site, "telegramLastDigestEvening", "-")}`,
    `Rekap mingguan terakhir: ${siteField<string>(site, "telegramLastDigestWeekly", "-")}`,
    `Ekspor terjadwal terakhir: ${siteField<string>(site, "telegramLastExport", "-")}`,
    `Grafik mingguan terakhir: ${siteField<string>(site, "telegramLastChart", "-")}`,
  ];
  await tgSendMessage(token, chatId, lines.join("\n"));
  return lines.join("\n");
}

/** /lowongan — langganan broadcast lowongan baru (chat publik, tanpa pairing). */
async function handleLowonganCommand(token: string, chatId: number): Promise<string> {
  const site = await readSiteObj();
  const subs = siteField<{ jobs?: string[]; track?: Record<string, string[]> }>(site, "telegramSubs", {});
  const jobChats = new Set(Array.isArray(subs.jobs) ? subs.jobs : []);
  const chatKey = String(chatId);
  const already = jobChats.has(chatKey);
  const activeCount = await db.position.count({ where: { isActive: true, deletedAt: null } });
  if (already) {
    const text = [
      "Kamu sudah berlangganan notifikasi lowongan baru.",
      `Saat ini ada ${activeCount} lowongan aktif di Lumina Studio.`,
    ].join("\n");
    await tgSendMessage(token, chatId, text, {
      buttons: [[
        { text: "Berhenti Langganan", callback_data: "jobs:off" },
        { text: "Lihat Lowongan", url: `${getSiteUrl()}/` },
      ]],
    });
    return text;
  }
  jobChats.add(chatKey);
  subs.jobs = [...jobChats];
  site.telegramSubs = subs;
  await writeSiteObj(site);
  const text = [
    "Berhasil berlangganan.",
    `Kamu akan diberi tahu setiap ada lowongan baru (saat ini ${activeCount} lowongan aktif).`,
  ].join("\n");
  await tgSendMessage(token, chatId, text, {
    buttons: [[
      { text: "Berhenti Langganan", callback_data: "jobs:off" },
      { text: "Lihat Lowongan", url: `${getSiteUrl()}/` },
    ]],
  });
  return text;
}

/** /skor KODE 1-5 — set rating kandidat cepat. */
async function handleSkorCommand(token: string, chatId: number, args: string, actorLabel: string): Promise<string> {
  const settings = await getAutomationSettings();
  if (!settings.telegramWriteEnabled) {
    return "Aksi tulis via bot sedang nonaktif di panel admin.";
  }
  const match = args.trim().match(/^(LM-[A-Z0-9]{6})\s+([1-5])$/i);
  if (!match) {
    return "Format: /skor KODE NILAI\nContoh: /skor LM-ABC123 4";
  }
  const code = match[1].toUpperCase();
  const rating = Number(match[2]);
  const app = await db.application.findFirst({ where: { trackingCode: code, deletedAt: null }, select: { id: true, name: true } });
  if (!app) return `Kandidat dengan kode ${code} tidak ditemukan.`;
  await db.application.update({ where: { id: app.id }, data: { rating } });
  await db.activityLog.create({
    data: { applicationId: app.id, actor: `Telegram (${actorLabel})`, action: "RATING", detail: `Rating diatur ke ${rating}/5 via Telegram` },
  }).catch(() => undefined);
  emitRealtime(REALTIME_EVENTS.applications);
  const t = `Rating ${app.name} diatur ke ${rating}/5.`;
  await tgSendMessage(token, chatId, t);
  return t;
}

/** Reply kartu kandidat dengan teks -> catatan internal. */
async function handleReplyNote(token: string, chatId: number, code: string, note: string, actorLabel: string, writeEnabled: boolean): Promise<string> {
  if (!writeEnabled) {
    return "Aksi tulis via bot sedang nonaktif di panel admin.";
  }
  const app = await db.application.findFirst({ where: { trackingCode: code, deletedAt: null }, select: { id: true, name: true, adminNotes: true } });
  if (!app) return `Kandidat dengan kode ${code} tidak ditemukan.`;
  const stamp = `[${new Date().toLocaleDateString("id-ID", { timeZone: "Asia/Bangkok", dateStyle: "short" })} · Telegram] `;
  const merged = `${app.adminNotes ? `${app.adminNotes}\n` : ""}${stamp}${note.slice(0, 500)}`;
  await db.application.update({ where: { id: app.id }, data: { adminNotes: merged.slice(0, 4000) } });
  await db.activityLog.create({
    data: { applicationId: app.id, actor: `Telegram (${actorLabel})`, action: "NOTE", detail: "Catatan ditambahkan via balasan pesan Telegram" },
  }).catch(() => undefined);
  emitRealtime(REALTIME_EVENTS.applications);
  const t = `Catatan untuk ${app.name} tersimpan.`;
  await tgSendMessage(token, chatId, t);
  return t;
}

/** Kode pelacakan polos dari siapa pun -> kartu status publik + langganan tahap. */
async function handleBareTrackingCode(token: string, chatId: number, code: string): Promise<string> {
  const app = await db.application.findFirst({
    where: { trackingCode: code, deletedAt: null },
    include: { position: { select: { title: true } } },
  });
  if (!app) {
    const t = `Kode ${code} tidak ditemukan. Periksa lagi atau hubungi tim rekrutmen.`;
    await tgSendMessage(token, chatId, t);
    return t;
  }
  const site = await readSiteObj();
  const subs = siteField<{ jobs?: string[]; track?: Record<string, string[]> }>(site, "telegramSubs", {});
  const track = subs.track && typeof subs.track === "object" ? subs.track : {};
  const subscribed = Array.isArray(track[code]) && track[code].includes(String(chatId));
  const lines = [
    "Status Lamaran",
    "",
    `${app.name} — ${app.position?.title ?? "-"}`,
    `Kode: ${code}`,
    `Tahap: ${stageLabel(app.status)}`,
    `Masuk: ${fmtDT(app.createdAt)}`,
    "",
    "Tekan tombol di bawah untuk notifikasi otomatis tiap tahap berubah.",
  ];
  const buttons: TelegramButton[][] = [
    [{ text: subscribed ? "Notifikasi: Matikan" : "Beritahu Saya", callback_data: `subs:${code}:${subscribed ? "off" : "on"}` }],
    [{ text: "Cek Status Lengkap", url: `${getSiteUrl()}/#status` }],
  ];
  await tgSendMessage(token, chatId, lines.join("\n"), { buttons });
  return lines.join("\n");
}

/* ------------------------------- Wizard offer ------------------------------- */

async function readWizardMap(): Promise<Record<string, OfferWizardState>> {
  const site = await readSiteObj();
  return siteField<Record<string, OfferWizardState>>(site, "telegramWizard", {});
}

async function saveWizardMap(map: Record<string, OfferWizardState>): Promise<void> {
  const site = await readSiteObj();
  site.telegramWizard = map;
  await writeSiteObj(site);
}

async function getOfferWizard(chatId: number): Promise<OfferWizardState | null> {
  const map = await readWizardMap();
  return map[String(chatId)] ?? null;
}

async function setOfferWizard(chatId: number, state: OfferWizardState | null): Promise<void> {
  const map = await readWizardMap();
  if (state) map[String(chatId)] = state;
  else delete map[String(chatId)];
  await saveWizardMap(map);
}

async function clearOfferWizard(chatId: number): Promise<void> {
  await setOfferWizard(chatId, null);
}

/** /offer KODE — mulai wizard pengiriman offer. */
async function handleOfferCommand(token: string, chatId: number, args: string): Promise<string> {
  const settings = await getAutomationSettings();
  if (!settings.telegramWriteEnabled) {
    return "Aksi tulis via bot sedang nonaktif di panel admin.";
  }
  const code = args.trim().toUpperCase().match(/^LM-[A-Z0-9]{6}$/)?.[0];
  if (!code) {
    return "Format: /offer KODE\nContoh: /offer LM-ABC123 — lalu jawab langkah wizard di chat ini.";
  }
  const app = await db.application.findFirst({
    where: { trackingCode: code, deletedAt: null },
    include: { position: { select: { title: true } } },
  });
  if (!app) return `Kandidat dengan kode ${code} tidak ditemukan.`;
  if (app.status === "REJECTED") return "Lamaran sudah ditolak — tidak bisa menerima offer.";
  if (app.offerStatus === "PENDING") return "Offer masih menunggu jawaban pelamar.";
  if (app.offerStatus === "ACCEPTED") return "Offer sudah diterima pelamar.";

  const state: OfferWizardState = { appId: app.id, step: "salary" };
  await setOfferWizard(chatId, state);
  const lines = [
    "Wizard Offer — Langkah 1/3",
    "",
    `${app.name} — ${app.position?.title ?? "-"}`,
    "",
    "Ketik nominal gaji (mis. Rp 6.500.000) atau \"lewati\".",
  ];
  await tgSendMessage(token, chatId, lines.join("\n"), { buttons: [[{ text: "Lewati Gaji", callback_data: "wiz:cancel" }]] });
  return lines.join("\n");
}

/** Terapkan jawaban wizard dari tombol (tipe) dan lanjut ke langkah berikutnya. */
async function advanceOfferWizard(chatId: number, patch: Partial<OfferWizardState>): Promise<BotReply> {
  const state = await getOfferWizard(chatId);
  if (!state) return { text: "Wizard tidak aktif. Mulai dengan /offer KODE.", buttons: [] };
  const merged: OfferWizardState = { ...state, ...patch };
  if (patch.type !== undefined && merged.step === "type") {
    merged.step = "start";
    await setOfferWizard(chatId, merged);
    return renderOfferStep(chatId, merged);
  }
  const reply = await renderOfferStep(chatId, merged);
  await setOfferWizard(chatId, merged);
  return reply;
}

// Catatan: renderOfferStep mengembalikan teks + tombol sesuai state.
async function renderOfferStep(chatId: number, state: OfferWizardState): Promise<BotReply> {
  void chatId;
  const app = await db.application.findUnique({
    where: { id: state.appId },
    select: { name: true, position: { select: { title: true } } },
  });
  const head = app ? `${app.name} — ${app.position?.title ?? "-"}` : "Kandidat";
  if (state.step === "salary") {
    return {
      text: ["Wizard Offer — Langkah 1/3", "", head, "", "Ketik nominal gaji (mis. Rp 6.500.000) atau \"lewati\"."].join("\n"),
      buttons: [],
    };
  }
  if (state.step === "type") {
    return {
      text: ["Wizard Offer — Langkah 2/3", "", head, state.salary ? `Gaji: ${state.salary}` : "Gaji: (tidak diisi)", "", "Pilih tipe pekerjaan:"].join("\n"),
      buttons: OFFER_TYPES.map((type, index) => [{ text: type, callback_data: `wiz:type:${index}` }]),
    };
  }
  // step "start"
  return {
    text: [
      "Wizard Offer — Langkah 3/3",
      "",
      head,
      state.salary ? `Gaji: ${state.salary}` : "Gaji: (tidak diisi)",
      `Tipe: ${state.type ?? "Full-time"}`,
      "",
      "Ketik tanggal mulai (mis. 2026-11-01) atau \"lewati\".",
    ].join("\n"),
    buttons: [],
  };
}

/** Jawaban teks wizard (gaji / tanggal mulai) — true bila teks dikonsumsi wizard. */
async function handleWizardText(token: string, chatId: number, text: string, replies: string[]): Promise<boolean> {
  const state = await getOfferWizard(chatId);
  if (!state) return false;
  const value = text.trim();
  if (value.startsWith("/")) {
    await clearOfferWizard(chatId);
    await tgSendMessage(token, chatId, "Wizard offer dibatalkan (perintah baru terdeteksi).");
    replies.push("Wizard offer dibatalkan.");
    return true;
  }
  if (state.step === "salary") {
    const salary = value.toLowerCase() === "lewati" ? undefined : value.slice(0, 120);
    const next: OfferWizardState = { ...state, salary, step: "type" };
    await setOfferWizard(chatId, next);
    const reply = await renderOfferStep(chatId, next);
    await tgSendMessage(token, chatId, reply.text, { buttons: reply.buttons });
    replies.push(reply.text);
    return true;
  }
  if (state.step === "start") {
    let startDate: string | undefined;
    if (value.toLowerCase() !== "lewati") {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        await tgSendMessage(token, chatId, "Tanggal tidak dikenali. Ketik format YYYY-MM-DD atau \"lewati\".");
        replies.push("Tanggal tidak valid.");
        return true;
      }
      startDate = parsed.toISOString().slice(0, 10);
    }
    const next: OfferWizardState = { ...state, start: startDate, step: "confirm" };
    await setOfferWizard(chatId, next);
    const app = await db.application.findUnique({
      where: { id: next.appId },
      select: { name: true, position: { select: { title: true } } },
    });
    const preview = [
      "Ringkasan Offer",
      "",
      `${app?.name ?? "-"} — ${app?.position?.title ?? "-"}`,
      `Gaji: ${next.salary ?? "(tidak diisi)"}`,
      `Tipe: ${next.type ?? "Full-time"}`,
      `Mulai: ${next.start ?? "(sesuai kesepakatan)"}`,
      "Batas jawaban: 3 hari sejak dikirim",
    ].join("\n");
    await tgSendMessage(token, chatId, preview, {
      buttons: [[
        { text: "Kirim Offer", callback_data: "wiz:send" },
        { text: "Batalkan", callback_data: "wiz:cancel" },
      ]],
    });
    replies.push(preview);
    return true;
  }
  // step "type" atau "confirm" menunggu tombol, bukan teks.
  return false;
}

/** wiz:send — eksekusi pengiriman offer (cermin POST /api/admin/applications/[id]/offer). */
async function sendOfferFromBot(chatId: number, actorLabel: string): Promise<string> {
  const state = await getOfferWizard(chatId);
  if (!state || state.step !== "confirm") {
    return "Wizard tidak dalam tahap konfirmasi. Mulai lagi dengan /offer KODE.";
  }
  const existing = await db.application.findUnique({
    where: { id: state.appId },
    select: { name: true, status: true, offerStatus: true, position: { select: { title: true, offerTemplate: true } } },
  });
  if (!existing) return "Kandidat tidak ditemukan.";
  if (existing.status === "REJECTED") return "Lamaran sudah ditolak — tidak bisa menerima offer.";
  if (existing.offerStatus === "PENDING" || existing.offerStatus === "ACCEPTED") {
    return "Offer sudah ada dan menunggu / sudah diterima.";
  }
  const salary = state.salary && state.salary.trim() ? state.salary.trim().slice(0, 120) : null;
  const type = state.type ?? "Full-time";
  const startDate = state.start ? new Date(state.start) : null;
  const deadline = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await db.application.update({
    where: { id: state.appId },
    data: {
      offerStatus: "PENDING",
      offerSalary: salary,
      offerType: type,
      offerStartDate: startDate,
      offerDeadline: deadline,
      offerSentAt: new Date(),
      offerRespondedAt: null,
      offerDeclineReason: null,
    },
  });
  await db.activityLog.create({
    data: {
      applicationId: state.appId,
      actor: actorLabel,
      action: "OFFER_SENT",
      detail: `Penawaran dikirim via Telegram (${type}${salary ? `, ${salary}` : ""}) — jawaban sebelum ${fmtDT(deadline)}`,
    },
  }).catch(() => undefined);
  emitRealtime(REALTIME_EVENTS.applications);
  await clearOfferWizard(chatId);
  return [
    "Offer terkirim.",
    "",
    `${existing.name} — ${existing.position?.title ?? "-"}`,
    `Tipe: ${type}${salary ? ` | ${salary}` : ""}`,
    `Batas jawaban: ${fmtDT(deadline)}`,
    "",
    "Pelamar menjawab dari halaman status lamarannya.",
  ].join("\n");
}

/* ------------------------------- AI draft & compare ------------------------------- */

/** /draft KODE — buat draft balasan AI untuk kandidat. */
async function handleDraftCommand(token: string, chatId: number, args: string): Promise<string> {
  const settings = await getAutomationSettings();
  if (!settings.telegramWriteEnabled) {
    return "Aksi tulis via bot sedang nonaktif di panel admin.";
  }
  const code = args.trim().toUpperCase().match(/^(?:LM-)?([A-Z0-9]{6})$/)?.[0];
  if (!code) {
    return "Format: /draft KODE\nContoh: /draft LM-ABC123";
  }
  const app = await db.application.findFirst({ where: { trackingCode: `LM-${code.replace(/^LM-/, "")}`, deletedAt: null }, select: { id: true } });
  if (!app) return "Kandidat tidak ditemukan.";
  const thinking = await tgSendMessageTracked(token, chatId, "Menyusun draft balasan AI...");
  const draft = await generateReplyDraft(app.id);
  if (!draft) {
    const t = "Gagal menyusun draft. Pastikan kandidat punya data cukup, lalu coba lagi.";
    if (typeof thinking.message_id === "number") await tgEditMessage(token, chatId, thinking.message_id, t);
    else await tgSendMessage(token, chatId, t);
    return t;
  }
  const site = await readSiteObj();
  const drafts = siteField<Record<string, { text: string; createdAt: string }>>(site, "telegramDrafts", {});
  drafts[app.id] = { text: draft, createdAt: new Date().toISOString() };
  site.telegramDrafts = drafts;
  await writeSiteObj(site);
  const text = `Draft Balasan AI\n\n${draft}`;
  const buttons: TelegramButton[][] = [[
    { text: "Kirim via Email", callback_data: `draft:${app.id}:send` },
    { text: "Buang", callback_data: `draft:${app.id}:ok` },
  ]];
  if (typeof thinking.message_id === "number") await tgEditMessage(token, chatId, thinking.message_id, text, { buttons });
  else await tgSendMessage(token, chatId, text, { buttons });
  return text;
}

/** /bandingkan KODE1 KODE2 [KODE3] — perbandingan kandidat dengan AI. */
async function handleBandingkanCommand(token: string, chatId: number, args: string): Promise<string> {
  const codes = (args.toUpperCase().match(/LM-[A-Z0-9]{6}/g) ?? []).slice(0, 3);
  if (codes.length < 2) {
    return "Format: /bandingkan KODE1 KODE2 [KODE3]\nContoh: /bandingkan LM-ABC123 LM-DEF456";
  }
  const apps = await db.application.findMany({
    where: { trackingCode: { in: codes }, deletedAt: null },
    include: { position: { select: { title: true } } },
  });
  if (apps.length < 2) return "Minimal dua kandidat ditemukan. Periksa kembali kodenya.";

  const thinking = await tgSendMessageTracked(token, chatId, "Membandingkan kandidat...");
  const profiles = apps.map((app) => ({
    kode: app.trackingCode,
    nama: app.name,
    posisi: app.position?.title ?? "-",
    tahap: stageLabel(app.status),
    skor_ai: app.aiScore ?? null,
    rekomendasi_ai: app.aiRecommendation ?? null,
    rating_admin: app.rating > 0 ? `${app.rating}/5` : null,
    ringkasan_ai: app.aiSummary?.slice(0, 400) ?? null,
  }));
  let analysis = "";
  try {
    const completion = (await withZaiRetry(async (zai) =>
      zai.chat.completions.create({
        messages: [
          {
            role: "assistant",
            content:
              "Kamu panel rekrutmen Lumina Studio. Bandingkan kandidat berdasarkan data JSON berikut. " +
              "Jawab bahasa Indonesia, maksimal 700 karakter, tanpa emoji. Struktur: (1) satu baris rekomendasi " +
              "kandidat terkuat + alasan utama, (2) poin kekuatan tiap kandidat, (3) risiko/kelemahan singkat. " +
              "Netral dan berbasis data saja.\n\n" +
              `Data:\n${JSON.stringify(profiles, null, 1)}`,
          },
        ],
        thinking: { type: "disabled" },
      }),
    )) as { choices?: { message?: { content?: string } }[] } | null;
    analysis = (completion?.choices?.[0]?.message?.content ?? "").trim();
  } catch {
    analysis = "";
  }
  const table = profiles
    .map((p) => `${p.kode} | ${p.nama} | ${p.posisi} | ${p.tahap} | AI ${p.skor_ai ?? "-"} | Rating ${p.rating_admin ?? "-"}`)
    .join("\n");
  const text = analysis
    ? `Perbandingan Kandidat\n\n${table}\n\n${analysis}`
    : `Perbandingan Kandidat\n\n${table}\n\nAnalisis AI tidak tersedia saat ini — ini data ringkasnya.`;
  if (typeof thinking.message_id === "number") await tgEditMessage(token, chatId, thinking.message_id, text);
  else await tgSendMessage(token, chatId, text);
  return text;
}
