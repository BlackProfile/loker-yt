// Bot Telegram dua arah untuk admin Lumina Studio — SERVER-ONLY.
// Menerima update dari mini-service poller (mini-services/telegram-bot) via
// POST /api/telegram/update, lalu memproses perintah & callback di sini
// (semua akses DB tetap milik aplikasi Next.js — poller tidak menyentuh DB).
//
// Perintah baca:  /ringkasan /posisi /kandidat /jadwal /laporan /bantuan
// Aksi tulis:     tombol inline pada kartu kandidat & notifikasi lamaran baru
//                 (Tandai Ditinjau / Ajak Wawancara / Tolak — Tolak wajib konfirmasi).
// Keamanan:       hanya chat di whitelist (telegramAllowedChats) dilayani; pairing
//                 via kode dari panel admin (/mulai KODE); rate limit per chat;
//                 semua aksi tulis tercatat di ActivityLog dengan aktor "Telegram (...)".
// JANGAN PERNAH me-log token bot.
import { db } from "@/lib/db";
import {
  getAutomationSettings,
  getSiteUrl,
  type TelegramButton,
} from "@/lib/notify";
import { isBuiltInStage, stageLabel } from "@/lib/stages";
import {
  INTERVIEW_PLATFORM_LABELS,
  STATUS_LABELS,
  type ApplicationStatus,
} from "@/lib/types";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { emitWebhook } from "@/lib/webhooks";
import { sendCandidateStatusEmail } from "@/lib/candidate-emails";

const TG_API_TIMEOUT_MS = 10_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 20;
const POSISI_PAGE_SIZE = 6;
const PAIR_SETTING_KEY = "telegramPair";
const DIGEST_HOUR_BANGKOK = 7;

/* ------------------------------- Tipe Telegram ------------------------------- */

type TgChat = { id: number; type: string; title?: string; username?: string; first_name?: string };
type TgFrom = { username?: string; first_name?: string; last_name?: string };
type TgMessage = { message_id: number; chat: TgChat; text?: string; from?: TgFrom };
type TgCallbackQuery = { id: string; data?: string; from?: TgFrom; message?: TgMessage };
export type TelegramUpdate = { update_id: number; message?: TgMessage; callback_query?: TgCallbackQuery };

type SendOptions = { buttons?: TelegramButton[][] };

/* --------------------------------- Util dasar --------------------------------- */

async function tgApi<T = unknown>(token: string, method: string, payload?: Record<string, unknown>): Promise<{ ok: boolean; result?: T; description?: string }> {
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
    return { ok: false, description: error instanceof Error ? error.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

async function tgSendMessage(token: string, chatId: number | string, text: string, opts?: SendOptions): Promise<boolean> {
  const payload: Record<string, unknown> = { chat_id: chatId, text: text.slice(0, 3900), disable_web_page_preview: true };
  if (opts?.buttons && opts.buttons.length > 0) {
    payload.reply_markup = { inline_keyboard: buildKeyboard(opts.buttons) };
  }
  const res = await tgApi(token, "sendMessage", payload);
  return res.ok;
}

function buildKeyboard(rows: TelegramButton[][]): Record<string, unknown>[][] {
  return rows
    .map((row) => {
      const buttons: Record<string, unknown>[] = [];
      for (const btn of row) {
        if (btn.url) {
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
    if (!message?.text?.trim() || !message.chat) return { replies };

    const chatId = message.chat.id;
    const chatKey = String(chatId);
    if (isRateLimited(chatKey)) {
      const sent = await tgSendMessage(token, chatId, "Terlalu banyak perintah. Tunggu sebentar ya.");
      if (sent) replies.push("rate-limit");
      return { replies };
    }

    const allowed = settings.telegramAllowedChats.includes(chatKey);
    if (!allowed) {
      await handleUnregisteredChat(message, token, replies);
      return { replies };
    }

    const text = message.text.trim();
    const parts = text.split(/\s+/);
    const cmd = (parts[0] ?? "").split("@")[0].toLowerCase();
    const args = parts.slice(1).join(" ").trim();

    switch (cmd) {
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
      default: {
        const hint = `Perintah tidak dikenal: ${cmd}\nKirim /bantuan untuk daftar perintah.`;
        await tgSendMessage(token, chatId, hint);
        replies.push(hint);
      }
    }
  } catch (error) {
    console.error("[telegram-bot] handleTelegramUpdate gagal:", error instanceof Error ? error.message : error);
  }
  return { replies };
}

/* ----------------------------- Chat belum terdaftar ----------------------------- */

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

  const reply = [
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

/* --------------------------------- Perintah baca --------------------------------- */

const HELP_HEADER = (writeEnabled: boolean) =>
  [
    "Lumina Studio Bot — asisten rekrutmen admin.",
    "",
    "Perintah:",
    "/ringkasan — ringkasan pipeline hari ini",
    "/posisi — daftar posisi + sisa kuota",
    "/kandidat <kode/nama> — cari kandidat",
    "/jadwal — wawancara 7 hari ke depan",
    "/laporan — funnel + rekap bulanan",
    "/bantuan — daftar perintah ini",
    "",
    writeEnabled
      ? "Aksi tulis via bot: AKTIF (tombol Ajak Wawancara / Tolak tampil pada kartu kandidat)."
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

async function buildKandidatSearch(query: string): Promise<BotReply> {
  const q = query.trim();
  if (!q) {
    return { text: "Kirim: /kandidat KODE atau /kandidat Nama\nContoh: /kandidat LM-ABC123", buttons: [] };
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
  const nextInterview = await db.interview.findFirst({
    where: { applicationId: app.id, status: { in: ["SCHEDULED", "CONFIRMED"] }, scheduledAt: { gte: new Date() } },
    orderBy: { scheduledAt: "asc" },
    select: { round: true, scheduledAt: true },
  });

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

  const settings = await getAutomationSettings();
  const buttons: TelegramButton[][] = [
    [{ text: "Tinjau di Dashboard", url: `${getSiteUrl()}/?kandidat=${encodeURIComponent(app.trackingCode ?? "")}#admin` }],
  ];
  if (settings.telegramWriteEnabled) {
    const row: TelegramButton[] = [];
    if (app.status === "NEW") row.push({ text: "Tandai Ditinjau", callback_data: `app:${app.id}:review` });
    if (app.status === "NEW" || app.status === "REVIEWED") {
      row.push({ text: "Ajak Wawancara", callback_data: `app:${app.id}:interview` });
    }
    if (app.status !== "REJECTED" && app.status !== "ACCEPTED") {
      row.push({ text: "Tolak", callback_data: `app:${app.id}:reject` });
    }
    if (row.length > 0) buttons.push(row);
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
    await tgAnswerCallback(token, callback.id, "Chat tidak terdaftar.");
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
  const appMatch = data.match(/^app:([A-Za-z0-9]+):(card|review|interview|reject|reject:yes|reject:no)$/);
  if (appMatch) {
    const appId = appMatch[1];
    const action = appMatch[2];

    if (action === "card" || action === "reject:no") {
      await tgAnswerCallback(token, callback.id, "Memuat...");
      const reply = await renderKandidatCard(appId);
      await tgEditMessage(token, chatId, messageId, reply.text, { buttons: reply.buttons });
      replies.push(reply.text);
      return;
    }

    if (!writeEnabled) {
      await tgAnswerCallback(token, callback.id, "Aksi tulis via bot sedang nonaktif di panel admin.");
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
        `Tolak kandidat ini?`,
        "",
        `${app.name} (${app.trackingCode ?? "-"})`,
        `Posisi: ${app.position?.title ?? "-"}`,
        "",
        "Tahap akan berubah menjadi Ditolak.",
      ].join("\n");
      await tgEditMessage(token, chatId, messageId, confirmText, {
        buttons: [
          [
            { text: "Ya, Tolak", callback_data: `app:${appId}:reject:yes` },
            { text: "Batal", callback_data: `app:${appId}:card` },
          ],
        ],
      });
      replies.push(confirmText);
      return;
    }

    if (action === "review" || action === "interview" || action === "reject:yes") {
      const toStatus = action === "review" ? "REVIEWED" : action === "interview" ? "INTERVIEW" : "REJECTED";
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
  const updateData: { status: string; stageUpdatedAt: Date; offerStatus?: string | null } = {
    status: toStatus,
    stageUpdatedAt: new Date(),
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
        OR: [{ stageUpdatedAt: { lt: staleThreshold } }, { stageUpdatedAt: null, createdAt: { lt: staleThreshold } }],
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
      OR: [{ stageUpdatedAt: { lt: staleThreshold } }, { stageUpdatedAt: null, createdAt: { lt: staleThreshold } }],
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

  const buttons: TelegramButton[][] = [
    [
      { text: "Ringkasan", callback_data: "cb:ringkasan" },
      { text: "Jadwal", callback_data: "cb:jadwal" },
    ],
  ];
  if (settings.telegramWriteEnabled && staleList.length > 0) {
    for (const item of staleList.slice(0, 5)) {
      buttons.push([
        { text: `Tandai Ditinjau: ${item.name}`.slice(0, 60), callback_data: `app:${item.id}:review` },
      ]);
    }
  }

  let sent = 0;
  for (const chat of settings.telegramAllowedChats) {
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
