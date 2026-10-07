// NR-41 G12 — Arsip sebelum purge retensi (SERVER-ONLY).
// archiveBeforePurge() menyalin ringkasan lamaran yang AKAN dihapus oleh job
// retensi (kriteria persis sama dengan /api/cron/maintenance: Setting
// "retention" {enabled, days} — REJECTED atau terarsip, lebih tua dari `days`)
// ke file JSON `backups/purged/YYYY-MM-DD.json` (append bila file sudah ada),
// lalu merotasi folder (maks 12 file terbaru).
// DIPANGGIL DARI: cron maintenance SEBELUM deleteMany (wiring oleh SEC-B —
// koordinasi via worklog). Lib ini tidak menghapus apa pun.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

const RETENTION_KEEP_FILES = 12; // rotasi maks 12 file arsip purge
const DEFAULT_RETENTION_DAYS = 365; // sama dengan cron maintenance
const PURGE_BATCH = 500; // sama dengan cron maintenance (take 500)

/** Direktori arsip purge (relatif ke project root). */
function purgedDir(): string {
  return path.resolve(process.cwd(), "backups", "purged");
}

/** Tanggal lokal hari ini format YYYY-MM-DD (sama dengan pola backup harian). */
function todayDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type PurgedApplication = {
  id: string;
  name: string;
  email: string;
  phone: string;
  position: string | null;
  createdAt: string;
  status: string;
  trackingCode: string | null;
};

/**
 * Baca Setting "retention" secara aman (pola yang sama dengan cron maintenance).
 * Return { enabled, days }.
 */
async function readRetentionSetting(): Promise<{ enabled: boolean; days: number }> {
  try {
    const row = await db.setting.findUnique({ where: { key: "retention" } });
    if (!row) return { enabled: false, days: DEFAULT_RETENTION_DAYS };
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { enabled: false, days: DEFAULT_RETENTION_DAYS };
    }
    const raw = parsed as Record<string, unknown>;
    const daysRaw = Number(raw.days);
    const days =
      Number.isFinite(daysRaw) && daysRaw > 0 ? daysRaw : DEFAULT_RETENTION_DAYS;
    return { enabled: raw.enabled === true, days };
  } catch {
    return { enabled: false, days: DEFAULT_RETENTION_DAYS };
  }
}

/**
 * Tulis (append) ringkasan lamaran ke backups/purged/YYYY-MM-DD.json lalu
 * rotasi maks RETENTION_KEEP_FILES file terbaru. Tidak pernah melempar error.
 */
async function appendArchive(entries: PurgedApplication[], now: Date): Promise<number> {
  const dir = purgedDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${todayDateString(now)}.json`);

  let current: PurgedApplication[] = [];
  if (existsSync(file)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) current = parsed as PurgedApplication[];
    } catch {
      // file rusak — mulai ulang dengan array kosong
      current = [];
    }
  }

  // Dedupe by id (append aman dijalankan ulang di hari yang sama).
  const seen = new Set(current.map((entry) => entry.id));
  let added = 0;
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    current.push(entry);
    seen.add(entry.id);
    added += 1;
  }

  writeFileSync(file, JSON.stringify(current, null, 2), "utf8");

  // Rotasi: simpan hanya 12 file terbaru (nama YYYY-MM-DD = urut waktu).
  try {
    const files = readdirSync(dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .sort((a, b) => b.localeCompare(a));
    for (const oldFile of files.slice(RETENTION_KEEP_FILES)) {
      try {
        unlinkSync(path.join(dir, oldFile));
      } catch {
        // gagal hapus satu file lama — abaikan
      }
    }
  } catch {
    // rotasi gagal — arsip utama tetap tersimpan
  }

  return added;
}

export type ArchiveBeforePurgeResult = {
  matched: number; // jumlah lamaran yang memenuhi kriteria purge
  archived: number; // jumlah entri yang ditulis (dedupe by id)
  rotated: number; // jumlah file lama yang dibuang saat rotasi
  file: string | null; // nama file arsip hari ini (bila ada entri ditulis)
  retentionEnabled: boolean;
};

/**
 * Cari lamaran yang akan di-purge oleh retensi dan tulis arsip ringkasnya.
 * KRITERIA (duplikasi persis dari /api/cron/maintenance job "RETENSI"):
 *   deletedAt null AND createdAt < now - retentionDays AND
 *   (status REJECTED OR archivedAt != null), take 500 — batch yang sama.
 * Tidak pernah melempar error (job cron utama tidak boleh gagal karenanya).
 */
export async function archiveBeforePurge(now: Date = new Date()): Promise<ArchiveBeforePurgeResult> {
  const result: ArchiveBeforePurgeResult = {
    matched: 0,
    archived: 0,
    rotated: 0,
    file: null,
    retentionEnabled: false,
  };

  try {
    const retention = await readRetentionSetting();
    result.retentionEnabled = retention.enabled;
    if (!retention.enabled) return result;

    const cutoff = new Date(now.getTime() - retention.days * 24 * 60 * 60 * 1000);
    const expired = await db.application.findMany({
      where: {
        deletedAt: null,
        createdAt: { lt: cutoff },
        OR: [{ status: "REJECTED" }, { archivedAt: { not: null } }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        trackingCode: true,
        createdAt: true,
        position: { select: { title: true } },
      },
      take: PURGE_BATCH,
    });
    result.matched = expired.length;
    if (expired.length === 0) return result;

    const entries: PurgedApplication[] = expired.map((app) => ({
      id: app.id,
      name: app.name,
      email: app.email,
      phone: app.phone,
      position: app.position?.title ?? null,
      createdAt: app.createdAt.toISOString(),
      status: app.status,
      trackingCode: app.trackingCode,
    }));

    result.archived = await appendArchive(entries, now);
    result.file = `${todayDateString(now)}.json`;
  } catch (error) {
    console.error("[purge-archive] archiveBeforePurge gagal:", error);
  }

  return result;
}
