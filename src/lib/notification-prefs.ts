// SERVER-ONLY — NR46: preferensi notifikasi per pengguna (Paket C).
// Setting "notify_prefs" memetakan userId -> { categories, silentFrom, silentTo }.
// Dipakai oleh /api/admin/notifications (penyaringan bacaan) dan route preferensi.
import { db } from "@/lib/db";

export const NOTIFY_CATEGORIES = ["APPLICATION", "INTERVIEW", "OFFER", "SYSTEM", "LOGIN"] as const;
export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number];

export type NotifyPrefs = {
  categories: Record<NotifyCategory, boolean>;
  silentFrom: number | null; // jam 0-23, null = nonaktif
  silentTo: number | null;
};

export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = {
  categories: {
    APPLICATION: true,
    INTERVIEW: true,
    OFFER: true,
    SYSTEM: true,
    LOGIN: true,
  },
  silentFrom: null,
  silentTo: null,
};

const SETTING_KEY = "notify_prefs";
const CACHE_MS = 30_000;
const cache = new Map<string, { prefs: NotifyPrefs; at: number }>();

function clampHour(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(23, Math.max(0, Math.round(n)));
}

function sanitize(raw: Record<string, unknown>): NotifyPrefs {
  const catsRaw = raw.categories;
  const categories = { ...DEFAULT_NOTIFY_PREFS.categories };
  if (catsRaw && typeof catsRaw === "object" && !Array.isArray(catsRaw)) {
    for (const cat of NOTIFY_CATEGORIES) {
      const val = (catsRaw as Record<string, unknown>)[cat];
      if (typeof val === "boolean") categories[cat] = val;
    }
  }
  const silentFrom = clampHour(raw.silentFrom);
  const silentTo = clampHour(raw.silentTo);
  const bothNull = silentFrom == null && silentTo == null;
  return {
    categories,
    silentFrom: bothNull ? null : silentFrom,
    silentTo: bothNull ? null : silentTo,
  };
}

/** Baca preferensi satu pengguna (bawaan bila belum pernah diatur). Tidak melempar. */
export async function readUserNotifyPrefs(userId: string): Promise<NotifyPrefs> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.prefs;
  let prefs: NotifyPrefs = { ...DEFAULT_NOTIFY_PREFS, categories: { ...DEFAULT_NOTIFY_PREFS.categories } };
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row) {
      const parsed: unknown = JSON.parse(row.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const map = parsed as Record<string, Record<string, unknown>>;
        const mine = map[userId];
        if (mine && typeof mine === "object") prefs = sanitize(mine);
      }
    }
  } catch {
    // bawaan
  }
  cache.set(userId, { prefs, at: Date.now() });
  return prefs;
}

/** Simpan preferensi satu pengguna. */
export async function writeUserNotifyPrefs(userId: string, raw: Record<string, unknown>): Promise<NotifyPrefs> {
  const prefs = sanitize(raw);
  let map: Record<string, Record<string, unknown>> = {};
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row) {
      const parsed: unknown = JSON.parse(row.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        map = parsed as Record<string, Record<string, unknown>>;
      }
    }
  } catch {
    map = {};
  }
  map[userId] = prefs as unknown as Record<string, unknown>;
  const value = JSON.stringify(map);
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  cache.set(userId, { prefs, at: Date.now() });
  return prefs;
}

/** Apakah jam sekarang berada di jendela senyap preferensi (dukung lintas tengah malam). */
export function isInSilentHours(prefs: NotifyPrefs, date: Date = new Date()): boolean {
  if (prefs.silentFrom == null || prefs.silentTo == null) return false;
  if (prefs.silentFrom === prefs.silentTo) return true; // 24 jam
  const h = date.getHours();
  if (prefs.silentFrom < prefs.silentTo) return h >= prefs.silentFrom && h < prefs.silentTo;
  return h >= prefs.silentFrom || h < prefs.silentTo;
}

/**
 * Kategori yang BOLEH tampil bagi pengguna pada waktu ini:
 - kategori yang dimatikan user tetap disembunyikan;
 - saat jam senyap, hanya SYSTEM (kesehatan/sistem) yang tetap tampil.
 */
export async function allowedCategoriesFor(userId: string, date: Date = new Date()): Promise<Set<string>> {
  const prefs = await readUserNotifyPrefs(userId);
  const allowed = new Set<string>(
    NOTIFY_CATEGORIES.filter((c) => prefs.categories[c]),
  );
  if (isInSilentHours(prefs, date)) {
    for (const c of NOTIFY_CATEGORIES) {
      if (c !== "SYSTEM") allowed.delete(c);
    }
  }
  return allowed;
}

export function invalidateNotifyPrefsCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}
