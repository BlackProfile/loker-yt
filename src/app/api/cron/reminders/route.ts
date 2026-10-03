// POST /api/cron/reminders — tugas terjadwal yang dipanggil realtime-service tiap 60 detik
// (dilindungi header x-realtime-secret):
//   1. Offer PENDING lewat deadline -> EXPIRED + log + realtime
//   2. Wawancara <=24 jam lagi -> reminder H-1 (sekali per sesi)
//   3. Wawancara <=60 menit lagi -> reminder H-1 jam (sekali per sesi)
//   4. Wawancara terlewat >60 menit tanpa kehadiran -> auto NO_SHOW + log
//   5. Offer H-1: offer PENDING dengan deadline <24 jam lagi -> email pengingat ke
//      pelamar + ActivityLog OFFER_REMIND_H1 + notifikasi in-app (sekali per lamaran)
//   6. Rekap mingguan: hari SENIN jam 08:00-08:59 lokal, sekali per hari -> statistik
//      7 hari terakhir via sendSystemEvent (Setting "site".weeklyDigestEnabled, default true)
//   7. Rekap bulanan: tanggal 1 jam 07:00-07:59 lokal — snapshot bulan sebelumnya
//      ke MonthlyReport (idempoten) + notifikasi in-app untuk OWNER
//   23. NR-19 Laporan email mingguan: Senin 08:00 lokal bila Setting
//       "reportEmailSchedule".weeklyEnabled !== false -> buildReportEmail + baris
//       EmailOutbox (kind SYSTEM, QUEUED) untuk semua admin OWNER/HR aktif
//       (dedupe ActivityLog EMAIL_REPORT_WEEKLY; TIDAK kirim SMTP langsung)
//   24. NR-19 Laporan email bulanan: tanggal 1 jam 07:00 lokal bila monthlyEnabled
//       !== false -> sama, dedupe EMAIL_REPORT_MONTHLY
//   25. NR-24 "followupBell": lamaran deletedAt null dengan snoozeUntil <= now ->
//       NotificationItem "Tindak lanjut jatuh tempo" + ActivityLog FOLLOWUP_REMIND
//       (dedupe: satu pengingat per lamaran per snoozeUntil — dicek via ActivityLog
//       FOLLOWUP_REMIND yang createdAt >= snoozeUntil)
// Uji manual: POST body {"forceEmailReport": true} memproses job laporan email
// mengabaikan cek hari/jam (dedupe harian tetap berlaku).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { pushNotification, queueEmail, sendSystemEvent, getSiteUrl } from "@/lib/notify";
import type { TelegramButton } from "@/lib/notify";
import { ensureMonthlyReport, previousMonthKey } from "@/lib/monthly-report";
import { readReportEmailSchedule, runScheduledReportEmail } from "@/lib/report-email";
import {
  runTelegramActivityWatch,
  runTelegramCandidateInterviewReminders,
  runTelegramCandidateOfferReminders,
  runTelegramDigest,
  runTelegramDigestEvening,
  runTelegramDigestWeekly,
  runTelegramInterviewReminders,
  runTelegramJobBroadcast,
  runTelegramQuotaCheck,
  runTelegramScheduledExport,
  runTelegramSlaCheck,
  runTelegramSnoozeDispatch,
  runTelegramStageWatch,
  runTelegramWeeklyChart,
} from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

// Harus sama dengan yang dipakai realtime-server.ts & mini-service (dipakai sebagai header cron).
const REALTIME_SECRET = process.env.REALTIME_SECRET ?? "lumina-realtime-secret";

function formatDateTimeId(value: Date): string {
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

// Parse kolom JSON string[] (mis. Position.customDocs) dari record Prisma mentah.
function parseStringArray(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-realtime-secret");
    if (!REALTIME_SECRET || secret !== REALTIME_SECRET) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const now = new Date();

    // Body opsional untuk pengujian manual: {"forceEmailReport": true} memaksa
    // job laporan email berjalan tanpa menunggu Senin 08.00 / tanggal 1 07.00.
    const rawBody: unknown = await req.json().catch(() => null);
    const forceEmailReport =
      !!rawBody &&
      typeof rawBody === "object" &&
      !Array.isArray(rawBody) &&
      (rawBody as Record<string, unknown>).forceEmailReport === true;

    let offerExpired = 0;
    let remindersDay = 0;
    let remindersHour = 0;
    let noShows = 0;
    let offerRemindersH1 = 0;
    let weeklyDigest = 0;

    // 1) Offer kedaluwarsa
    const expiredOffers = await db.application.findMany({
      where: { offerStatus: "PENDING", offerDeadline: { lt: now } },
      select: { id: true, name: true, offerDeadline: true, position: { select: { title: true } } },
    });
    for (const app of expiredOffers) {
      await db.application.update({ where: { id: app.id }, data: { offerStatus: "EXPIRED" } });
      await db.activityLog.create({
        data: {
          applicationId: app.id,
          actor: "Sistem",
          action: "OFFER_EXPIRED",
          detail: "Batas jawaban penawaran terlewat — otomatis kedaluwarsa",
        },
      });
      void sendSystemEvent({
        title: "Offer Kedaluwarsa",
        detail: `${app.name} tidak menjawab penawaran posisi ${app.position?.title ?? "-"} hingga ${app.offerDeadline ? formatDateTimeId(app.offerDeadline) : "-"}.`,
        applicationId: app.id,
        action: "OFFER_EXPIRED",
      });
      offerExpired += 1;
    }

    // 2) & 3) Reminder wawancara
    const upcoming = await db.interview.findMany({
      where: {
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        scheduledAt: { gte: now, lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
      },
      include: {
        application: {
          select: {
            id: true,
            name: true,
            trackingCode: true,
            position: {
              select: { title: true, address: true, mapsUrl: true, customDocs: true },
            },
          },
        },
      },
    });
    for (const iv of upcoming) {
      const minutesLeft = (iv.scheduledAt.getTime() - now.getTime()) / 60000;
      const platform = iv.mode === "ONSITE" ? `di lokasi (${iv.address ?? iv.application.position?.address ?? "-"})` : `via ${iv.platform.replaceAll("_", " ").toLowerCase()}`;

      // Sesi on-site (NR-5): pengingat menyuruh kandidat datang ke kantor —
      // sertakan alamat, tautan peta, dan daftar dokumen wajib posisi.
      const onsiteLines: string[] = [];
      if (iv.mode === "ONSITE") {
        const pos = iv.application.position;
        const address = iv.address ?? pos?.address ?? null;
        if (address) onsiteLines.push(`Datang ke ${address}`);
        if (pos?.mapsUrl) onsiteLines.push(`Peta: ${pos.mapsUrl}`);
        const docs = parseStringArray(pos?.customDocs);
        if (docs.length > 0) onsiteLines.push(`Bawa dokumen: ${docs.join(", ")}`);
      }
      const onsiteSuffix = onsiteLines.length > 0 ? `\n${onsiteLines.join("\n")}` : "";

      if (minutesLeft <= 60 && !iv.reminderHourSent) {
        await db.interview.update({ where: { id: iv.id }, data: { reminderHourSent: true } });
        await db.activityLog.create({
          data: {
            applicationId: iv.applicationId,
            actor: "Sistem",
            action: "INTERVIEW_REMINDER",
            detail: `Pengingat H-1 jam terkirim untuk ronde ${iv.round}`,
          },
        });
        void sendSystemEvent({
          title: "Wawancara 1 Jam Lagi",
          detail: `${iv.application.name} — ronde ${iv.round} ${platform} pukul ${formatDateTimeId(iv.scheduledAt)}.${onsiteSuffix}`,
          applicationId: iv.applicationId,
          action: "INTERVIEW_REMINDER",
          trackingCode: iv.application.trackingCode ?? undefined,
          telegramButtons: [
            ...(iv.application.trackingCode
              ? [[{ text: "Lihat Kandidat", url: `${getSiteUrl()}/?kandidat=${encodeURIComponent(iv.application.trackingCode)}#admin` }]]
              : []),
            [{ text: "Buka Panel Admin", url: `${getSiteUrl()}/#admin` }],
          ],
        });
        remindersHour += 1;
      } else if (minutesLeft > 60 && !iv.reminderDaySent) {
        await db.interview.update({ where: { id: iv.id }, data: { reminderDaySent: true } });
        await db.activityLog.create({
          data: {
            applicationId: iv.applicationId,
            actor: "Sistem",
            action: "INTERVIEW_REMINDER",
            detail: `Pengingat H-1 terkirim untuk ronde ${iv.round}`,
          },
        });
        void sendSystemEvent({
          title: "Pengingat Wawancara Besok",
          detail: `${iv.application.name} — ronde ${iv.round} ${platform} pada ${formatDateTimeId(iv.scheduledAt)}.${onsiteSuffix}`,
          applicationId: iv.applicationId,
          action: "INTERVIEW_REMINDER",
          trackingCode: iv.application.trackingCode ?? undefined,
          telegramButtons: [
            ...(iv.application.trackingCode
              ? [[{ text: "Lihat Kandidat", url: `${getSiteUrl()}/?kandidat=${encodeURIComponent(iv.application.trackingCode)}#admin` }]]
              : []),
            [{ text: "Buka Panel Admin", url: `${getSiteUrl()}/#admin` }],
          ],
        });
        remindersDay += 1;
      }
    }

    // 4) Auto NO_SHOW: terlewat > 60 menit dan masih SCHEDULED/CONFIRMED
    const overdue = await db.interview.findMany({
      where: {
        status: { in: ["SCHEDULED", "CONFIRMED"] },
        scheduledAt: { lt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
      include: {
        application: { select: { id: true, name: true, position: { select: { title: true } } } },
      },
    });
    for (const iv of overdue) {
      await db.interview.update({ where: { id: iv.id }, data: { status: "NO_SHOW" } });
      await db.activityLog.create({
        data: {
          applicationId: iv.applicationId,
          actor: "Sistem",
          action: "INTERVIEW_NO_SHOW",
          detail: `Wawancara ronde ${iv.round} terlewat >1 jam — otomatis ditandai tidak hadir`,
        },
      });
      void sendSystemEvent({
        title: "Wawancara Tidak Hadir",
        detail: `${iv.application.name} tidak hadir pada wawancara ronde ${iv.round} (${formatDateTimeId(iv.scheduledAt)}).`,
        applicationId: iv.applicationId,
        action: "INTERVIEW_NO_SHOW",
      });
      noShows += 1;
    }

    // 5) OFFER H-1: offer PENDING dengan batas jawaban <24 jam lagi — kirim email
    //    pengingat ke pelamar SEKALI per lamaran (penanda: ActivityLog OFFER_REMIND_H1).
    const h1WindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const h1Offers = await db.application.findMany({
      where: { offerStatus: "PENDING", offerDeadline: { gte: now, lte: h1WindowEnd } },
      select: {
        id: true,
        name: true,
        email: true,
        offerDeadline: true,
        position: { select: { title: true } },
      },
    });
    for (const app of h1Offers) {
      const already = await db.activityLog.findFirst({
        where: { applicationId: app.id, action: "OFFER_REMIND_H1" },
        select: { id: true },
      });
      if (already) continue;

      const deadlineLabel = formatDateTimeId(app.offerDeadline ?? now);
      const positionTitle = app.position?.title ?? "posisi";

      await db.activityLog.create({
        data: {
          applicationId: app.id,
          actor: "Sistem",
          action: "OFFER_REMIND_H1",
          detail: `Pengingat H-1 dikirim ke ${app.email} — batas jawaban ${deadlineLabel}`,
        },
      });

      await queueEmail({
        toEmail: app.email,
        subject: `Pengingat: penawaran posisi ${positionTitle} menunggu jawabanmu`,
        body: [
          `Halo ${app.name},`,
          "",
          `Kami dari Lumina Studio ingin mengingatkan bahwa penawaran untuk posisi ${positionTitle} yang kami kirimkan masih menunggu jawabanmu.`,
          `Batas jawaban: ${deadlineLabel}.`,
          "",
          "Buka halaman status lamaranmu untuk menerima atau menolak penawaran ini. Bila kamu butuh waktu lebih atau ada pertanyaan, jangan ragu menghubungi kami.",
          "",
          "Salam hangat,",
          "Tim Lumina Studio",
        ].join("\n"),
        kind: "REMINDER",
        applicationId: app.id,
      });

      await pushNotification({
        title: "Offer hampir kedaluwarsa",
        body: `${app.name} — batas jawaban penawaran ${positionTitle}: ${deadlineLabel}.`,
        category: "OFFER",
        applicationId: app.id,
      });

      offerRemindersH1 += 1;
    }

    // 6) Rekap mingguan: hanya hari SENIN, jam 08:00-08:59 waktu server (lokal),
    //    dan belum ada ActivityLog WEEKLY_DIGEST hari ini. Toggle: Setting "site"
    //    field weeklyDigestEnabled (default true, dibaca aman dari JSON).
    let weeklyDigestEnabled = true;
    try {
      const siteSetting = await db.setting.findUnique({ where: { key: "site" } });
      if (siteSetting) {
        const parsed: unknown = JSON.parse(siteSetting.value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const flag = (parsed as Record<string, unknown>).weeklyDigestEnabled;
          if (typeof flag === "boolean") weeklyDigestEnabled = flag;
        }
      }
    } catch {
      // JSON rusak / setting gagal dibaca — pakai default true.
    }

    if (weeklyDigestEnabled && now.getDay() === 1 && now.getHours() === 8) {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const digestToday = await db.activityLog.findFirst({
        where: { action: "WEEKLY_DIGEST", createdAt: { gte: todayStart } },
        select: { id: true },
      });
      if (!digestToday) {
        const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const [newApps, interviewsScheduled, offersSent, offersAccepted, rejected] =
          await Promise.all([
            db.application.count({ where: { createdAt: { gte: since } } }),
            db.interview.count({ where: { createdAt: { gte: since } } }),
            db.application.count({ where: { offerSentAt: { gte: since } } }),
            db.application.count({
              where: { offerStatus: "ACCEPTED", offerRespondedAt: { gte: since } },
            }),
            db.application.count({ where: { rejectedAt: { gte: since } } }),
          ]);

        const summary = `7 hari terakhir: ${newApps} lamaran masuk, ${interviewsScheduled} wawancara dijadwalkan, ${offersSent} offer terkirim, ${offersAccepted} offer diterima, ${rejected} lamaran ditolak.`;

        // Penanda dedup dibuat dulu (sebelum webhook) agar cron berikutnya tidak mengirim ganda.
        await db.activityLog.create({
          data: {
            applicationId: null,
            actor: "Sistem",
            action: "WEEKLY_DIGEST",
            detail: summary,
          },
        });

        await sendSystemEvent({
          title: "Rekap Mingguan Lumina Studio",
          detail: summary,
          action: "WEEKLY_DIGEST",
          category: "SYSTEM",
        });

        weeklyDigest = 1;
      }
    }

    if (offerExpired > 0 || noShows > 0) {
      void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);
    }

    // 7) Rekap bulanan: tanggal 1, jam 07:00-07:59 waktu server — snapshot bulan
    //    sebelumnya ke MonthlyReport (idempoten; sekali per bulan). OWNER diberi
    //    tahu lewat notifikasi in-app; PDF dicetak dari tab Laporan.
    let monthlyReport = 0;
    if (now.getDate() === 1 && now.getHours() === 7) {
      const created = await ensureMonthlyReport(previousMonthKey(now));
      if (created) {
        monthlyReport = 1;
        await pushNotification({
          title: "Rekap bulanan siap",
          body: `Snapshot rekrutmen bulan ${previousMonthKey(now)} sudah dibuat dan bisa dilihat/cetak dari tab Laporan.`,
          category: "SYSTEM",
        });
      }
    }

    // 8) Digest pagi bot Telegram (07.00 WIB, sekali per hari — idempoten internal;
    //    toggle alert, whitelist chat, dan isi digest diatur dari panel admin/lib).
    let telegramDigest = 0;
    try {
      const digest = await runTelegramDigest();
      telegramDigest = digest.sent;
    } catch {
      // bot Telegram tidak wajib — kegagalan tidak boleh menggagalkan cron
    }

    // 9) Pengingat snooze bot Telegram (kandidat yang ditunda admin, jatuh tempo hari itu).
    let telegramSnooze = 0;
    try {
      telegramSnooze = await runTelegramSnoozeDispatch();
    } catch {
      // diam — bot tidak wajib
    }

    // 10) Alert kuota posisi hampir penuh/penuh (dedup per level sisa kuota).
    let telegramQuota = 0;
    try {
      telegramQuota = await runTelegramQuotaCheck();
    } catch {
      // diam
    }

    // 11) Grafik mingguan Senin pagi (PNG, menyusul digest; idempoten per hari).
    let telegramChart = 0;
    try {
      const chart = await runTelegramWeeklyChart();
      telegramChart = chart.sent;
    } catch {
      // diam
    }

    // 12) NR-14 — pengingat wawancara H-1 hari & H-2 jam (chat admin).
    let telegramReminders = 0;
    try {
      telegramReminders = await runTelegramInterviewReminders();
    } catch {
      // diam
    }

    // 13) NR-14 — alert SLA lamaran menginap.
    let telegramSla = 0;
    try {
      telegramSla = await runTelegramSlaCheck();
    } catch {
      // diam
    }

    // 14) NR-14 — digest sore 17.00 WIB.
    let telegramEvening = 0;
    try {
      const evening = await runTelegramDigestEvening();
      telegramEvening = evening.sent;
    } catch {
      // diam
    }

    // 15) NR-14 — rekap mingguan Senin pagi.
    let telegramWeekly = 0;
    try {
      const weekly = await runTelegramDigestWeekly();
      telegramWeekly = weekly.sent;
    } catch {
      // diam
    }

    // 16) NR-14 — ekspor CSV terjadwal Senin pagi.
    let telegramExport = 0;
    try {
      const exportResult = await runTelegramScheduledExport();
      telegramExport = exportResult.sent;
    } catch {
      // diam
    }

    // 17) NR-14 — broadcast lowongan baru ke chat pelanggan.
    let telegramJobs = 0;
    try {
      telegramJobs = await runTelegramJobBroadcast();
    } catch {
      // diam
    }

    // 18) NR-14 — notifikasi perubahan tahap untuk langganan kandidat.
    let telegramStageWatch = 0;
    try {
      telegramStageWatch = await runTelegramStageWatch();
    } catch {
      // diam
    }

    // 19) NR-14 — kartu aktivitas pelamar (slot, offer, withdraw, dst.).
    let telegramActivity = 0;
    try {
      telegramActivity = await runTelegramActivityWatch();
    } catch {
      // diam
    }

    // 20) NR-15 — alert "offer belum dilihat pelamar": offer PENDING dikirim >48 jam
    //     lalu tetap belum dibuka di halaman status (read receipt). Notifikasi in-app
    //     untuk admin, dedupe via site.offerUnseenNotified ({appId: iso}), cap 200.
    let offerUnseenAlert = 0;
    try {
      const unseenCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
      const unseenApps = await db.application.findMany({
        where: {
          offerStatus: "PENDING",
          offerSentAt: { lt: unseenCutoff },
          deletedAt: null,
          OR: [{ candidateSeenAt: null }, { candidateSeenAt: { lt: unseenCutoff } }],
        },
        select: {
          id: true,
          name: true,
          trackingCode: true,
          offerSentAt: true,
          position: { select: { title: true } },
        },
        take: 20,
      });
      if (unseenApps.length > 0) {
        const siteSetting = await db.setting.findUnique({ where: { key: "site" } });
        let siteObj: Record<string, unknown> = {};
        if (siteSetting) {
          try {
            const parsed: unknown = JSON.parse(siteSetting.value);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              siteObj = { ...(parsed as Record<string, unknown>) };
            }
          } catch {
            siteObj = {};
          }
        }
        const notifiedRaw = siteObj.offerUnseenNotified;
        const notified =
          notifiedRaw && typeof notifiedRaw === "object" && !Array.isArray(notifiedRaw)
            ? { ...(notifiedRaw as Record<string, string>) }
            : {};
        for (const app of unseenApps) {
          if (notified[app.id]) continue; // sudah pernah diberi tahu untuk offer ini
          notified[app.id] = now.toISOString();
          const sentLabel = app.offerSentAt
            ? app.offerSentAt.toLocaleDateString("id-ID", { dateStyle: "long" })
            : "-";
          await pushNotification({
            title: `Offer belum dilihat pelamar — ${app.name}`,
            body: `${app.position?.title ?? "-"} · dikirim ${sentLabel} · kode ${app.trackingCode ?? "-"}`,
            category: "OFFER",
            applicationId: app.id,
          });
          offerUnseenAlert += 1;
        }
        // Cap 200 entri (buang yang terlama) agar blob tidak membesar tanpa batas.
        let notifyEntries = Object.entries(notified);
        if (notifyEntries.length > 200) {
          notifyEntries.sort((a, b) => (a[1] < b[1] ? -1 : 1));
          notifyEntries = notifyEntries.slice(notifyEntries.length - 200);
        }
        siteObj.offerUnseenNotified = Object.fromEntries(notifyEntries);
        await db.setting.upsert({
          where: { key: "site" },
          update: { value: JSON.stringify(siteObj) },
          create: { key: "site", value: JSON.stringify(siteObj) },
        });
      }
    } catch {
      // diam — alert kesehatan tidak boleh menggagalkan cron
    }

    // 21) NR-15 — pengingat wawancara ke KANDIDAT pelanggan Telegram (H-2 hari/H-2 jam).
    let telegramCandInterview = 0;
    try {
      telegramCandInterview = await runTelegramCandidateInterviewReminders();
    } catch {
      // diam
    }

    // 22) NR-15 — pengingat offer ke KANDIDAT pelanggan Telegram (deadline <24 jam).
    let telegramCandOffer = 0;
    try {
      telegramCandOffer = await runTelegramCandidateOfferReminders();
    } catch {
      // diam
    }

    // 23) NR-19 — Laporan email mingguan: Senin jam 08:00-08:59 waktu server
    //     (pola job weekly digest) bila Setting "reportEmailSchedule".weeklyEnabled
    //     !== false. Hanya membuat baris EmailOutbox QUEUED + notifikasi admin;
    //     dedupe via ActivityLog EMAIL_REPORT_WEEKLY (satu kirim per hari).
    let emailReportWeekly = 0;
    try {
      const schedule = await readReportEmailSchedule();
      const weeklyDue = forceEmailReport || (now.getDay() === 1 && now.getHours() === 8);
      if (schedule.weeklyEnabled && weeklyDue) {
        emailReportWeekly = await runScheduledReportEmail(now, "WEEKLY");
      }
    } catch {
      // diam — laporan email tidak boleh menggagalkan cron
    }

    // 24) NR-19 — Laporan email bulanan: tanggal 1 jam 07:00-07:59 waktu server
    //     bila monthlyEnabled !== false. Dedupe via EMAIL_REPORT_MONTHLY.
    let emailReportMonthly = 0;
    try {
      const schedule = await readReportEmailSchedule();
      const monthlyDue = forceEmailReport || (now.getDate() === 1 && now.getHours() === 7);
      if (schedule.monthlyEnabled && monthlyDue) {
        emailReportMonthly = await runScheduledReportEmail(now, "MONTHLY");
      }
    } catch {
      // diam
    }

    // 25) NR-24 — "followupBell": pengingat tindak lanjut jatuh tempo di lonceng
    //     admin. Lamaran deletedAt null dengan snoozeUntil <= now (waktu server,
    //     konsisten dengan job lain di cron ini) mendapat NotificationItem in-app
    //     + ActivityLog FOLLOWUP_REMIND. Dedupe: lewati bila sudah ada ActivityLog
    //     FOLLOWUP_REMIND untuk lamaran tsb dengan createdAt >= snoozeUntil
    //     (artinya pengingat untuk jadwal snooze ini sudah pernah dibunyikan).
    let followupBell = 0;
    try {
      const dueFollowups = await db.application.findMany({
        where: { deletedAt: null, snoozeUntil: { not: null, lte: now } },
        select: {
          id: true,
          name: true,
          trackingCode: true,
          snoozeUntil: true,
          position: { select: { title: true } },
        },
        take: 50,
      });
      for (const app of dueFollowups) {
        if (!app.snoozeUntil) continue;
        const already = await db.activityLog.findFirst({
          where: {
            applicationId: app.id,
            action: "FOLLOWUP_REMIND",
            createdAt: { gte: app.snoozeUntil },
          },
          select: { id: true },
        });
        if (already) continue;
        const codeLabel = app.trackingCode ?? "-";
        await pushNotification({
          title: "Tindak lanjut jatuh tempo",
          body: `${app.name} (${codeLabel}) — hubungi lagi (${app.position?.title ?? "-"})`,
          category: "APPLICATION",
          applicationId: app.id,
        });
        await db.activityLog.create({
          data: {
            applicationId: app.id,
            actor: "Sistem",
            action: "FOLLOWUP_REMIND",
            detail: `Pengingat tindak lanjut (snooze s.d. ${formatDateTimeId(app.snoozeUntil)})`,
          },
        });
        followupBell += 1;
      }
      if (followupBell > 0) {
        void emitRealtime(REALTIME_EVENTS.applications);
      }
    } catch (followupError) {
      console.error("[POST /api/cron/reminders] followupBell", followupError);
      // diam — pengingat tidak boleh menggagalkan cron
    }

    return NextResponse.json({
      ok: true,
      offerExpired,
      remindersDay,
      remindersHour,
      noShows,
      offerRemindersH1,
      weeklyDigest,
      monthlyReport,
      telegramDigest,
      telegramSnooze,
      telegramQuota,
      telegramChart,
      telegramReminders,
      telegramSla,
      telegramEvening,
      telegramWeekly,
      telegramExport,
      telegramJobs,
      telegramStageWatch,
      telegramActivity,
      offerUnseenAlert,
      telegramCandInterview,
      telegramCandOffer,
      emailReportWeekly,
      emailReportMonthly,
      followupBell,
    });
  } catch (error) {
    console.error("[POST /api/cron/reminders]", error);
    return NextResponse.json({ error: "Gagal menjalankan tugas terjadwal." }, { status: 500 });
  }
}
