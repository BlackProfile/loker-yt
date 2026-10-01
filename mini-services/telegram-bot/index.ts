// Telegram bot poller — jembatan antara Telegram Bot API dan aplikasi Next.js.
// Port tetap 3004 (health check). Prinsip: proses ini HANYA memindahkan update
// Telegram -> Next.js (/api/telegram/update) — tanpa DB, tanpa logika bisnis.
// Token bot diperoleh dari /api/telegram/config (dilindungi bridge secret, trafik
// localhost saja) dan dipakai untuk long-polling getUpdates:
//   https://api.telegram.org/bot<TOKEN>/getUpdates
// Token TIDAK boleh di-hardcode di sini; tanpa token Telegram menjawab 404
// "Not Found" dan bot tidak pernah menerima pesan masuk.
//
// Alur:
//   1. Ambil konfigurasi (enabled + token) tiap 60 detik dari APP_URL/api/telegram/config.
//   2. Bila enabled: pastikan webhook dihapus (getUpdates hanya jalan tanpa webhook),
//      sinkron offset ke update terakhir (backlog dilewati), lalu long-poll getUpdates.
//   3. Setiap update di-forward ke APP_URL/api/telegram/update (secret header);
//      forward gagal dicoba ulang (maks 3x) agar update tidak hilang, lalu dilewati
//      agar satu update rusak tidak menyumbat antrean.
//   4. Error jaringan -> backoff 5 detik; 409 (webhook aktif) -> deleteWebhook;
//      401 (token dicabut/diganti) -> refresh config segera.
//   5. Guard hot-reload (bun --hot): loop generasi lama dihentikan saat file diubah,
//      sehingga tidak menumpuk loop getUpdates ganda.
//
// Digest pagi TIDAK dijalankan dari sini — cron reminders di Next.js yang memicunya
// (tiap menit, idempoten internal), jadi tidak ada logika bisnis di service ini.

import { createServer } from "node:http";

const PORT = 3004;
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.TELEGRAM_BRIDGE_SECRET ?? "lumina-telegram-secret";
const CONFIG_REFRESH_MS = 60_000;
const ERROR_BACKOFF_MS = 5_000;
const FORWARD_RETRY_MAX = 3;

interface LoopHandle {
  stop: boolean;
}

// Guard hot-reload: bun --hot mengeksekusi ulang file ini tanpa mematikan loop lama.
// Daftar loop hidup disimpan di globalThis; setiap eksekusi baru menghentikan semua
// loop generasi sebelumnya sehingga selalu ada TEPAT satu loop polling per proses.
const GLOBAL_STATE = globalThis as typeof globalThis & {
  __tgPollerLoops?: Set<LoopHandle>;
  __tgPollerTimers?: ReturnType<typeof setInterval>[];
};
const liveLoops: Set<LoopHandle> = (GLOBAL_STATE.__tgPollerLoops ??= new Set());
const liveTimers: ReturnType<typeof setInterval>[] = (GLOBAL_STATE.__tgPollerTimers ??= []);
for (const loop of liveLoops) loop.stop = true;
liveLoops.clear();
for (const timer of liveTimers) clearInterval(timer);
liveTimers.length = 0;

let enabled = false;
let token = "";
let pollSeconds = 25;
let offset = 0;

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

async function tgApi(
  method: string,
  payload?: Record<string, unknown>
): Promise<{ ok: boolean; result?: unknown; error_code?: number; description?: string }> {
  if (!token) return { ok: false, description: "token belum tersedia" };
  const controller = new AbortController();
  // Long polling: beri waktu ekstra di atas timeout Telegram.
  const timer = setTimeout(() => controller.abort(), (pollSeconds + 10) * 1000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
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
      return {
        ok: false,
        error_code: json?.error_code,
        description: json?.description ?? `HTTP ${res.status}`,
      };
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
      const json = (await res.json()) as { enabled?: boolean; pollSeconds?: number; token?: string };
      const nextEnabled = json.enabled === true && typeof json.token === "string" && json.token.length > 0;
      const nextToken = nextEnabled ? (json.token as string).trim() : "";
      if (nextToken !== token) {
        if (token) log("token berubah — sinkron ulang offset untuk bot baru");
        token = nextToken;
        offset = 0; // bot berbeda punya ruang update_id sendiri; sync ulang di bawah
        await syncOffset();
      }
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

// Sinkron offset: lewati backlog lama saat pertama aktif / token berganti
// (offset -1 = ambil update terakhir saja, jadikan patokan offset berikutnya).
async function syncOffset(): Promise<void> {
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
    // sinkronisasi gagal — poller tetap berjalan dengan offset saat ini
  }
}

async function forwardUpdate(update: unknown): Promise<boolean> {
  for (let attempt = 1; attempt <= FORWARD_RETRY_MAX; attempt++) {
    try {
      const res = await appFetch("/api/telegram/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(update),
      });
      if (res.ok) return true;
      log(`forward gagal (percobaan ${attempt}/${FORWARD_RETRY_MAX}): HTTP ${res.status}`);
    } catch (error) {
      log(`forward error (percobaan ${attempt}/${FORWARD_RETRY_MAX}): ${error instanceof Error ? error.message : error}`);
    }
    if (attempt < FORWARD_RETRY_MAX) await sleep(ERROR_BACKOFF_MS);
  }
  return false; // pemanggil memutuskan: lewati agar antrean tidak macet
}

async function pollLoop(handle: LoopHandle): Promise<void> {
  while (!handle.stop) {
    if (!enabled || !token) {
      await sleep(3000);
      continue;
    }
    const res = await tgApi("getUpdates", {
      offset,
      timeout: pollSeconds,
      allowed_updates: ["message", "callback_query"],
    });
    if (handle.stop) break;
    if (!res.ok) {
      if (res.error_code === 409) {
        log("webhook aktif terdeteksi — hapus webhook");
        await tgApi("deleteWebhook", { drop_pending_updates: false });
        await sleep(1000);
        continue;
      }
      if (res.error_code === 401) {
        // Token dicabut/diganti — tarik config baru segera (jangan tunggu 60 detik).
        log("token ditolak Telegram (401) — refresh config");
        await refreshConfig();
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
      const delivered = await forwardUpdate(update);
      if (handle.stop) break;
      if (!delivered) {
        // Update rusak/antrean macet — lewati agar bot tetap responsif.
        log(`update ${update.update_id} dilewati setelah ${FORWARD_RETRY_MAX} percobaan`);
      }
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

log(`poller mulai — APP_URL=${APP_URL}`);
void refreshConfig();
liveTimers.push(setInterval(() => void refreshConfig(), CONFIG_REFRESH_MS));

const handle: LoopHandle = { stop: false };
liveLoops.add(handle);
void pollLoop(handle);

// Tutup rapi saat dimatikan.
process.on("SIGINT", () => {
  handle.stop = true;
  httpServer.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  handle.stop = true;
  httpServer.close();
  process.exit(0);
});
