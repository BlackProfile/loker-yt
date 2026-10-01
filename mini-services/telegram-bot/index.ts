// Telegram bot poller — jembatan antara Telegram Bot API dan aplikasi Next.js.
// Port tetap 3004 (health check). Prinsip: proses ini HANYA memindahkan update
// Telegram -> Next.js (/api/telegram/update) — tanpa token bot, tanpa akses DB.
// Token tetap milik aplikasi Next.js (Setting "site"); polling hanya dijalankan
// bila /api/telegram/config melaporkan enabled=true (token terisi).
//
// Alur:
//   1. Ambil konfigurasi tiap 60 detik dari APP_URL/api/telegram/config (secret header).
//   2. Bila enabled: pastikan webhook dihapus (getUpdates hanya jalan tanpa webhook),
//      sinkron offset ke update terakhir (backlog dilewati), lalu long-poll getUpdates.
//   3. Setiap update di-forward ke APP_URL/api/telegram/update (secret header).
//   4. Error jaringan -> backoff 5 detik; 409 (webhook aktif) -> deleteWebhook sekali lagi.
//
// Digest pagi TIDAK dijalankan dari sini — cron reminders di Next.js yang memicunya
// (tiap menit, idempoten internal), jadi tidak ada logika bisnis di service ini.

import { createServer } from "node:http";

const PORT = 3004;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.TELEGRAM_BRIDGE_SECRET ?? "lumina-telegram-secret";
const CONFIG_REFRESH_MS = 60_000;
const ERROR_BACKOFF_MS = 5_000;

let enabled = false;
let pollSeconds = 25;
let offset = 0;
let running = false;

function log(message: string): void {
  console.log(`[telegram-bot] ${new Date().toISOString()} ${message}`);
}

async function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${APP_URL}${path}`, {
      ...init,
      headers: { "x-telegram-secret": SECRET, ...(init?.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function tgApi(method: string, payload?: Record<string, unknown>): Promise<{ ok: boolean; result?: unknown; error_code?: number; description?: string }> {
  const controller = new AbortController();
  // Long polling: beri waktu ekstra di atas timeout Telegram.
  const timer = setTimeout(() => controller.abort(), (pollSeconds + 10) * 1000);
  try {
    const res = await fetch(`https://api.telegram.org/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: unknown;
      error_code?: number;
      description?: string;
    } | null;
    if (!json || json.ok !== true) {
      return { ok: false, error_code: json?.error_code, description: json?.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, result: json.result };
  } catch (error) {
    return { ok: false, description: error instanceof Error ? error.message : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

async function refreshConfig(): Promise<void> {
  try {
    const res = await appFetch("/api/telegram/config");
    if (res.ok) {
      const json = (await res.json()) as { enabled?: boolean; pollSeconds?: number };
      const nextEnabled = json.enabled === true;
      if (nextEnabled !== enabled) {
        log(nextEnabled ? "polling AKTIF (token terisi)" : "polling nonaktif (token kosong)");
      }
      enabled = nextEnabled;
      if (typeof json.pollSeconds === "number" && json.pollSeconds >= 5 && json.pollSeconds <= 50) {
        pollSeconds = json.pollSeconds;
      }
    } else {
      log(`config gagal: HTTP ${res.status}`);
    }
  } catch (error) {
    log(`config error: ${error instanceof Error ? error.message : error}`);
  }
}

async function forwardUpdate(update: unknown): Promise<boolean> {
  try {
    const res = await appFetch("/api/telegram/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update),
    });
    if (!res.ok) {
      log(`forward gagal: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (error) {
    log(`forward error: ${error instanceof Error ? error.message : error}`);
    return false;
  }
}

async function pollLoop(): Promise<void> {
  // Sinkron offset: lewati backlog lama saat pertama aktif (offset -1 = update terakhir saja).
  try {
    const sync = await tgApi("getUpdates", { offset: -1, timeout: 0, allowed_updates: ["message", "callback_query"] });
    if (sync.ok && Array.isArray(sync.result) && sync.result.length > 0) {
      const last = sync.result[sync.result.length - 1] as { update_id?: number };
      if (typeof last?.update_id === "number") {
        offset = last.update_id + 1;
        log(`sinkron offset ke ${offset} (backlog dilewati)`);
      }
    }
  } catch {
    // sinkronisasi gagal — poller tetap berjalan dengan offset 0
  }

  while (running) {
    if (!enabled) {
      await sleep(3000);
      continue;
    }
    const res = await tgApi("getUpdates", {
      offset,
      timeout: pollSeconds,
      allowed_updates: ["message", "callback_query"],
    });
    if (!res.ok) {
      if (res.error_code === 409) {
        log("webhook aktif terdeteksi — hapus webhook");
        await tgApi("deleteWebhook", { drop_pending_updates: false });
        await sleep(1000);
        continue;
      }
      log(`getUpdates gagal: ${res.description ?? "unknown"} — backoff ${ERROR_BACKOFF_MS / 1000}s`);
      await sleep(ERROR_BACKOFF_MS);
      continue;
    }
    const updates = Array.isArray(res.result) ? (res.result as { update_id?: number }[]) : [];
    for (const update of updates) {
      if (typeof update.update_id !== "number") continue;
      await forwardUpdate(update);
      offset = update.update_id + 1;
    }
  }
}

// Health check (dipakai monitoring / verifikasi manual).
const httpServer = createServer((req, res) => {
  if (req.url?.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, enabled, offset, pollSeconds, t: Date.now() }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

httpServer.listen(PORT, () => {
  log(`health endpoint di port ${PORT}`);
});

running = true;
log(`poller mulai — APP_URL=${APP_URL}`);
void refreshConfig();
setInterval(() => void refreshConfig(), CONFIG_REFRESH_MS);
void pollLoop();

// Tutup rapi saat dimatikan.
process.on("SIGINT", () => {
  running = false;
  httpServer.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  running = false;
  httpServer.close();
  process.exit(0);
});
