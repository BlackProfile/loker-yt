// NR-41 H16 — Retry pengiriman email otomatis (SERVER-ONLY).
// processEmailRetries() mengambil EmailOutbox berstatus FAILED/SKIPPED/QUEUED
// yang jatuh tempo (nextRetryAt <= now, atau QUEUED lama > 2 menit belum
// terkirim) lalu mencoba mengirim ulang lewat jalur SMTP yang sama dengan
// queueEmail (sendEmailViaSmtp). Backoff: [5, 15, 60, 240, 720] menit per
// index attempts-1; maksimal 5 percobaan.
// DIPANGGIL DARI: cron maintenance (wiring oleh SEC-B) — lib ini tidak
// memasang sendiri jadwalnya.
import { db } from "@/lib/db";
import {
  EMAIL_MAX_ATTEMPTS,
  EMAIL_RETRY_BACKOFF_MINUTES,
  sendEmailViaSmtp,
} from "@/lib/notify";

/** Batas jumlah email yang diproses dalam satu siklus (aman untuk cron ringan). */
const BATCH_LIMIT = 25;
/** QUEUED dianggap "tersangkut" bila sudah lebih lama dari 2 menit. */
const QUEUED_STUCK_MS = 2 * 60 * 1000;

/**
 * Proses satu siklus retry email. Tidak pernah melempar error — kegagalan
 * satu baris tidak menghentikan baris lain. Return ringkasan jumlah.
 */
export async function processEmailRetries(): Promise<{ processed: number; sent: number; failed: number }> {
  let processed = 0;
  let sent = 0;
  let failed = 0;

  try {
    // Tanpa SMTP yang terkonfigurasi, tidak ada gunanya mencoba kirim —
    // biarkan email tetap QUEUED (kirim manual dari admin akan menandai SKIPPED).
    if (!process.env.SMTP_HOST) return { processed: 0, sent: 0, failed: 0 };

    const now = new Date();
    const stuckQueuedBefore = new Date(now.getTime() - QUEUED_STUCK_MS);

    const candidates = await db.emailOutbox.findMany({
      where: {
        status: { in: ["FAILED", "SKIPPED", "QUEUED"] },
        OR: [
          // Jadwal retry backoff sudah tercapai.
          { nextRetryAt: { lte: now } },
          // QUEUED tersangkut lama (mis. proses kirim sempat mati).
          { nextRetryAt: null, status: "QUEUED", createdAt: { lt: stuckQueuedBefore } },
        ],
        // Batch aman: kecil, urut jadwal retry paling tua dulu.
      },
      orderBy: [{ nextRetryAt: "asc" }, { createdAt: "asc" }],
      take: BATCH_LIMIT,
    });

    for (const record of candidates) {
      processed += 1;
      // Batas percobaan: setelah EMAIL_MAX_ATTEMPTS kali, tandai FAILED final
      // (tanpa nextRetryAt) agar tidak diproses terus-menerus.
      if (record.attempts >= EMAIL_MAX_ATTEMPTS) {
        try {
          await db.emailOutbox.update({
            where: { id: record.id },
            data: { status: "FAILED", nextRetryAt: null, lastError: record.lastError ?? "Melebihi batas percobaan" },
          });
        } catch {
          // diam
        }
        failed += 1;
        continue;
      }

      const result = await sendEmailViaSmtp({
        toEmail: record.toEmail,
        subject: record.subject,
        body: record.body,
      });

      if (result.ok) {
        try {
          await db.emailOutbox.update({
            where: { id: record.id },
            data: {
              status: "SENT",
              sentAt: new Date(),
              attempts: { increment: 1 },
              error: null,
              lastError: null,
              nextRetryAt: null,
            },
          });
        } catch {
          // diam
        }
        sent += 1;
      } else {
        const message = result.error ?? "Gagal mengirim email";
        // attempts berikutnya (setelah increment) menentukan index backoff:
        // attempts baru = n → backoff index n-1; bila melewati daftar, pakai yang terakhir.
        const nextAttempts = record.attempts + 1;
        const backoffIndex = Math.min(nextAttempts - 1, EMAIL_RETRY_BACKOFF_MINUTES.length - 1);
        const nextRetryAt = new Date(
          Date.now() + EMAIL_RETRY_BACKOFF_MINUTES[backoffIndex] * 60 * 1000,
        );
        try {
          await db.emailOutbox.update({
            where: { id: record.id },
            data: {
              status: nextAttempts >= EMAIL_MAX_ATTEMPTS ? "FAILED" : record.status === "SKIPPED" ? "SKIPPED" : "FAILED",
              attempts: { increment: 1 },
              lastError: message,
              error: message,
              nextRetryAt: nextAttempts >= EMAIL_MAX_ATTEMPTS ? null : nextRetryAt,
            },
          });
        } catch {
          // diam
        }
        failed += 1;
      }
    }
  } catch (error) {
    console.error("[email-retry] processEmailRetries gagal:", error);
  }

  return { processed, sent, failed };
}
