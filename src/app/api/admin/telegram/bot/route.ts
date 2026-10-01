// GET  /api/admin/telegram/bot — status bot Telegram untuk panel admin (semua role admin).
// POST /api/admin/telegram/bot — kelola bot: kode pemasangan, whitelist chat,
//      toggle aksi tulis & alert, pesan uji (dengan ALASAN bila gagal), dan
//      aksi "diagnose" — checklist bertahap + petunjuk perbaikan per masalah
//      (aksi ubah data: OWNER saja).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  checkTelegramToken,
  getAutomationSettings,
  sendTelegramMessageDetailed,
  type TelegramButton,
  type TelegramSendResult,
} from "@/lib/notify";
import { getPollerStatus } from "@/lib/telegram-bridge-status";
import { TELEGRAM_ALERT_KEYS, type TelegramAlertKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const PAIR_SETTING_KEY = "telegramPair";
const PAIR_TTL_MS = 15 * 60 * 1000;

type PairPayload = { code: string; expiresAt: string };

async function readSiteObj(): Promise<Record<string, unknown>> {
  const setting = await db.setting.findUnique({ where: { key: "site" } });
  if (!setting) return {};
  try {
    const parsed: unknown = JSON.parse(setting.value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // rusak
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

/** Terjemahkan error Telegram menjadi petunjuk perbaikan bahasa Indonesia. */
function hintFor(description: string | undefined): string {
  const d = (description ?? "").toLowerCase();
  if (d.includes("unauthorized") || d.includes("401")) {
    return "Token salah, dicabut, atau salah salin. Ambil ulang token dari @BotFather lalu isi di kartu Integrasi & Otomasi dan klik Simpan.";
  }
  if (d.includes("not found") || d.includes("404")) {
    return "Format token salah (seharusnya mirip 123456789:ABCdef...). Periksa ulang token dari @BotFather.";
  }
  if (d.includes("chat not found")) {
    return "Chat tidak dikenal Telegram. Pastikan kamu SUDAH PERNAH mengirim pesan ke bot dari chat tersebut, lalu daftarkan lewat kode pemasangan.";
  }
  if (d.includes("blocked") || d.includes("forbidden") || d.includes("403")) {
    return "Bot diblokir oleh chat tersebut. Buka blokirnya lalu kirim /start ke bot.";
  }
  if (d.includes("timeout") || d.includes("network") || d.includes("fetch")) {
    return "Server tidak bisa menghubungi api.telegram.org. Periksa koneksi internet server lalu coba lagi.";
  }
  if (d.includes("token bot kosong")) {
    return "Isi Telegram Bot Token di kartu Integrasi & Otomasi, lalu klik Simpan.";
  }
  return "Periksa pesan kesalahan di atas. Bila ragu, jalankan ulang Diagnostik.";
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const [settings, pairSetting] = await Promise.all([
      getAutomationSettings(),
      db.setting.findUnique({ where: { key: PAIR_SETTING_KEY } }).catch(() => null),
    ]);
    let pair: PairPayload | null = null;
    if (pairSetting) {
      try {
        const parsed = JSON.parse(pairSetting.value) as Partial<PairPayload> | null;
        if (parsed?.code && parsed?.expiresAt && new Date(parsed.expiresAt).getTime() > Date.now()) {
          pair = { code: parsed.code, expiresAt: parsed.expiresAt };
        }
      } catch {
        // rusak — anggap tidak ada
      }
    }
    return NextResponse.json({
      hasToken: Boolean(settings.telegramBotToken),
      legacyChatId: settings.telegramChatId,
      allowedChats: settings.telegramAllowedChats,
      writeEnabled: settings.telegramWriteEnabled,
      alerts: settings.telegramAlerts,
      pair,
      poller: getPollerStatus(),
    });
  } catch (error) {
    console.error("[GET /api/admin/telegram/bot]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal memuat status bot. Coba lagi." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const action = typeof data.action === "string" ? data.action : "";

    if (action === "create-pair") {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + PAIR_TTL_MS).toISOString();
      await db.setting.upsert({
        where: { key: PAIR_SETTING_KEY },
        update: { value: JSON.stringify({ code, expiresAt }) },
        create: { key: PAIR_SETTING_KEY, value: JSON.stringify({ code, expiresAt }) },
      });
      return NextResponse.json({ ok: true, code, expiresAt });
    }

    if (action === "cancel-pair") {
      await db.setting.deleteMany({ where: { key: PAIR_SETTING_KEY } });
      return NextResponse.json({ ok: true });
    }

    if (action === "remove-chat") {
      const chatId = typeof data.chatId === "string" ? data.chatId.trim() : "";
      if (!chatId) {
        return NextResponse.json({ error: "chatId wajib diisi." }, { status: 400 });
      }
      const site = await readSiteObj();
      const raw = Array.isArray(site.telegramAllowedChats) ? site.telegramAllowedChats : [];
      site.telegramAllowedChats = raw.filter((item) => item !== chatId);
      await writeSiteObj(site);
      return NextResponse.json({ ok: true, allowedChats: site.telegramAllowedChats });
    }

    if (action === "set-write") {
      if (typeof data.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled harus boolean." }, { status: 400 });
      }
      const site = await readSiteObj();
      site.telegramWriteEnabled = data.enabled;
      await writeSiteObj(site);
      return NextResponse.json({ ok: true, writeEnabled: data.enabled });
    }

    if (action === "set-alert") {
      const key = typeof data.key === "string" ? (data.key as TelegramAlertKey) : ("" as TelegramAlertKey);
      if (!TELEGRAM_ALERT_KEYS.includes(key)) {
        return NextResponse.json({ error: "Jenis alert tidak dikenal." }, { status: 400 });
      }
      if (typeof data.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled harus boolean." }, { status: 400 });
      }
      const site = await readSiteObj();
      const rawAlerts =
        site.telegramAlerts && typeof site.telegramAlerts === "object" && !Array.isArray(site.telegramAlerts)
          ? (site.telegramAlerts as Record<string, unknown>)
          : {};
      rawAlerts[key] = data.enabled;
      site.telegramAlerts = rawAlerts;
      await writeSiteObj(site);
      return NextResponse.json({ ok: true, key, enabled: data.enabled });
    }

    if (action === "test") {
      const settings = await getAutomationSettings();
      if (!settings.telegramBotToken) {
        return NextResponse.json(
          { error: "Token bot belum diisi. Isi Telegram Bot Token lalu simpan pengaturan." },
          { status: 400 },
        );
      }
      const targets = [...settings.telegramAllowedChats];
      if (targets.length === 0) {
        return NextResponse.json(
          { error: "Belum ada chat terdaftar. Buat kode pemasangan lalu kirim /mulai KODE ke bot." },
          { status: 400 },
        );
      }
      const text = "Tes koneksi Lumina Studio Bot — berhasil. Kirim /bantuan untuk daftar perintah.";
      const buttons: TelegramButton[][] = [
        [
          { text: "Ringkasan", callback_data: "cb:ringkasan" },
          { text: "Posisi", callback_data: "cb:posisi" },
        ],
      ];
      const results: { chatId: string; ok: boolean; description?: string; hint?: string }[] = [];
      for (const chat of targets) {
        const result: TelegramSendResult = await sendTelegramMessageDetailed(
          settings.telegramBotToken,
          chat,
          text,
          { buttons },
        );
        results.push({
          chatId: chat,
          ok: result.ok,
          description: result.description,
          hint: result.ok ? undefined : hintFor(result.description),
        });
      }
      return NextResponse.json({ ok: true, results });
    }

    if (action === "diagnose") {
      const settings = await getAutomationSettings();
      const steps: {
        key: string;
        label: string;
        status: "ok" | "fail" | "warn";
        detail?: string;
        hint?: string;
      }[] = [];

      // 1) Token terisi
      const hasToken = Boolean(settings.telegramBotToken);
      steps.push({
        key: "token",
        label: "Token bot terisi",
        status: hasToken ? "ok" : "fail",
        detail: hasToken ? "Token ditemukan di pengaturan." : "Belum ada token.",
        hint: hasToken
          ? undefined
          : "Isi kolom Telegram Bot Token di kartu Integrasi & Otomasi (dapat dari @BotFather), lalu klik Simpan.",
      });

      // 2) Token valid (getMe) — hanya bila token terisi
      let botUsername: string | null = null;
      if (hasToken) {
        const check = await checkTelegramToken(settings.telegramBotToken);
        botUsername = check.botUsername ?? null;
        steps.push({
          key: "token-valid",
          label: "Token valid",
          status: check.ok ? "ok" : "fail",
          detail: check.ok
            ? `Dikenali sebagai bot ${check.botUsername ?? "(tanpa username)"}`
            : (check.description ?? "Token ditolak Telegram"),
          hint: check.ok ? undefined : hintFor(check.description),
        });
      }

      // 3) Service polling hidup (heartbeat dari mini-service)
      const poller = getPollerStatus();
      steps.push({
        key: "poller",
        label: "Service polling aktif",
        status: poller.healthy ? "ok" : hasToken ? "fail" : "warn",
        detail:
          poller.secondsAgo != null
            ? `Terakhir terhubung ${poller.secondsAgo} detik lalu`
            : "Belum pernah terhubung",
        hint: poller.healthy
          ? undefined
          : "Mini-service telegram-bot tidak merespons. Jalankan: cd mini-services/telegram-bot && bun run dev (port 3004).",
      });

      // 4) Chat terdaftar
      const chatCount = settings.telegramAllowedChats.length;
      steps.push({
        key: "chats",
        label: "Chat admin terdaftar",
        status: chatCount > 0 ? "ok" : "fail",
        detail:
          chatCount > 0
            ? `${chatCount} chat terdaftar`
            : "Belum ada chat yang dipasangkan.",
        hint:
          chatCount > 0
            ? undefined
            : "Klik Buat Kode Pemasangan, lalu kirim /mulai KODE ke bot kamu dari Telegram.",
      });

      // 5) Kirim uji ke tiap chat (hanya bila token valid & ada chat)
      let sendResults: { chatId: string; ok: boolean; description?: string; hint?: string }[] = [];
      const tokenValid = steps.find((s) => s.key === "token-valid")?.status === "ok";
      if (tokenValid && chatCount > 0) {
        for (const chat of settings.telegramAllowedChats) {
          const result = await sendTelegramMessageDetailed(
            settings.telegramBotToken,
            chat,
            "Diagnostik Lumina Studio Bot — chat ini siap menerima alert & perintah.",
          );
          sendResults.push({
            chatId: chat,
            ok: result.ok,
            description: result.description,
            hint: result.ok ? undefined : hintFor(result.description),
          });
        }
        steps.push({
          key: "send",
          label: "Kirim pesan ke chat terdaftar",
          status: sendResults.every((r) => r.ok) ? "ok" : "fail",
          detail: sendResults
            .map((r) => `Chat ${r.chatId}: ${r.ok ? "ok" : (r.description ?? "gagal")}`)
            .join(" | "),
          hint: sendResults.every((r) => r.ok) ? undefined : hintFor(sendResults.find((r) => !r.ok)?.description),
        });
      }

      return NextResponse.json({ ok: true, steps, botUsername, sendResults, poller });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (error) {
    console.error("[POST /api/admin/telegram/bot]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal menjalankan aksi bot. Coba lagi." }, { status: 500 });
  }
}
