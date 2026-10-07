// NR41-SEC-B (L31) — GET /api/health — health endpoint PUBLIK, TANPA PII.
// Mengembalikan SystemHealth (src/lib/types.ts): db, backup, email queue, cron,
// disk, error ring, uptime. SELALU 200 — komponen gagal ditandai ok:false per bagian.
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getErrorRing } from "@/lib/error-ring";
import type { SystemHealth } from "@/lib/types";

export const dynamic = "force-dynamic";

// Kriteria backup sehat (sama dengan lib/backup-notify.ts): ada, umur <= 30 jam, ukuran >= 2 KB.
const BACKUP_MAX_AGE_HOURS = 30;
const BACKUP_MIN_BYTES = 2048;

const REMINDER_ACTIONS = [
  "INTERVIEW_REMINDER",
  "OFFER_REMIND_H1",
  "OFFER_EXPIRED",
  "INTERVIEW_NO_SHOW",
  "WEEKLY_DIGEST",
  "FOLLOWUP_REMIND",
  "PROBATION_DUE",
];

/** Ukuran total folder secara rekursif ringan (maks 2 tingkat, aman terhadap error). */
function dirBytes(dir: string, depth: number = 1): number {
  try {
    if (!existsSync(dir)) return 0;
    let total = 0;
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      try {
        const st = statSync(p);
        if (st.isFile()) total += st.size;
        else if (st.isDirectory() && depth > 0) total += dirBytes(p, depth - 1);
      } catch {
        // file hilang di antara readdir & stat — abaikan
      }
    }
    return total;
  } catch {
    return 0;
  }
}

type BackupInfo = {
  ok: boolean;
  latestAt: string | null;
  latestFile: string | null;
  ageHours: number | null;
};

function readBackupInfo(now: Date): BackupInfo {
  try {
    const dir = path.resolve(process.cwd(), "backups", "auto");
    if (!existsSync(dir)) {
      return { ok: false, latestAt: null, latestFile: null, ageHours: null };
    }
    const files = readdirSync(dir)
      .filter((name) => /^lumina-[A-Za-z0-9._-]+\.db$/.test(name))
      .map((name) => {
        try {
          const st = statSync(path.join(dir, name));
          return { name, mtime: st.mtime, size: st.size };
        } catch {
          return null;
        }
      })
      .filter((f): f is { name: string; mtime: Date; size: number } => f !== null)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

    const latest = files[0];
    if (!latest) {
      return { ok: false, latestAt: null, latestFile: null, ageHours: null };
    }
    const ageHours = (now.getTime() - latest.mtime.getTime()) / (60 * 60 * 1000);
    const ok = latest.size >= BACKUP_MIN_BYTES && ageHours <= BACKUP_MAX_AGE_HOURS;
    return {
      ok,
      latestAt: latest.mtime.toISOString(),
      latestFile: latest.name,
      ageHours: Math.round(ageHours * 10) / 10,
    };
  } catch {
    return { ok: false, latestAt: null, latestFile: null, ageHours: null };
  }
}

export async function GET() {
  const now = new Date();
  const checkedAt = now.toISOString();

  // --- DB: SELECT 1 + hitung lamaran + latensi ---
  let dbOk = true;
  let applicationCount = 0;
  let latencyMs = 0;
  try {
    const t0 = Date.now();
    await db.$queryRaw`SELECT 1`;
    applicationCount = await db.application.count();
    latencyMs = Date.now() - t0;
  } catch {
    dbOk = false;
  }

  // --- Backup otomatis ---
  const backup = readBackupInfo(now);

  // --- Antrian email (tanpa alamat mentah — hanya hitungan) ---
  let queued = 0;
  let failed = 0;
  let sentToday = 0;
  try {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    [queued, failed, sentToday] = await Promise.all([
      db.emailOutbox.count({ where: { status: "QUEUED" } }),
      db.emailOutbox.count({ where: { status: "FAILED" } }),
      db.emailOutbox.count({ where: { status: "SENT", sentAt: { gte: dayStart } } }),
    ]);
  } catch {
    // hitungan tetap 0 bila gagal
  }

  // --- Cron: perawatan terakhir & reminder terakhir ---
  let lastMaintenanceAt: string | null = null;
  let lastRemindersAt: string | null = null;
  try {
    const [maintenance, reminders] = await Promise.all([
      db.activityLog.findFirst({
        where: { action: "MAINTENANCE", applicationId: null },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      db.activityLog.findFirst({
        where: { action: { in: REMINDER_ACTIONS } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    lastMaintenanceAt = maintenance?.createdAt.toISOString() ?? null;
    lastRemindersAt = reminders?.createdAt.toISOString() ?? null;
  } catch {
    // diam — null
  }

  // --- Disk: db + uploads + backups (ringan, tanpa PII) ---
  let dbBytes = 0;
  let uploadsBytes = 0;
  let backupsBytes = 0;
  try {
    const dbPath = path.resolve(process.cwd(), "db", "custom.db");
    if (existsSync(dbPath)) dbBytes = statSync(dbPath).size;
    uploadsBytes = dirBytes(path.resolve(process.cwd(), "uploads"));
    backupsBytes = dirBytes(path.resolve(process.cwd(), "backups"));
  } catch {
    // diam — 0
  }

  // --- Error ring (jumlah + error terakhir, dipotong 500 char) ---
  let recent = 0;
  let lastError: string | null = null;
  try {
    const ring = getErrorRing();
    recent = ring.length;
    lastError = ring.length > 0 ? ring[ring.length - 1].msg : null;
  } catch {
    // diam
  }

  const health: SystemHealth = {
    ok: dbOk && backup.ok,
    uptimeSec: Math.floor(process.uptime()),
    db: { ok: dbOk, applicationCount, latencyMs },
    backup,
    email: { queued, failed, sentToday },
    cron: { lastMaintenanceAt, lastRemindersAt },
    disk: { dbBytes, uploadsBytes, backupsBytes },
    errors: { recent, lastError },
    checkedAt,
  };

  // SELALU 200 — status tiap komponen ada di dalam body.
  return NextResponse.json(health);
}
