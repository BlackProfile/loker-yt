// NR41-SEC-B (L32) — notifikasi kegagalan/tertundanya backup otomatis (SERVER-ONLY).
// verifyAndNotifyBackups(): dipanggil di akhir cron maintenance.
// - Backup sehat  : file terbaru di backups/auto ada, umur <= 30 jam, ukuran >= 2 KB.
// - Backup gagal  : tidak ada file / terlalu tua / terlalu kecil → notifikasi in-app
//   (pushNotification) + email ke OWNER (queueEmail), digate:
//     - Setting "backup_notify_enabled" (default true)
//     - Setting "backup_alert_sent_at" — maks 1 alert per 24 jam (anti-spam)
// - Backup sehat kembali → flag alert dikosongkan.
// Tidak pernah melempar error (dipanggil di jalankan cron yang tidak boleh gagal).
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { pushNotification, queueEmail } from "@/lib/notify";

const BACKUP_MAX_AGE_HOURS = 30;
const BACKUP_MIN_BYTES = 2048;
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // maks 1 alert / 24 jam

async function readBoolSetting(key: string, fallback: boolean): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (!row) return fallback;
    const parsed: unknown = JSON.parse(row.value);
    return typeof parsed === "boolean" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function readIsoSetting(key: string): Promise<number | null> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "string") return null;
    const ts = Date.parse(parsed);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(value) },
    create: { key, value: JSON.stringify(value) },
  });
}

async function clearSetting(key: string): Promise<void> {
  await db.setting.deleteMany({ where: { key } }).catch(() => undefined);
}

/** Info backup terbaru di backups/auto. Null bila tidak ada. */
function latestBackup(): { name: string; ageHours: number; size: number } | null {
  try {
    const dir = path.resolve(process.cwd(), "backups", "auto");
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir)
      .filter((name) => /^lumina-[A-Za-z0-9._-]+\.db$/.test(name))
      .map((name) => {
        try {
          const st = statSync(path.join(dir, name));
          return { name, mtime: st.mtime.getTime(), size: st.size };
        } catch {
          return null;
        }
      })
      .filter((f): f is { name: string; mtime: number; size: number } => f !== null)
      .sort((a, b) => b.mtime - a.mtime);
    const latest = files[0];
    if (!latest) return null;
    return {
      name: latest.name,
      ageHours: (Date.now() - latest.mtime) / (60 * 60 * 1000),
      size: latest.size,
    };
  } catch {
    return null;
  }
}

/** Email OWNER aktif pertama (tujuan alert backup). */
async function ownerEmail(): Promise<string | null> {
  try {
    const owner = await db.adminUser.findFirst({
      where: { role: "OWNER", isActive: true },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
    return owner?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Verifikasi kesehatan backup otomatis + kirim notifikasi bila gagal/tertunda.
 * Dipanggil di akhir cron maintenance — tidak pernah melempar error.
 */
export async function verifyAndNotifyBackups(): Promise<void> {
  try {
    const backup = latestBackup();
    const healthy =
      backup !== null && backup.ageHours <= BACKUP_MAX_AGE_HOURS && backup.size >= BACKUP_MIN_BYTES;

    // Backup sehat → kosongkan penanda alert (agar alert berikutnya bisa terkirim lagi).
    if (healthy) {
      await clearSetting("backup_alert_sent_at");
      return;
    }

    // Digate flag aktif/nonaktif (default aktif).
    const enabled = await readBoolSetting("backup_notify_enabled", true);
    if (!enabled) return;

    // Anti-spam: maks 1 alert per 24 jam.
    const lastSentAt = await readIsoSetting("backup_alert_sent_at");
    if (lastSentAt !== null && Date.now() - lastSentAt < ALERT_COOLDOWN_MS) return;

    const reason =
      backup === null
        ? "Tidak ada file backup ditemukan di backups/auto."
        : backup.ageHours > BACKUP_MAX_AGE_HOURS
          ? `Backup terakhir (${backup.name}) berumur ${Math.round(backup.ageHours)} jam (batas ${BACKUP_MAX_AGE_HOURS} jam).`
          : `Backup terakhir (${backup.name}) berukuran ${backup.size} byte (minimum ${BACKUP_MIN_BYTES} byte).`;

    const title = "Backup gagal/tertunda";
    const detail = `${reason} Backup otomatis harian tidak sehat — periksa cron maintenance.`;

    // Notifikasi in-app untuk ikon lonceng admin.
    await pushNotification({ title, body: detail, category: "SYSTEM" });

    // Email ke OWNER (arsip di EmailOutbox bila SMTP tidak terpasang).
    const to = await ownerEmail();
    if (to) {
      await queueEmail({
        toEmail: to,
        subject: title,
        body: `${detail}\n\nPesan otomatis dari sistem perawatan situs.`,
        kind: "SYSTEM",
      });
    }

    // Tandai waktu alert terakhir (anti-spam 24 jam).
    await writeSetting("backup_alert_sent_at", new Date().toISOString());
  } catch (error) {
    console.error("[backup-notify] verifyAndNotifyBackups gagal:", error);
  }
}
