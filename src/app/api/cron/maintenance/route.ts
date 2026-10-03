// GET/POST /api/cron/maintenance — tugas perawatan data (dipanggil realtime-service ATAU
// manual oleh admin via tombol "Jalankan Sekarang"):
//   0. BACKUP HARIAN (idempoten per hari, NR-19-b): bila belum ada file
//      backups/auto/lumina-YYYY-MM-DD.db -> "VACUUM INTO" salinan database
//      (rotasi: simpan 7 file terbaru) + log DAILY_BACKUP + notifikasi SYSTEM.
//   1. AUTO-ARSIP (Setting "maintenance".autoArchiveEnabled): lamaran yang tidak berada di
//      tahap final dan stagnan > autoArchiveDays hari -> archivedAt diisi + log ARCHIVE +
//      webhook "application.archived" (sekali per eksekusi).
//   2. RETENSI (Setting "retention".enabled): lamaran REJECTED / terarsip lebih tua dari
//      `days` hari sejak dibuat -> dihapus permanen (relasi ikut via cascade) + log RETENTION.
// Guard: maksimal 1x per jam (dicek dari ActivityLog MAINTENANCE terakhir).
// Auth: header x-realtime-secret (pola cron /api/cron/reminders) ATAU sesi admin login.
import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { emitWebhook } from "@/lib/webhooks";

export const dynamic = "force-dynamic";

// Harus sama dengan yang dipakai realtime-server.ts & mini-service (pola /api/cron/reminders).
const REALTIME_SECRET = process.env.REALTIME_SECRET ?? "lumina-realtime-secret";

const FINAL_STATUSES = ["REJECTED", "ACCEPTED", "HIRED"];
const MIN_INTERVAL_MS = 60 * 60 * 1000; // maks 1x per jam

const DEFAULT_AUTO_ARCHIVE_DAYS = 90;
const DEFAULT_RETENTION_DAYS = 365;

// --- Backup otomatis harian (NR-19-b) ---
const BACKUP_KEEP = 7; // jumlah file backup yang disimpan
const BACKUP_FILE_RE = /^lumina-[A-Za-z0-9._-]+\.db$/;

/** Tanggal lokal hari ini dalam format YYYY-MM-DD (nama file aman regex). */
function todayDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Direktori galeri backup otomatis (relatif ke project root). */
function backupsAutoDir(): string {
  return path.resolve(process.cwd(), "backups", "auto");
}

type DailyBackupResult = {
  created: boolean;
  file: string | null;
  rotated: number;
  error?: string;
};

/**
 * Backup database harian via "VACUUM INTO" — idempoten per hari (cek file dulu).
 * Path file TIDAK bisa diparameterkan untuk VACUUM INTO, sehingga filename dibangun
 * sendiri dari tanggal (hanya [A-Za-z0-9._-]) dan divalidasi ketat sebelum interpolasi.
 * Gagal backup tidak menggagalkan job perawatan lain (error ditelan + dilaporkan).
 */
async function runDailyBackup(now: Date): Promise<DailyBackupResult> {
  try {
    const fileName = `lumina-${todayDateString(now)}.db`;
    if (!BACKUP_FILE_RE.test(fileName)) {
      // Tetap guard ekstra — tidak pernah seharusnya gagal.
      return { created: false, file: null, rotated: 0, error: "Nama file backup tidak valid." };
    }
    const dir = backupsAutoDir();
    mkdirSync(dir, { recursive: true });
    const target = path.join(dir, fileName);

    // Idempoten: file hari ini sudah ada -> lewati.
    if (existsSync(target)) {
      return { created: false, file: fileName, rotated: 0 };
    }

    // VACUUM INTO menolak menimpa file yang ada — aman karena dicek existsSync dulu.
    await db.$executeRawUnsafe(`VACUUM INTO '${target}'`);

    // Rotasi: simpan hanya BACKUP_KEEP file terbaru (nama YYYY-MM-DD = urut waktu).
    let rotated = 0;
    const files = readdirSync(dir)
      .filter((name) => BACKUP_FILE_RE.test(name))
      .sort((a, b) => b.localeCompare(a));
    for (const oldFile of files.slice(BACKUP_KEEP)) {
      try {
        unlinkSync(path.join(dir, oldFile));
        rotated += 1;
      } catch {
        // gagal hapus satu file lama — abaikan
      }
    }

    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: "Sistem",
        action: "DAILY_BACKUP",
        detail: `Backup otomatis database dibuat: backups/auto/${fileName}${rotated > 0 ? ` (${rotated} file lama dirotasi)` : ""}.`,
      },
    });
    await db.notificationItem.create({
      data: {
        title: "Backup otomatis dibuat",
        body: `Salinan database harian tersimpan di backups/auto/${fileName}.`,
        category: "SYSTEM",
      },
    });

    return { created: true, file: fileName, rotated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[maintenance] backup harian gagal:", error);
    return { created: false, file: null, rotated: 0, error: message };
  }
}

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

async function runMaintenance() {
  const now = new Date();

  // 0) BACKUP HARIAN — dijalankan sebelum guard 1x/jam agar tetap idempoten per hari
  //    walaupun perawatan arsip/retensi dilewati guard.
  const dailyBackup = await runDailyBackup(now);

  // GUARD: maksimal 1x per jam — lihat ActivityLog MAINTENANCE terakhir.
  const lastRun = await db.activityLog.findFirst({
    where: { action: "MAINTENANCE", applicationId: null },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (lastRun && now.getTime() - lastRun.createdAt.getTime() < MIN_INTERVAL_MS) {
    const waitMs = MIN_INTERVAL_MS - (now.getTime() - lastRun.createdAt.getTime());
    return {
      skipped: true as const,
      body: {
        ok: false,
        skipped: true,
        message: `Perawatan terakhir dijalankan pukul ${lastRun.createdAt.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}. Coba lagi dalam ${Math.ceil(waitMs / 60000)} menit.`,
        archived: 0,
        deleted: 0,
        dailyBackup,
        ranAt: now.toISOString(),
      },
    };
  }

  const [maintenanceRaw, retentionRaw] = await Promise.all([
    readJsonSetting("maintenance"),
    readJsonSetting("retention"),
  ]);

  const autoArchiveEnabled = maintenanceRaw.autoArchiveEnabled === true;
  const autoArchiveDaysRaw = Number(maintenanceRaw.autoArchiveDays);
  const autoArchiveDays = Number.isFinite(autoArchiveDaysRaw) && autoArchiveDaysRaw > 0
    ? autoArchiveDaysRaw
    : DEFAULT_AUTO_ARCHIVE_DAYS;

  const retentionEnabled = retentionRaw.enabled === true;
  const retentionDaysRaw = Number(retentionRaw.days);
  const retentionDays = Number.isFinite(retentionDaysRaw) && retentionDaysRaw > 0
    ? retentionDaysRaw
    : DEFAULT_RETENTION_DAYS;

  let archived = 0;
  let deleted = 0;

  // 1) AUTO-ARSIP: lamaran stagnan di tahap non-final -> archivedAt diisi.
  if (autoArchiveEnabled) {
    const cutoff = new Date(now.getTime() - autoArchiveDays * 24 * 60 * 60 * 1000);
    const stale = await db.application.findMany({
      where: {
        deletedAt: null,
        archivedAt: null,
        status: { notIn: FINAL_STATUSES },
        updatedAt: { lt: cutoff },
      },
      select: { id: true, name: true, trackingCode: true },
      take: 500,
    });
    for (const app of stale) {
      await db.application.update({
        where: { id: app.id },
        data: { archivedAt: now },
      });
      await db.activityLog.create({
        data: {
          applicationId: app.id,
          actor: "Sistem",
          action: "ARCHIVE",
          detail: `Arsip otomatis: tidak ada aktivitas ${autoArchiveDays} hari`,
        },
      });
      archived += 1;
    }
    if (archived > 0) {
      // Webhook sekali per eksekusi dengan ringkasan jumlah.
      void emitWebhook("application.archived", { count: archived });
    }
  }

  // 2) RETENSI: lamaran ditolak / terarsip yang melewati batas umur -> hapus permanen.
  if (retentionEnabled) {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const expired = await db.application.findMany({
      where: {
        deletedAt: null,
        createdAt: { lt: cutoff },
        OR: [{ status: "REJECTED" }, { archivedAt: { not: null } }],
      },
      select: { id: true, name: true, trackingCode: true },
      take: 500,
    });
    for (const app of expired) {
      await db.application.delete({ where: { id: app.id } }); // relasi ikut via cascade
      deleted += 1;
    }
    if (deleted > 0) {
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: "Sistem",
          action: "RETENTION",
          detail: `Retensi data: ${deleted} lamaran (ditolak/diarsip) lebih tua dari ${retentionDays} hari dihapus permanen`,
        },
      });
    }
  }

  // Penanda eksekusi (dipakai guard 1x/jam).
  await db.activityLog.create({
    data: {
      applicationId: null,
      actor: "Sistem",
      action: "MAINTENANCE",
      detail: `Perawatan data dijalankan: ${archived} lamaran diarsipkan, ${deleted} lamaran dihapus (retensi).`,
    },
  });

  if (archived > 0 || deleted > 0) {
    void emitRealtime(REALTIME_EVENTS.applications);
  }

  return {
    skipped: false as const,
    body: { ok: true, archived, deleted, dailyBackup, ranAt: now.toISOString() },
  };
}

async function handle(req: NextRequest) {
  try {
    // Auth: pola cron (x-realtime-secret) ATAU sesi admin OWNER (tombol manual).
    const secret = req.headers.get("x-realtime-secret");
    const viaCron = Boolean(REALTIME_SECRET) && secret === REALTIME_SECRET;
    if (!viaCron) {
      const session = await getSession();
      if (!session || session.role !== "OWNER") {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
    }

    const result = await runMaintenance();
    return NextResponse.json(result.body);
  } catch (error) {
    console.error("[POST /api/cron/maintenance]", error);
    return NextResponse.json({ error: "Gagal menjalankan perawatan data." }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
