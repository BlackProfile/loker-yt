// SERVER-ONLY — NR49: gate terpusat seluruh fitur AI (Paket A "Pusat Kendali AI").
// Setiap pemanggilan fitur AI melewati aiGateCheck()/withAiGate():
//   1) fitur dimatikan di Pusat Kendali AI            -> BLOCKED
//   2) kuota harian fitur terlampaui                  -> BLOCKED
//   3) tugas "background" saat Mode Hemat aktif       -> BLOCKED (ditunda)
//   4) tugas "background" saat Prioritas Aksi Admin
//      aktif dan antrean AI masih berisi tugas manual -> BLOCKED (ditunda)
// Semua eksekusi tercatat di tabel AiJobLog (OK / ERROR / BLOCKED) — dasar
// Log Aktivitas AI dan hitungan kuota.
import { db } from "@/lib/db";
import {
  AI_FEATURES,
  aiFeatureDef,
  type AiControlView,
  type AiUsageView,
} from "@/lib/ai-features";
import { saveModeInfo, queueStats } from "@/lib/load-metrics";

const SETTING_KEY = "ai_control";
const CONFIG_CACHE_MS = 30_000;
const USAGE_CACHE_MS = 15_000;

export type AiFeatureConfig = { enabled: boolean; quotaPerDay: number | null };
export type AiControlConfig = {
  features: Record<string, AiFeatureConfig>;
  manualPriority: boolean;
  updatedAt: string | null;
};

export class AiGateError extends Error {
  readonly feature: string;
  constructor(feature: string, message: string) {
    super(message);
    this.feature = feature;
  }
}

// ---- Konfigurasi (Setting "ai_control") -------------------------------------

let configCache: { config: AiControlConfig; at: number } | null = null;

function defaultConfig(): AiControlConfig {
  const features: Record<string, AiFeatureConfig> = {};
  for (const def of AI_FEATURES) {
    features[def.key] = { enabled: true, quotaPerDay: def.defaultQuota };
  }
  return { features, manualPriority: false, updatedAt: null };
}

export async function getAiControlConfig(): Promise<AiControlConfig> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_CACHE_MS) return configCache.config;
  let config = defaultConfig();
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row) {
      const parsed: unknown = JSON.parse(row.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const raw = parsed as Record<string, unknown>;
        const merged = defaultConfig();
        if (raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)) {
          for (const def of AI_FEATURES) {
            const val = (raw.features as Record<string, unknown>)[def.key];
            if (val && typeof val === "object" && !Array.isArray(val)) {
              const f = val as Record<string, unknown>;
              if (typeof f.enabled === "boolean") merged.features[def.key].enabled = f.enabled;
              if (
                f.quotaPerDay === null ||
                (typeof f.quotaPerDay === "number" && Number.isFinite(f.quotaPerDay) && f.quotaPerDay >= 0)
              ) {
                merged.features[def.key].quotaPerDay =
                  f.quotaPerDay === null ? null : Math.min(Math.floor(f.quotaPerDay as number), def.maxQuota);
              }
            }
          }
        }
        if (typeof raw.manualPriority === "boolean") merged.manualPriority = raw.manualPriority;
        if (typeof raw.updatedAt === "string") merged.updatedAt = raw.updatedAt;
        config = merged;
      }
    }
  } catch {
    config = defaultConfig();
  }
  configCache = { config, at: now };
  return config;
}

function invalidateConfig(): void {
  configCache = null;
}

export async function writeAiControl(
  patch: {
    features?: Record<string, Partial<AiFeatureConfig>>;
    manualPriority?: boolean;
  },
): Promise<AiControlConfig> {
  const current = await getAiControlConfig();
  const next: AiControlConfig = {
    features: { ...current.features },
    manualPriority: typeof patch.manualPriority === "boolean" ? patch.manualPriority : current.manualPriority,
    updatedAt: new Date().toISOString(),
  };
  if (patch.features) {
    for (const def of AI_FEATURES) {
      const p = patch.features[def.key];
      if (!p) continue;
      const cur = next.features[def.key];
      const item: AiFeatureConfig = { enabled: cur.enabled, quotaPerDay: cur.quotaPerDay };
      if (typeof p.enabled === "boolean") item.enabled = p.enabled;
      if (p.quotaPerDay === null || typeof p.quotaPerDay === "number") {
        item.quotaPerDay =
          p.quotaPerDay === null
            ? null
            : Math.min(Math.max(0, Math.floor(p.quotaPerDay)), def.maxQuota);
      }
      next.features[def.key] = item;
    }
  }
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });
  invalidateConfig();
  return next;
}

// ---- Hitungan pemakaian hari ini --------------------------------------------

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

let usageCache: { counts: Record<string, number>; at: number } | null = null;

async function usedTodayCounts(): Promise<Record<string, number>> {
  const now = Date.now();
  if (usageCache && now - usageCache.at < USAGE_CACHE_MS) return usageCache.counts;
  const rows = await db.aiJobLog.groupBy({
    by: ["feature"],
    where: { status: "OK", createdAt: { gte: startOfToday() } },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.feature] = row._count._all;
  usageCache = { counts, at: now };
  return counts;
}

// ---- Gate -------------------------------------------------------------------

export type AiGateResult = { allowed: boolean; reason?: string };

/**
 * Periksa apakah sebuah fitur AI boleh dijalankan SAAT INI.
 * TIDAK mencatat log — dipakai cron/poller yang mencoba berkala agar log tidak
 * penuh baris BLOCKED berulang.
 */
export async function aiGateCheck(feature: string): Promise<AiGateResult> {
  const def = aiFeatureDef(feature);
  if (!def) return { allowed: true }; // fitur tak terdaftar: fail-open agar tak merusak pemanggil lama

  const config = await getAiControlConfig();
  const fc = config.features[def.key];
  if (fc && !fc.enabled) {
    return {
      allowed: false,
      reason: `Fitur AI "${def.label}" dimatikan di Pusat Kendali AI.`,
    };
  }

  if (fc && fc.quotaPerDay != null) {
    const counts = await usedTodayCounts();
    const used = counts[def.key] ?? 0;
    if (used >= fc.quotaPerDay) {
      return {
        allowed: false,
        reason: `Kuota harian "${def.label}" terlampaui (${used}/${fc.quotaPerDay} hari ini).`,
      };
    }
  }

  if (def.priority === "background") {
    try {
      const save = saveModeInfo();
      if (save.active) {
        return {
          allowed: false,
          reason: `Mode Hemat aktif (${save.reason}) — tugas AI latar belakang ditunda sementara.`,
        };
      }
    } catch {
      // state belum siap — abaikan
    }
    const config2 = await getAiControlConfig();
    if (config2.manualPriority) {
      let waiting = 0;
      try {
        waiting = queueStats().waiting;
      } catch {
        waiting = 0;
      }
      if (waiting > 0) {
        return {
          allowed: false,
          reason: `Prioritas Aksi Admin aktif — ${waiting} tugas AI manual masih mengantre, tugas latar belakang ditunda.`,
        };
      }
    }
  }

  return { allowed: true };
}

/** Catat satu pemanggilan fitur AI ke AiJobLog. Tidak pernah melempar error. */
export async function recordAiJob(
  feature: string,
  opts: { actor?: string | null; status?: "OK" | "ERROR" | "BLOCKED"; durationMs?: number; detail?: string },
): Promise<void> {
  try {
    await db.aiJobLog.create({
      data: {
        feature,
        actor: opts.actor ?? null,
        status: opts.status ?? "OK",
        durationMs: Math.max(0, Math.min(3_600_000, Math.round(opts.durationMs ?? 0))),
        detail: opts.detail ? opts.detail.slice(0, 500) : null,
      },
    });
    usageCache = null; // kuota langsung reflektif
  } catch {
    // logging AI tidak boleh merusak fitur utama
  }
}

/**
 * Bungkus pemanggilan fitur AI: periksa gate (lempar AiGateError bila diblokir,
 * BLOCKED tercatat), jalankan, lalu catat OK/ERROR beserta durasi.
 */
export async function withAiGate<T>(
  feature: string,
  opts: { actor?: string | null; detailOk?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const def = aiFeatureDef(feature);
  const gate = await aiGateCheck(feature);
  if (!gate.allowed) {
    await recordAiJob(feature, {
      actor: opts.actor ?? null,
      status: "BLOCKED",
      detail: gate.reason,
    });
    throw new AiGateError(feature, gate.reason ?? "Fitur AI sedang tidak tersedia.");
  }
  const started = Date.now();
  try {
    const result = await fn();
    await recordAiJob(feature, {
      actor: opts.actor ?? null,
      status: "OK",
      durationMs: Date.now() - started,
      detail: opts.detailOk,
    });
    return result;
  } catch (error) {
    // AiGateError dari pemanggilan bersarang: jangan tumpuk log ERROR (sudah tercatat BLOCKED di dalam).
    if (error instanceof AiGateError) throw error;
    await recordAiJob(feature, {
      actor: opts.actor ?? null,
      status: "ERROR",
      durationMs: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// ---- Tampilan UI ------------------------------------------------------------

export async function getAiControlView(): Promise<AiControlView> {
  const config = await getAiControlConfig();
  const counts = await usedTodayCounts();
  let saveMode: AiControlView["saveMode"] = null;
  try {
    const info = saveModeInfo();
    saveMode = {
      active: info.active,
      reason: info.active ? info.reason : null,
      level: info.active ? info.source : null,
    };
  } catch {
    saveMode = null;
  }
  return {
    features: AI_FEATURES.map((def) => ({
      key: def.key,
      label: def.label,
      description: def.description,
      priority: def.priority,
      enabled: config.features[def.key]?.enabled ?? true,
      quotaPerDay: config.features[def.key]?.quotaPerDay ?? def.defaultQuota,
      usedToday: counts[def.key] ?? 0,
    })),
    manualPriority: config.manualPriority,
    saveMode,
    updatedAt: config.updatedAt,
  };
}

export async function getAiUsageView(days: number): Promise<AiUsageView> {
  const since = new Date();
  since.setDate(since.getDate() - Math.max(1, Math.min(60, days)));
  since.setHours(0, 0, 0, 0);

  const [rows, grouped] = await Promise.all([
    db.aiJobLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    db.aiJobLog.groupBy({
      by: ["feature", "status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ]);

  const perFeatureMap = new Map<string, { ok: number; error: number; blocked: number }>();
  const totals = { ok: 0, error: 0, blocked: 0, featuresUsed: 0 };
  const dailyMap = new Map<string, { ok: number; error: number; blocked: number }>();

  for (const g of grouped) {
    const bucket = perFeatureMap.get(g.feature) ?? { ok: 0, error: 0, blocked: 0 };
    const n = g._count._all;
    if (g.status === "OK") bucket.ok += n;
    else if (g.status === "ERROR") bucket.error += n;
    else bucket.blocked += n;
    perFeatureMap.set(g.feature, bucket);
  }

  // Deret harian dari seluruh baris dalam rentang (ringan utk SQLite skala ini).
  const dayKeys: string[] = [];
  for (let i = Math.max(1, Math.min(60, days)) - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dayKeys.push(d.toISOString().slice(0, 10));
  }
  for (const key of dayKeys) dailyMap.set(key, { ok: 0, error: 0, blocked: 0 });

  const olderThan300 = await db.aiJobLog.count({ where: { createdAt: { gte: since } } });
  const allRows =
    olderThan300 > rows.length
      ? await db.aiJobLog.findMany({
          where: { createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          take: 2000,
        })
      : rows;
  for (const r of allRows) {
    const key = r.createdAt.toISOString().slice(0, 10);
    const day = dailyMap.get(key);
    if (!day) continue;
    if (r.status === "OK") day.ok += 1;
    else if (r.status === "ERROR") day.error += 1;
    else day.blocked += 1;
  }

  for (const def of AI_FEATURES) {
    const b = perFeatureMap.get(def.key);
    if (!b) continue;
    if (b.ok > 0) totals.featuresUsed += 1;
  }
  for (const b of perFeatureMap.values()) {
    totals.ok += b.ok;
    totals.error += b.error;
    totals.blocked += b.blocked;
  }

  return {
    totals,
    perFeature: AI_FEATURES.filter((d) => perFeatureMap.has(d.key)).map((def) => ({
      feature: def.key,
      label: def.label,
      ...(perFeatureMap.get(def.key) as { ok: number; error: number; blocked: number }),
    })),
    daily: dayKeys.map((date) => ({ date, ...(dailyMap.get(date) as { ok: number; error: number; blocked: number }) })),
    recent: rows.slice(0, 60).map((r) => ({
      id: r.id,
      feature: r.feature,
      featureLabel: aiFeatureDef(r.feature)?.label ?? r.feature,
      actor: r.actor,
      status: r.status,
      durationMs: r.durationMs,
      detail: r.detail,
      createdAt: r.createdAt.toISOString(),
    })),
    days: Math.max(1, Math.min(60, days)),
  };
}
