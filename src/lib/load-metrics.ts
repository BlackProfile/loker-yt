// SERVER-ONLY — NR45: metrik beban server in-process (Paket A/B/C "Server Sedang Berat").
// Satu lib kohesif berisi: memo cache, rate limiter, slow-request log, antrean AI
// berbatas paralel, Mode Hemat (save mode), pembaca Setting maintenance_mode &
// quiet_hours, snapshot kesehatan + alert Telegram.
//
// Semua state hidup di memori proses via singleton globalThis agar selamat dari
// HMR dev (pola sama dengan status-gate.ts). Tanpa infrastruktur tambahan —
// hilang saat restart, cukup untuk tujuan perlindungan beban.
//
// PRINSIP: fungsi apa pun di lib ini TIDAK PERNAH melempar error ke pemanggil —
// fitur beban tidak boleh menggagalkan alur utama (try/catch + fallback senyap).
import { statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { sendSystemEvent } from "@/lib/notify";
import type { MaintenancePublicInfo, ServerLoadLevel } from "@/lib/types";

// --- Ambang bawaan (angka bisa dinilai ulang lewat pengamatan produksi) ---
// CATATAN KALIBRASI (NR45): RSS proses dev (Turbopack + max-old-space-size)
// besar sejak awal (bisa >2 GB) sehingga TIDAK dipakai sebagai pemicu; sinyal
// memori yang dipakai = heapUsed (memori JS hidup). RSS tetap ditampilkan.
export const LOAD_THRESHOLDS = {
  dbLatencyWarnMs: 300,
  dbLatencyCritMs: 800,
  heapUsedWarnMb: 700,
  heapUsedCritMb: 1000,
  /** Pengaman runaway RSS saja (jauh di atas baseline dev ~2 GB). */
  rssRunawayCritMb: 4096,
  slowPerHourWarn: 10,
  emailFailedCrit: 20,
  emailFailedWarn: 5,
  /** Permintaan di atas durasi ini dicatat sebagai "lambat" (ActivityLog dedupe). */
  slowRequestMs: 800,
  /** Dedupe ActivityLog SLOW_REQUEST per rute. */
  slowLogDedupeMs: 5 * 60_000,
  /** Maks paralel tugas AI. */
  maxConcurrent: 2,
  /** CRIT berturut sebelum Mode Hemat AUTO aktif. */
  critStreakToSave: 2,
  /** OK berturut + durasi minimum sebelum Mode Hemat AUTO pulih. */
  okStreakToRecover: 3,
  saveMinDurationMs: 10 * 60_000,
  alertCooldownMs: 30 * 60_000,
} as const;

// --- State global (selamat dari HMR) ---
type SlowEntry = { route: string; ms: number; at: number };
type CacheEntry = { expiresAt: number; value: unknown };
type QueueJob = { id: string; runner: () => Promise<void> };
type SaveModeState = {
  active: boolean;
  source: "AUTO" | "MANUAL";
  reason: string;
  since: number | null;
  critStreak: number;
  okStreak: number;
  lastAlertAt: number;
};

type LoadState = {
  slowRing: SlowEntry[];
  slowLogAt: Map<string, number>;
  cache: Map<string, CacheEntry>;
  cacheHits: number;
  cacheMisses: number;
  cacheLastClearedAt: number | null;
  rateMap: Map<string, number[]>;
  queueWaiting: QueueJob[];
  queueRunning: Set<string>;
  queueProcessed: number;
  save: SaveModeState;
};

const g = globalThis as unknown as { __luminaLoad?: LoadState };

function state(): LoadState {
  if (!g.__luminaLoad) {
    g.__luminaLoad = {
      slowRing: [],
      slowLogAt: new Map(),
      cache: new Map(),
      cacheHits: 0,
      cacheMisses: 0,
      cacheLastClearedAt: null,
      rateMap: new Map(),
      queueWaiting: [],
      queueRunning: new Set(),
      queueProcessed: 0,
      save: {
        active: false,
        source: "AUTO",
        reason: "",
        since: null,
        critStreak: 0,
        okStreak: 0,
        lastAlertAt: 0,
      },
    };
  }
  return g.__luminaLoad;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ============================================================
// MEMO CACHE — bacaan panas (posisi publik, konten landing)
// ============================================================

/**
 * Ambil dari cache memori bila masih segar; selain itu muat lewat `loader`,
 * simpan, dan kembalikan bersama penanda `cached` (untuk header X-Cache).
 * `loader` yang melempar error TIDAK dicache — error diteruskan ke pemanggil.
 */
export async function memoGet<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  const s = state();
  const now = Date.now();
  const hit = s.cache.get(key);
  if (hit && hit.expiresAt > now) {
    s.cacheHits += 1;
    return { value: hit.value as T, cached: true };
  }
  s.cacheMisses += 1;
  const value = await loader();
  s.cache.set(key, { expiresAt: now + ttlMs, value });
  // Prune ringan agar map tidak tumbuh tak terbatas.
  if (s.cache.size > 60) {
    for (const [k, entry] of s.cache) {
      if (entry.expiresAt <= now) s.cache.delete(k);
    }
  }
  return { value, cached: false };
}

/** Hapus semua kunci cache dengan prefiks tertentu (dipakai realtime emit). */
export function memoInvalidatePrefix(prefix: string): void {
  try {
    const s = state();
    for (const key of s.cache.keys()) {
      if (key.startsWith(prefix)) s.cache.delete(key);
    }
  } catch {
    // diam
  }
}

/** Bersihkan seluruh cache (tombol admin). */
export function memoClear(): void {
  try {
    const s = state();
    s.cache.clear();
    s.cacheLastClearedAt = Date.now();
  } catch {
    // diam
  }
}

export function memoStats(): {
  size: number;
  hits: number;
  misses: number;
  hitRate: number | null;
  lastClearedAt: string | null;
} {
  const s = state();
  const total = s.cacheHits + s.cacheMisses;
  return {
    size: s.cache.size,
    hits: s.cacheHits,
    misses: s.cacheMisses,
    hitRate: total > 0 ? round1(s.cacheHits / total) : null,
    lastClearedAt:
      s.cacheLastClearedAt != null ? new Date(s.cacheLastClearedAt).toISOString() : null,
  };
}

// ============================================================
// RATE LIMIT — sliding window per kunci (mis. "apply:1.2.3.4")
// ============================================================

export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
): { allowed: boolean; retryAfterSec: number } {
  try {
    const s = state();
    const now = Date.now();
    const hits = (s.rateMap.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (hits.length >= max) {
      s.rateMap.set(key, hits);
      const oldest = hits[0] ?? now;
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
      };
    }
    hits.push(now);
    s.rateMap.set(key, hits);
    if (s.rateMap.size > 2000) {
      for (const [k, arr] of s.rateMap) {
        if (arr.every((ts) => now - ts >= windowMs)) s.rateMap.delete(k);
      }
    }
    return { allowed: true, retryAfterSec: 0 };
  } catch {
    // Gagal limitir = izinkan (jangan pernah memblokir alur utama).
    return { allowed: true, retryAfterSec: 0 };
  }
}

// ============================================================
// SLOW REQUEST LOG — ring memori + ActivityLog berdedupe
// ============================================================

/** Catat durasi satu permintaan; >= ambang dicatat ke ActivityLog (maks 1x/5 mnt/rute). */
export function recordSlowRequest(route: string, ms: number): void {
  try {
    const s = state();
    const now = Date.now();
    s.slowRing.push({ route, ms, at: now });
    if (s.slowRing.length > 500) {
      s.slowRing.splice(0, s.slowRing.length - 500);
    }
    if (ms >= LOAD_THRESHOLDS.slowRequestMs) {
      const last = s.slowLogAt.get(route) ?? 0;
      if (now - last >= LOAD_THRESHOLDS.slowLogDedupeMs) {
        s.slowLogAt.set(route, now);
        void db.activityLog
          .create({
            data: {
              applicationId: null,
              actor: "Sistem",
              action: "SLOW_REQUEST",
              detail: `Rute ${route} lambat: ${Math.round(ms)} ms (ambang ${LOAD_THRESHOLDS.slowRequestMs} ms).`,
            },
          })
          .catch(() => {});
      }
    }
  } catch {
    // diam — logging tidak boleh melempar
  }
}

/** Rekap permintaan lambat 24 jam terakhir. */
export function slowStats24h(): {
  count: number;
  perHour: number;
  thresholdMs: number;
  last: { route: string; ms: number; at: string } | null;
} {
  try {
    const s = state();
    const now = Date.now();
    const rows = s.slowRing.filter((e) => e.at >= now - 24 * 60 * 60_000);
    const lastEntry = rows.length > 0 ? rows[rows.length - 1] : null;
    return {
      count: rows.length,
      perHour: rows.filter((e) => e.at >= now - 60 * 60_000).length,
      thresholdMs: LOAD_THRESHOLDS.slowRequestMs,
      last: lastEntry
        ? {
            route: lastEntry.route,
            ms: Math.round(lastEntry.ms),
            at: new Date(lastEntry.at).toISOString(),
          }
        : null,
    };
  } catch {
    return { count: 0, perHour: 0, thresholdMs: LOAD_THRESHOLDS.slowRequestMs, last: null };
  }
}

// ============================================================
// ANTREAN AI — FIFO, maks paralel, hormati Mode Hemat
// ============================================================

function isSaveModeActive(): boolean {
  return state().save.active;
}

function pump(): void {
  const s = state();
  while (s.queueRunning.size < LOAD_THRESHOLDS.maxConcurrent && s.queueWaiting.length > 0) {
    // Mode Hemat aktif -> tunda semua tugas AI sampai pulih.
    if (isSaveModeActive()) break;
    const job = s.queueWaiting.shift();
    if (!job) break;
    s.queueRunning.add(job.id);
    void (async () => {
      try {
        await job.runner();
      } catch {
        // Pemanggil (pipeline) sudah menjamin tidak throw; pengaman terakhir.
      } finally {
        s.queueRunning.delete(job.id);
        s.queueProcessed += 1;
        pump();
      }
    })();
  }
}

/**
 * Masukkan tugas latar belakang (AI screening dll.) ke antrean berbatas paralel.
 * Dedupe per id selama masih menunggu/berjalan. TIDAK PERNAH throw — bila
 * antrean gagal (tak seharusnya), tugas dijalankan langsung sebagai fallback.
 */
export function enqueueAiJob(id: string, runner: () => Promise<void>): void {
  try {
    const s = state();
    if (s.queueRunning.has(id) || s.queueWaiting.some((j) => j.id === id)) return;
    s.queueWaiting.push({ id, runner });
    pump();
  } catch {
    void runner().catch(() => {});
  }
}

export function queueStats(): {
  waiting: number;
  running: number;
  maxConcurrent: number;
  processed: number;
  paused: boolean;
} {
  const s = state();
  return {
    waiting: s.queueWaiting.length,
    running: s.queueRunning.size,
    maxConcurrent: LOAD_THRESHOLDS.maxConcurrent,
    processed: s.queueProcessed,
    paused: s.save.active,
  };
}

// ============================================================
// MODE HEMAT (SAVE MODE) — degradasi bertahap
// ============================================================

async function logSaveTransition(
  on: boolean,
  source: "AUTO" | "MANUAL",
  reason: string,
): Promise<void> {
  try {
    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: "Sistem",
        action: on ? "SAVE_MODE_ON" : "SAVE_MODE_OFF",
        detail: `Mode Hemat ${on ? "diaktifkan" : "dinonaktifkan"} (${source}): ${reason}`,
      },
    });
  } catch {
    // diam
  }
  try {
    await sendSystemEvent({
      title: on ? "Mode Hemat Diaktifkan" : "Mode Hemat Dinonaktifkan",
      detail: `Sumber: ${source}. Alasan: ${reason}. Tugas AI latar belakang ${
        on ? "ditunda sampai kondisi pulih." : "kembali berjalan normal."
      }`,
      action: on ? "SAVE_MODE_ON" : "SAVE_MODE_OFF",
      category: "SYSTEM",
    });
  } catch {
    // diam
  }
}

export async function activateSaveMode(
  source: "AUTO" | "MANUAL",
  reason: string,
): Promise<void> {
  try {
    const s = state();
    if (s.save.active) return;
    s.save = {
      ...s.save,
      active: true,
      source,
      reason,
      since: Date.now(),
      okStreak: 0,
      critStreak: source === "AUTO" ? s.save.critStreak : 0,
    };
    await logSaveTransition(true, source, reason);
  } catch {
    // diam
  }
}

export async function deactivateSaveMode(reason: string): Promise<void> {
  try {
    const s = state();
    if (!s.save.active) return;
    const source = s.save.source;
    s.save = {
      ...s.save,
      active: false,
      source: "AUTO",
      reason: "",
      since: null,
      critStreak: 0,
      okStreak: 0,
    };
    await logSaveTransition(false, source, reason);
  } catch {
    // diam
  }
}

export function saveModeInfo(): {
  active: boolean;
  source: "AUTO" | "MANUAL";
  reason: string;
  since: string | null;
} {
  const s = state().save;
  return {
    active: s.active,
    source: s.source,
    reason: s.reason,
    since: s.since != null ? new Date(s.since).toISOString() : null,
  };
}

/**
 * Umpan balik hasil pengukuran kesehatan -> streak, transisi Mode Hemat AUTO,
 * dan alert Telegram (cooldown). Dipanggil dari getServerLoadSnapshot (polling
 * admin + cron), TIDAK dari /api/health publik agar spam publik tak memicu.
 */
export async function noteHealthResult(level: ServerLoadLevel): Promise<void> {
  try {
    const s = state();
    if (level === "CRIT") {
      s.save.critStreak += 1;
      s.save.okStreak = 0;
    } else if (level === "OK") {
      s.save.okStreak += 1;
      s.save.critStreak = 0;
    }
    // AUTO ON: kritis berturut-turut.
    if (level === "CRIT" && !s.save.active && s.save.critStreak >= LOAD_THRESHOLDS.critStreakToSave) {
      await activateSaveMode("AUTO", `Server kritis ${s.save.critStreak}x pemeriksaan berturut-turut`);
    }
    // AUTO OFF: pulih cukup lama (hanya bila sumbernya AUTO).
    if (
      level === "OK" &&
      s.save.active &&
      s.save.source === "AUTO" &&
      s.save.since != null &&
      Date.now() - s.save.since >= LOAD_THRESHOLDS.saveMinDurationMs &&
      s.save.okStreak >= LOAD_THRESHOLDS.okStreakToRecover
    ) {
      await deactivateSaveMode("Metrik pulih normal beberapa pemeriksaan berturut-turut");
    }
    // Alert Telegram kritis (dengan cooldown).
    if (level === "CRIT" && Date.now() - s.save.lastAlertAt >= LOAD_THRESHOLDS.alertCooldownMs) {
      s.save.lastAlertAt = Date.now();
      try {
        await sendSystemEvent({
          title: "Server Sedang Berat (Kritis)",
          detail:
            "Pemeriksaan kesehatan menunjukkan kondisi KRITIS. Mode Hemat otomatis menunda tugas AI. Periksa kartu Kesehatan Server di dashboard admin.",
          action: "SERVER_LOAD_CRIT",
          category: "SYSTEM",
        });
      } catch {
        // diam
      }
    }
  } catch {
    // diam
  }
}

// ============================================================
// SETTING maintenance_mode & quiet_hours (pembaca/penulis bersama)
// CATATAN: kunci "maintenance" SUDAH dipakai cron auto-arsip —
// mode perawatan situs memakai kunci TERPISAH "maintenance_mode".
// ============================================================

export type MaintenanceConfig = MaintenancePublicInfo & { updatedAt: string | null };
export type QuietHoursConfig = { enabled: boolean; startHour: number; endHour: number };

async function readJsonSetting(key: string): Promise<Record<string, unknown>> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (!row) return {};
    const parsed: unknown = JSON.parse(row.value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function readMaintenanceConfig(): Promise<MaintenanceConfig> {
  const raw = await readJsonSetting("maintenance_mode");
  const level = raw.level === "FULL" ? "FULL" : "APPLY_ONLY";
  const message = typeof raw.message === "string" ? raw.message.slice(0, 300) : "";
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;
  return { enabled: raw.enabled === true, level, message, updatedAt };
}

export async function writeMaintenanceConfig(cfg: {
  enabled: boolean;
  level: "FULL" | "APPLY_ONLY";
  message: string;
}): Promise<MaintenanceConfig> {
  const value = JSON.stringify({
    enabled: cfg.enabled,
    level: cfg.level,
    message: cfg.message.slice(0, 300),
    updatedAt: new Date().toISOString(),
  });
  await db.setting.upsert({
    where: { key: "maintenance_mode" },
    update: { value },
    create: { key: "maintenance_mode", value },
  });
  return readMaintenanceConfig();
}

function clampHour(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.round(n)));
}

/** Apakah `date` berada di dalam jendela (mendukung jendela lintas tengah malam). */
export function quietInWindow(q: QuietHoursConfig, date: Date = new Date()): boolean {
  if (!q.enabled) return true; // tanpa jendela = selalu "di dalam" (job tidak pernah ditunda)
  const h = date.getHours();
  if (q.startHour === q.endHour) return true; // jendela 24 jam
  if (q.startHour < q.endHour) return h >= q.startHour && h < q.endHour;
  return h >= q.startHour || h < q.endHour;
}

export async function readQuietHoursConfig(): Promise<QuietHoursConfig & { inWindow: boolean }> {
  const raw = await readJsonSetting("quiet_hours");
  const cfg: QuietHoursConfig = {
    enabled: raw.enabled === true,
    startHour: clampHour(raw.startHour, 2),
    endHour: clampHour(raw.endHour, 5),
  };
  return { ...cfg, inWindow: quietInWindow(cfg) };
}

export async function writeQuietHoursConfig(cfg: QuietHoursConfig): Promise<QuietHoursConfig & { inWindow: boolean }> {
  const value = JSON.stringify({
    enabled: cfg.enabled,
    startHour: clampHour(cfg.startHour, 2),
    endHour: clampHour(cfg.endHour, 5),
  });
  await db.setting.upsert({
    where: { key: "quiet_hours" },
    update: { value },
    create: { key: "quiet_hours", value },
  });
  return readQuietHoursConfig();
}

// ============================================================
// SNAPSHOT KESEHATAN
// ============================================================

function worstLevel(a: ServerLoadLevel, b: ServerLoadLevel): ServerLoadLevel {
  if (a === "CRIT" || b === "CRIT") return "CRIT";
  if (a === "WARN" || b === "WARN") return "WARN";
  return "OK";
}

/** Ping layanan realtime (port 3003, endpoint /health). Tidak pernah throw. */
async function pingRealtime(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:3003/health", {
      signal: AbortSignal.timeout(600),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Snapshot penuh untuk dashboard admin + cron. Setiap pemanggilan juga
 * menjalankan noteHealthResult (streak -> Mode Hemat AUTO + alert).
 */
export async function getServerLoadSnapshot() {
  const now = new Date();
  const reasons: string[] = [];
  let level: ServerLoadLevel = "OK";
  const bump = (l: ServerLoadLevel, reason: string) => {
    if (reason) reasons.push(reason);
    level = worstLevel(level, l);
  };

  // DB: latensi nyata via SELECT 1.
  let dbOk = true;
  let latencyMs = 0;
  const t0 = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    latencyMs = Date.now() - t0;
  } catch {
    dbOk = false;
    latencyMs = Date.now() - t0;
  }
  if (!dbOk) bump("CRIT", "Database tidak dapat dihubungi.");
  else if (latencyMs >= LOAD_THRESHOLDS.dbLatencyCritMs)
    bump("CRIT", `Latensi DB kritis: ${latencyMs} ms (ambang ${LOAD_THRESHOLDS.dbLatencyCritMs} ms).`);
  else if (latencyMs >= LOAD_THRESHOLDS.dbLatencyWarnMs)
    bump("WARN", `Latensi DB tinggi: ${latencyMs} ms (ambang ${LOAD_THRESHOLDS.dbLatencyWarnMs} ms).`);

  // Memori proses — sinyal utama heapUsed; RSS hanya pengaman runaway.
  const mu = process.memoryUsage();
  const rssMb = round1(mu.rss / 1048576);
  const heapUsedMb = round1(mu.heapUsed / 1048576);
  if (rssMb >= LOAD_THRESHOLDS.rssRunawayCritMb)
    bump("CRIT", `Memori proses meledak (RSS ${rssMb} MB) — indikasi kebocoran.`);
  if (heapUsedMb >= LOAD_THRESHOLDS.heapUsedCritMb)
    bump("CRIT", `Memori JS kritis: ${heapUsedMb} MB (ambang ${LOAD_THRESHOLDS.heapUsedCritMb} MB).`);
  else if (heapUsedMb >= LOAD_THRESHOLDS.heapUsedWarnMb)
    bump("WARN", `Memori JS tinggi: ${heapUsedMb} MB (ambang ${LOAD_THRESHOLDS.heapUsedWarnMb} MB).`);

  // Antrean email.
  let queued = 0;
  let failed = 0;
  try {
    [queued, failed] = await Promise.all([
      db.emailOutbox.count({ where: { status: "QUEUED" } }),
      db.emailOutbox.count({ where: { status: "FAILED" } }),
    ]);
  } catch {
    // diam — hitungan 0
  }
  if (failed > LOAD_THRESHOLDS.emailFailedCrit)
    bump("CRIT", `Email gagal menumpuk: ${failed} pesan.`);
  else if (failed > LOAD_THRESHOLDS.emailFailedWarn)
    bump("WARN", `Beberapa email gagal terkirim: ${failed} pesan.`);

  // Permintaan lambat.
  const slow = slowStats24h();
  if (slow.perHour > LOAD_THRESHOLDS.slowPerHourWarn)
    bump("WARN", `Permintaan lambat menumpuk: ${slow.perHour} dalam satu jam terakhir.`);

  // Realtime service.
  const rtOk = await pingRealtime();
  if (!rtOk) bump("WARN", "Layanan realtime tidak merespons.");

  const [maintenance, quiet] = await Promise.all([readMaintenanceConfig(), readQuietHoursConfig()]);

  const snapshot = {
    level,
    reasons,
    db: { ok: dbOk, latencyMs },
    memory: { rssMb, heapUsedMb },
    uptimeSec: Math.floor(process.uptime()),
    disk: { dbBytes: dbFileBytes() },
    email: { queued, failed },
    slowRequests: {
      count24h: slow.count,
      thresholdMs: slow.thresholdMs,
      last: slow.last,
    },
    cache: memoStats(),
    aiQueue: queueStats(),
    realtime: { ok: rtOk },
    saveMode: saveModeInfo(),
    maintenance: { enabled: maintenance.enabled, level: maintenance.level, message: maintenance.message },
    quietHours: {
      enabled: quiet.enabled,
      startHour: quiet.startHour,
      endHour: quiet.endHour,
      inWindow: quiet.inWindow,
    },
    thresholds: {
      dbLatencyWarnMs: LOAD_THRESHOLDS.dbLatencyWarnMs,
      dbLatencyCritMs: LOAD_THRESHOLDS.dbLatencyCritMs,
      heapUsedWarnMb: LOAD_THRESHOLDS.heapUsedWarnMb,
      heapUsedCritMb: LOAD_THRESHOLDS.heapUsedCritMb,
      slowPerHourWarn: LOAD_THRESHOLDS.slowPerHourWarn,
    },
    checkedAt: now.toISOString(),
  };

  // Efek samping terkontrol: streak, Mode Hemat AUTO, alert Telegram.
  await noteHealthResult(level);
  return snapshot;
}

/**
 * Versi ringan untuk /api/health publik: TANPA query tambahan dan TANPA
 * noteHealthResult (spam publik tidak boleh memicu transisi/alert).
 */
export function getServerLoadLite(dbLatencyMs: number, dbOk: boolean) {
  const reasons: string[] = [];
  let level: ServerLoadLevel = "OK";
  const bump = (l: ServerLoadLevel, reason: string) => {
    if (reason) reasons.push(reason);
    level = worstLevel(level, l);
  };
  if (!dbOk) bump("CRIT", "Database tidak dapat dihubungi.");
  else if (dbLatencyMs >= LOAD_THRESHOLDS.dbLatencyCritMs)
    bump("CRIT", `Latensi DB kritis: ${dbLatencyMs} ms.`);
  else if (dbLatencyMs >= LOAD_THRESHOLDS.dbLatencyWarnMs)
    bump("WARN", `Latensi DB tinggi: ${dbLatencyMs} ms.`);

  const mu = process.memoryUsage();
  const rssMb = round1(mu.rss / 1048576);
  if (rssMb >= LOAD_THRESHOLDS.rssRunawayCritMb) bump("CRIT", `Memori proses meledak (RSS ${rssMb} MB).`);
  const heapUsedMb = round1(mu.heapUsed / 1048576);
  if (heapUsedMb >= LOAD_THRESHOLDS.heapUsedCritMb) bump("CRIT", `Memori JS kritis: ${heapUsedMb} MB.`);
  else if (heapUsedMb >= LOAD_THRESHOLDS.heapUsedWarnMb) bump("WARN", `Memori JS tinggi: ${heapUsedMb} MB.`);

  const slow = slowStats24h();
  if (slow.perHour > LOAD_THRESHOLDS.slowPerHourWarn)
    bump("WARN", `Permintaan lambat menumpuk: ${slow.perHour}/jam.`);

  return {
    level,
    reasons,
    memory: { rssMb, heapUsedMb: round1(mu.heapUsed / 1048576) },
    slowRequests24h: slow.count,
    aiQueue: queueStats(),
    cache: { hits: memoStats().hits, misses: memoStats().misses },
    saveMode: saveModeInfo(),
  };
}

function dbFileBytes(): number {
  try {
    const p = path.resolve(process.cwd(), "db", "custom.db");
    return statSync(p).size;
  } catch {
    return 0;
  }
}

// ============================================================
// DEMO PANEL — tunda & tugas dummy (aman, tanpa menyentuh data)
// ============================================================

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
