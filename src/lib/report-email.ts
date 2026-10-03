// SERVER-ONLY — Laporan email terjadwal (NR-19 ide 1).
//
// buildReportEmail() mengumpulkan ringkasan pipeline dari DB dan menyusun isi
// email (teks rapi + HTML sederhana, bahasa Indonesia, tanpa emoji) untuk
// EmailOutbox. runScheduledReportEmail() dipanggil cron /api/cron/reminders:
// TIDAK mengirim via SMTP — hanya membuat baris EmailOutbox berstatus QUEUED
// (pipeline outbox existing yang menangani pengiriman/kirim ulang manual).
import { db } from "@/lib/db";
import { pushNotification } from "@/lib/notify";
import { isBuiltInStage } from "@/lib/stages";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

export type ReportEmailVariant = "WEEKLY" | "MONTHLY";

export type ReportEmailData = {
  subject: string;
  periodLabel: string;
  generatedAt: string;
  windowDays: number;
  /** Total kandidat (belum terhapus) per bucket tahap bawaan + "Lainnya". */
  statusCounts: { status: ApplicationStatus | "OTHER"; label: string; count: number }[];
  newApplicationsInWindow: number;
  topPositions: { title: string; count: number }[];
  interviewsNext7d: number;
  pendingOffers: number;
  /** Isi email versi teks rapi — dipakai sebagai body EmailOutbox (SMTP text). */
  bodyText: string;
  /** Isi email versi HTML sederhana — tersedia bila pipeline HTML dibutuhkan. */
  bodyHtml: string;
};

type ReportSchedule = { weeklyEnabled: boolean; monthlyEnabled: boolean };

const SETTING_KEY = "reportEmailSchedule";
const DEFAULT_SCHEDULE: ReportSchedule = { weeklyEnabled: true, monthlyEnabled: true };

/** Baca Setting "reportEmailSchedule" secara aman (JSON rusak -> default true). */
export async function readReportEmailSchedule(): Promise<ReportSchedule> {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULT_SCHEDULE };
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_SCHEDULE };
    }
    const raw = parsed as Record<string, unknown>;
    return {
      weeklyEnabled: typeof raw.weeklyEnabled === "boolean" ? raw.weeklyEnabled : DEFAULT_SCHEDULE.weeklyEnabled,
      monthlyEnabled:
        typeof raw.monthlyEnabled === "boolean" ? raw.monthlyEnabled : DEFAULT_SCHEDULE.monthlyEnabled,
    };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

function formatDateLong(value: Date): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" }).format(value);
}

function monthYearLabel(value: Date): string {
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(value);
}

/** Bulan yang dilaporkan untuk varian bulanan: bulan sebelum tanggal kirim. */
function previousMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}

/** Subjek email sesuai varian: "Laporan Mingguan Lumina — <tanggal>" / "Laporan Bulanan Lumina — <bulan tahun>". */
export function reportEmailSubject(now: Date, variant: ReportEmailVariant): string {
  if (variant === "WEEKLY") return `Laporan Mingguan Lumina — ${formatDateLong(now)}`;
  return `Laporan Bulanan Lumina — ${monthYearLabel(previousMonth(now))}`;
}

/**
 * Kumpulkan ringkasan pipeline + susun isi email laporan.
 * Statistik: kandidat per bucket tahap, lamaran {windowDays} hari terakhir,
 * 5 posisi teratas berdasar lamaran baru, wawancara 7 hari ke depan, offer PENDING.
 */
export async function buildReportEmail(
  now: Date,
  variant: ReportEmailVariant,
): Promise<ReportEmailData> {
  const windowDays = variant === "WEEKLY" ? 7 : 30;
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const next7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [appsByBucket, newInWindow, topGrouped, interviewsNext7d, pendingOffers] = await Promise.all([
    // Kandidat per tahap: kelompokkan status mentah (termasuk tahap kustom),
    // lalu agregasi ke bucket bawaan di sisi aplikasi.
    db.application.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    db.application.count({ where: { createdAt: { gte: since }, deletedAt: null } }),
    db.application.groupBy({
      by: ["positionId"],
      where: { createdAt: { gte: since }, deletedAt: null, positionId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { positionId: "desc" } },
      take: 5,
    }),
    db.interview.count({
      where: { scheduledAt: { gte: now, lte: next7d }, status: { in: ["SCHEDULED", "CONFIRMED"] } },
    }),
    db.application.count({ where: { offerStatus: "PENDING", deletedAt: null } }),
  ]);

  const counts = new Map<string, number>();
  for (const row of appsByBucket) counts.set(row.status, row._count._all);

  const builtIn: (ApplicationStatus | "OTHER")[] = [...Object.keys(STATUS_LABELS), "OTHER"] as (
    | ApplicationStatus
    | "OTHER"
  )[];
  const statusCounts = builtIn.map((status) => ({
    status,
    label: status === "OTHER" ? "Tahap lain (kustom)" : STATUS_LABELS[status as ApplicationStatus],
    count: status === "OTHER"
      ? [...counts.entries()]
          .filter(([stage]) => !isBuiltInStage(stage))
          .reduce((sum, [, n]) => sum + n, 0)
      : (counts.get(status) ?? 0),
  }));

  // Judul posisi untuk 5 teratas (groupBy hanya memberi positionId + jumlah).
  const topIds = topGrouped
    .map((row) => row.positionId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const topRows = topGrouped
    .map((row) => ({ id: row.positionId ?? "", count: row._count._all }))
    .sort((a, b) => b.count - a.count);
  const titles = new Map<string, string>();
  if (topIds.length > 0) {
    const positions = await db.position.findMany({
      where: { id: { in: topIds } },
      select: { id: true, title: true },
    });
    for (const p of positions) titles.set(p.id, p.title);
  }
  const topPositions = topRows.map((row) => ({
    title: titles.get(row.id) ?? "Posisi telah dihapus",
    count: row.count,
  }));

  const subject = reportEmailSubject(now, variant);
  const generatedAt = formatDateLong(now);
  const periodLabel =
    variant === "WEEKLY"
      ? `Rekap ${windowDays} hari terakhir (s.d. ${generatedAt})`
      : `Rekap ${windowDays} hari terakhir (s.d. ${generatedAt}) — laporan bulan ${monthYearLabel(previousMonth(now))}`;

  const textLines: string[] = [];
  textLines.push(variant === "WEEKLY" ? "Laporan Mingguan Lumina Studio" : "Laporan Bulanan Lumina Studio");
  textLines.push(`${periodLabel}.`);
  textLines.push("");
  textLines.push("Kandidat per tahap:");
  for (const bucket of statusCounts) textLines.push(`- ${bucket.label}: ${bucket.count}`);
  textLines.push("");
  textLines.push(`Lamaran baru ${windowDays} hari terakhir: ${newInWindow}`);
  textLines.push(`Wawancara 7 hari ke depan: ${interviewsNext7d}`);
  textLines.push(`Penawaran menunggu jawaban: ${pendingOffers}`);
  if (topPositions.length > 0) {
    textLines.push("");
    textLines.push(`Posisi dengan lamaran baru terbanyak (${windowDays} hari terakhir):`);
    topPositions.forEach((row, i) => textLines.push(`${i + 1}. ${row.title} - ${row.count} lamaran`));
  }
  textLines.push("");
  textLines.push(
    "Email ini dibuat otomatis oleh sistem Lumina Studio. Buka panel admin untuk detail lengkap.",
  );
  const bodyText = textLines.join("\n");

  const htmlItems = (items: string[]) =>
    items.map((item) => `<li style="margin:2px 0;">${item}</li>`).join("");
  const bodyHtml = [
    `<p><strong>${variant === "WEEKLY" ? "Laporan Mingguan" : "Laporan Bulanan"} Lumina Studio</strong><br />${periodLabel}.</p>`,
    `<p>Kandidat per tahap:</p><ul>${htmlItems(
      statusCounts.map((b) => `${b.label}: ${b.count}`),
    )}</ul>`,
    `<ul>${htmlItems([
      `Lamaran baru ${windowDays} hari terakhir: ${newInWindow}`,
      `Wawancara 7 hari ke depan: ${interviewsNext7d}`,
      `Penawaran menunggu jawaban: ${pendingOffers}`,
    ])}</ul>`,
    topPositions.length > 0
      ? `<p>Posisi dengan lamaran baru terbanyak:</p><ol>${htmlItems(
          topPositions.map((row) => `${row.title} - ${row.count} lamaran`),
        )}</ol>`
      : "",
    `<p style="color:#71717a;">Email ini dibuat otomatis oleh sistem Lumina Studio. Buka panel admin untuk detail lengkap.</p>`,
  ].join("");

  return {
    subject,
    periodLabel,
    generatedAt: new Date().toISOString(),
    windowDays,
    statusCounts,
    newApplicationsInWindow: newInWindow,
    topPositions,
    interviewsNext7d,
    pendingOffers,
    bodyText,
    bodyHtml,
  };
}

/**
 * Jalankan satu job laporan email (dipanggil cron /api/cron/reminders).
 * Dedupe via ActivityLog (satu kirim per hari untuk aksi terkait) — penanda
 * dibuat SEBELUM antre email agar cron berikutnya tidak mengirim ganda.
 * Mengembalikan jumlah email yang masuk antrean (0 bila sudah terkirim hari ini).
 */
export async function runScheduledReportEmail(
  now: Date,
  variant: ReportEmailVariant,
): Promise<number> {
  const action = variant === "WEEKLY" ? "EMAIL_REPORT_WEEKLY" : "EMAIL_REPORT_MONTHLY";
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const already = await db.activityLog.findFirst({
    where: { action, createdAt: { gte: dayStart } },
    select: { id: true },
  });
  if (already) return 0;

  const report = await buildReportEmail(now, variant);

  // Penanda dedupe dibuat dulu (pola weekly digest existing).
  await db.activityLog.create({
    data: {
      applicationId: null,
      actor: "Sistem",
      action,
      detail: `${report.subject} — periode: ${report.periodLabel}`,
    },
  });

  // Penerima: semua admin aktif OWNER/HR.
  const recipients = await db.adminUser.findMany({
    where: { isActive: true, role: { in: ["OWNER", "HR"] } },
    select: { email: true },
  });

  for (const recipient of recipients) {
    // Hanya buat baris EmailOutbox (QUEUED) — TIDAK mengirim via SMTP di sini.
    await db.emailOutbox.create({
      data: {
        toEmail: recipient.email,
        subject: report.subject,
        body: report.bodyText,
        kind: "SYSTEM",
        status: "QUEUED",
      },
    });
  }

  await pushNotification({
    title: variant === "WEEKLY" ? "Laporan mingguan terkirim" : "Laporan bulanan terkirim",
    body:
      recipients.length > 0
        ? `${report.subject} — ${recipients.length} email masuk antrean untuk Pemilik & HR.`
        : `${report.subject} — tidak ada penerima admin aktif (OWNER/HR).`,
    category: "SYSTEM",
  });

  return recipients.length;
}
