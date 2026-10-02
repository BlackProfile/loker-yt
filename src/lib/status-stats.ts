// Statistik harian halaman Cek Status (NR-15) — penghitung {date, checks, logins}.
// Disimpan pada Setting key TERPISAH "status_check_stats" (bukan blob "site"):
// blob "site" ditulis ulang penuh oleh banyak komponen (cron watermark, wizard bot,
// langganan Telegram) sehingga read-modify-write pada blob bersama bisa saling
// menimpa (counter hilang). Key terpisah membuat penghitung bebas konflik penulis.
// Baca legacy: bila key terpisah kosong, fallback ke site.statusCheckStats lama.
import { db } from "@/lib/db";

export type StatusCheckStats = { date: string; checks: number; logins: number };

const SETTING_KEY = "status_check_stats";

/** Kunci tanggal hari ini menurut zona Bangkok (WIB, UTC+7). */
export function bangkokDateKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

/** Normalisasi nilai mentah menjadi statistik valid (tanggal beda = reset). */
function normalize(raw: unknown, today: string): StatusCheckStats {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj.date === today) {
      return {
        date: today,
        checks: typeof obj.checks === "number" && Number.isFinite(obj.checks) ? Math.max(0, Math.floor(obj.checks)) : 0,
        logins: typeof obj.logins === "number" && Number.isFinite(obj.logins) ? Math.max(0, Math.floor(obj.logins)) : 0,
      };
    }
  }
  return { date: today, checks: 0, logins: 0 };
}

/** Baca statistik hari ini (reset otomatis saat tanggal berbeda). */
export async function readStatusCheckStats(): Promise<StatusCheckStats> {
  const today = bangkokDateKey();
  try {
    const setting = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (setting) return normalize(safeParse(setting.value), today);
    // Legacy (awal NR-15-b): nilai lama sempat disimpan di blob "site".
    const siteSetting = await db.setting.findUnique({ where: { key: "site" } });
    if (siteSetting) {
      const parsed = safeParse(siteSetting.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalize((parsed as Record<string, unknown>).statusCheckStats, today);
      }
    }
  } catch {
    // DB gagal — mulai dari nol.
  }
  return { date: today, checks: 0, logins: 0 };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Tambah penghitung harian ("checks" = bukaan halaman status, "logins" = login
 * track-auth sukses). Read-modify-write pada key khusus; aman dipanggil
 * fire-and-forget: tidak pernah melempar error dan tidak menimpa field lain.
 */
export async function bumpStatusCheckStats(field: "checks" | "logins"): Promise<void> {
  try {
    const today = bangkokDateKey();
    const current = await readStatusCheckStats();
    const next: StatusCheckStats =
      current.date === today
        ? { ...current, [field]: current[field] + 1 }
        : { date: today, checks: 0, logins: 0, [field]: 1 };

    await db.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: SETTING_KEY, value: JSON.stringify(next) },
    });
  } catch {
    // statistik kosmetik — kegagalan diabaikan
  }
}
