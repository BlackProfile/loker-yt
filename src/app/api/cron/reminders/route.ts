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
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { pushNotification, queueEmail, sendSystemEvent } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Harus sama dengan yang dipakai realtime-server.ts & mini-service (dipakai sebagai header cron).
const REALTIME_SECRET = process.env.REALTIME_SECRET ?? "lumina-realtime-secret";

function formatDateTimeId(value: Date): string {
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-realtime-secret");
    if (!REALTIME_SECRET || secret !== REALTIME_SECRET) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const now = new Date();
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
        application: { select: { id: true, name: true, position: { select: { title: true } } } },
      },
    });
    for (const iv of upcoming) {
      const minutesLeft = (iv.scheduledAt.getTime() - now.getTime()) / 60000;
      const platform = iv.mode === "ONSITE" ? `di lokasi (${iv.address ?? "-"})` : `via ${iv.platform.replaceAll("_", " ").toLowerCase()}`;
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
          detail: `${iv.application.name} — ronde ${iv.round} ${platform} pukul ${formatDateTimeId(iv.scheduledAt)}.`,
          applicationId: iv.applicationId,
          action: "INTERVIEW_REMINDER",
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
          detail: `${iv.application.name} — ronde ${iv.round} ${platform} pada ${formatDateTimeId(iv.scheduledAt)}.`,
          applicationId: iv.applicationId,
          action: "INTERVIEW_REMINDER",
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

    return NextResponse.json({
      ok: true,
      offerExpired,
      remindersDay,
      remindersHour,
      noShows,
      offerRemindersH1,
      weeklyDigest,
    });
  } catch (error) {
    console.error("[POST /api/cron/reminders]", error);
    return NextResponse.json({ error: "Gagal menjalankan tugas terjadwal." }, { status: 500 });
  }
}
