// POST /api/admin/applications/bulk — aksi massal: ubah status, hapus (soft),
// atur talent pool, tolak, atur tag, arsip, batalkan arsip, atau jadwalkan
// wawancara (OWNER/HR).
// Aksi "reject": status -> REJECTED + alasan terstruktur + tanggal ditolak (per lamaran, lewat transaksi).
// Aksi "delete": SOFT DELETE (deletedAt=now) — lamaran masuk tong sampah dan
//                masih bisa dipulihkan dari tab Data.
// Aksi "tag": gabungkan tag unik (maks 12, masing-masing <=24 karakter) ke tiap lamaran.
// Aksi "archive"/"unarchive": set/kosongkan archivedAt (+ log ARCHIVE per lamaran,
//                webhook "application.archived" untuk arsip).
// Aksi "schedule-interview" (NR-40): buat sesi Interview SCHEDULED ronde berikutnya
//                (max round + 1) untuk tiap lamaran + isi interviewAt + log
//                INTERVIEW_SCHEDULED + email undangan (queueEmail, kind INVITE).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  parseTags,
  sanitizeInterviewMode,
  sanitizeInterviewPlatform,
  sanitizeRejectionReason,
} from "@/lib/seed";
import { stageLabel } from "@/lib/stages";
import {
  INTERVIEW_PLATFORM_LABELS,
  REJECTION_REASON_LABELS,
  type RejectionReason,
} from "@/lib/types";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { emitWebhook } from "@/lib/webhooks";
import { sendCandidateStatusEmail } from "@/lib/candidate-emails";
import { queueEmail } from "@/lib/notify";
import { appendStageHistory } from "@/lib/stage-history";
import { syncApplicationTags } from "@/lib/tags-sync";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;

/** Rapikan daftar tag masuk: string saja, trim, maks 24 char, unik, maks 12. */
function sanitizeIncomingTags(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const clean = item.trim().slice(0, MAX_TAG_LENGTH);
    if (!clean) continue;
    if (!out.includes(clean)) out.push(clean);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const ids = Array.isArray(data.ids)
      ? data.ids.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Daftar ID lamaran tidak valid." }, { status: 400 });
    }

    const action = typeof data.action === "string" ? data.action : "";
    if (
      ![
        "status",
        "delete",
        "talentPool",
        "reject",
        "tag",
        "archive",
        "unarchive",
        "schedule-interview",
      ].includes(action)
    ) {
      return NextResponse.json({ error: "Aksi tidak valid." }, { status: 400 });
    }

    let affected = 0;
    let logAction = "";
    let logDetail = "";

    if (action === "status") {
      // Status/tahap menerima string apa pun (5 status bawaan ATAU tahap kustom posisi).
      const status = typeof data.status === "string" ? data.status.trim() : "";
      if (!status || status.length > 40) {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      // Catat dulu lamaran yang BENAR-BENAR berpindah status (bukan yang sudah di
      // status tujuan) agar email kandidat hanya terkirim untuk perubahan nyata.
      const changedRows = await db.application.findMany({
        where: { id: { in: ids }, status: { not: status }, deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          trackingCode: true,
          status: true,
          stageHistory: true,
          position: { select: { title: true } },
        },
      });
      // Tahap berubah -> bila ditujukan ke Ditolak, penawaran aktif ikut dibatalkan
      // agar halaman status pelamar tidak menampilkan kartu offer yang tak relevan.
      const result = await db.application.updateMany({
        where: { id: { in: ids } },
        data: { status, ...(status === "REJECTED" ? { offerStatus: null } : {}) },
      });
      affected = result.count;
      // Riwayat tahap (NR-15): catat perpindahan per lamaran yang benar-benar pindah.
      if (changedRows.length > 0) {
        await db.$transaction(
          changedRows.map((row) =>
            db.application.update({
              where: { id: row.id },
              data: { stageHistory: appendStageHistory(row.stageHistory, status, row.status) },
            }),
          ),
        );
      }
      const label = stageLabel(status);
      logAction = "BULK_STATUS";
      logDetail = `${affected} lamaran diubah status menjadi ${label}`;
      // Email otomatis per kandidat yang statusnya benar-benar berubah (fire-and-forget).
      for (const row of changedRows) {
        void sendCandidateStatusEmail({
          applicationId: row.id,
          name: row.name,
          email: row.email,
          trackingCode: row.trackingCode,
          toStatus: status,
          positionTitle: row.position?.title ?? null,
          origin: req.headers.get("origin") ?? undefined,
        });
      }
    } else if (action === "talentPool") {
      if (typeof data.talentPool !== "boolean") {
        return NextResponse.json({ error: "talentPool harus berupa boolean." }, { status: 400 });
      }
      const result = await db.application.updateMany({
        where: { id: { in: ids } },
        data: { talentPool: data.talentPool },
      });
      affected = result.count;
      logAction = "BULK_TALENT_POOL";
      logDetail = `${affected} lamaran ${data.talentPool ? "ditambahkan ke" : "dikeluarkan dari"} talent pool`;
    } else if (action === "reject") {
      const reason = sanitizeRejectionReason(data.reason);
      if (!reason) {
        return NextResponse.json({ error: "Alasan penolakan tidak valid." }, { status: 400 });
      }
      const note =
        typeof data.note === "string" && data.note.trim() ? data.note.trim().slice(0, 1000) : null;
      const now = new Date();
      const rows = await db.application.findMany({
        where: { id: { in: ids }, status: { not: "REJECTED" } },
        select: {
          id: true,
          name: true,
          email: true,
          trackingCode: true,
          status: true,
          stageHistory: true,
          position: { select: { title: true } },
        },
      });
      await db.$transaction(
        rows.map((row) =>
          db.application.update({
            where: { id: row.id },
            data: {
              status: "REJECTED",
              rejectionReason: reason,
              rejectionNote: note,
              rejectedAt: now,
              stageUpdatedAt: now,
              stageHistory: appendStageHistory(row.stageHistory, "REJECTED", row.status),
              offerStatus: null, // penawaran aktif dibatalkan saat lamaran ditolak
            },
          }),
        ),
      );
      if (rows.length > 0) {
        await db.activityLog.createMany({
          data: rows.map((row) => ({
            applicationId: row.id,
            actor: session.name,
            action: "STATUS_CHANGE",
            detail: `Ditolak massal — alasan: ${REJECTION_REASON_LABELS[reason as RejectionReason]}`,
          })),
        });
        // Email penolakan otomatis per kandidat (fire-and-forget, ikut config template).
        for (const row of rows) {
          void sendCandidateStatusEmail({
            applicationId: row.id,
            name: row.name,
            email: row.email,
            trackingCode: row.trackingCode,
            toStatus: "REJECTED",
            positionTitle: row.position?.title ?? null,
            origin: req.headers.get("origin") ?? undefined,
          });
        }
      }
      affected = rows.length;
      logAction = "BULK_STATUS";
      logDetail = `${affected} lamaran ditolak massal (alasan: ${REJECTION_REASON_LABELS[reason as RejectionReason]})`;
    } else if (action === "tag") {
      // Gabungkan tag unik ke setiap lamaran terpilih (maks 12, tiap tag <=24 char).
      const incoming = sanitizeIncomingTags(data.tags);
      if (incoming === null) {
        return NextResponse.json({ error: "Daftar tag tidak valid." }, { status: 400 });
      }
      if (incoming.length === 0) {
        return NextResponse.json({ error: "Tulis minimal satu tag." }, { status: 400 });
      }
      const rows = await db.application.findMany({
        where: { id: { in: ids } },
        select: { id: true, tags: true },
      });
      await db.$transaction(
        rows.map((row) => {
          const merged = [...parseTags(row.tags)];
          for (const tag of incoming) {
            if (!merged.includes(tag)) merged.push(tag);
          }
          return db.application.update({
            where: { id: row.id },
            data: { tags: JSON.stringify(merged.slice(0, MAX_TAGS)) },
          });
        }),
      );
      // NR-41 G10 — dual-write tag terstruktur: sinkron Tag + ApplicationTag
      // untuk tiap lamaran setelah legacy tags ditulis (fire-and-forget per baris).
      await Promise.all(
        rows.map((row) => {
          const merged = [...parseTags(row.tags)];
          for (const tag of incoming) {
            if (!merged.includes(tag)) merged.push(tag);
          }
          return syncApplicationTags(row.id, merged.slice(0, MAX_TAGS), session.name);
        }),
      );
      affected = rows.length;
      logAction = "BULK_TAG";
      logDetail = `${affected} lamaran diberi tag: ${incoming.join(", ")}`;
    } else if (action === "archive") {
      // Arsip massal: archivedAt=now + log ARCHIVE per lamaran + webhook.
      const now = new Date();
      const result = await db.application.updateMany({
        where: { id: { in: ids } },
        data: { archivedAt: now },
      });
      affected = result.count;
      if (affected > 0) {
        await db.activityLog.createMany({
          data: ids.map((id) => ({
            applicationId: id,
            actor: session.name,
            action: "ARCHIVE",
            detail: "Diarsipkan massal dari panel admin",
          })),
        });
        void emitWebhook("application.archived", { ids });
      }
      logAction = "BULK_ARCHIVE";
      logDetail = `${affected} lamaran diarsipkan`;
    } else if (action === "unarchive") {
      const result = await db.application.updateMany({
        where: { id: { in: ids } },
        data: { archivedAt: null },
      });
      affected = result.count;
      logAction = "BULK_UNARCHIVE";
      logDetail = `${affected} lamaran dikeluarkan dari arsip`;
    } else if (action === "schedule-interview") {
      // NR-40 — Jadwalkan wawancara massal: satu konfigurasi jadwal yang sama
      // untuk semua lamaran terpilih; tiap lamaran mendapat sesi ronde
      // berikutnya (max round existing + 1) dan interviewAt diperbarui agar
      // kalender & overview menampilkan jadwal terdekat (pola POST /interviews).
      const scheduledAtRaw = typeof data.scheduledAt === "string" ? data.scheduledAt.trim() : "";
      const scheduledAt = scheduledAtRaw ? new Date(scheduledAtRaw) : null;
      if (!scheduledAt || Number.isNaN(scheduledAt.getTime())) {
        return NextResponse.json(
          { error: "Tanggal dan jam wawancara tidak valid." },
          { status: 400 },
        );
      }

      const mode = sanitizeInterviewMode(data.mode);
      const platform = sanitizeInterviewPlatform(data.platform);

      let meetingLink: string | null = null;
      if (typeof data.meetingLink === "string" && data.meetingLink.trim()) {
        const link = data.meetingLink.trim();
        if (!/^https?:\/\//i.test(link)) {
          return NextResponse.json(
            { error: "Link meeting harus diawali http:// atau https://" },
            { status: 400 },
          );
        }
        meetingLink = link.slice(0, 500);
      }

      let address: string | null = null;
      if (typeof data.address === "string" && data.address.trim()) {
        address = data.address.trim().slice(0, 300);
      }

      let durationMin = 45;
      if (typeof data.durationMin === "number" && Number.isInteger(data.durationMin)) {
        durationMin = Math.min(480, Math.max(10, data.durationMin));
      }

      // Pewawancara: dipisah koma (form kanban) atau array (kontrak API).
      const interviewers: string[] = (
        Array.isArray(data.interviewers)
          ? data.interviewers
          : typeof data.interviewers === "string"
            ? data.interviewers.split(",")
            : []
      )
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, 60))
        .filter((item) => item.length > 0)
        .slice(0, 6);

      const rows = await db.application.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: {
          id: true,
          name: true,
          email: true,
          trackingCode: true,
          position: { select: { title: true } },
        },
      });

      if (rows.length > 0) {
        // Ronde berikutnya per lamaran: max round existing + 1 (satu query groupBy).
        const maxRounds = await db.interview.groupBy({
          by: ["applicationId"],
          where: { applicationId: { in: rows.map((row) => row.id) } },
          _max: { round: true },
        });
        const nextRoundByApp = new Map<string, number>();
        for (const row of maxRounds) {
          nextRoundByApp.set(row.applicationId, (row._max.round ?? 0) + 1);
        }

        const whenLabel = scheduledAt.toLocaleString("id-ID", {
          dateStyle: "medium",
          timeStyle: "short",
        });

        await db.$transaction(
          rows.flatMap((row) => {
            const round = nextRoundByApp.get(row.id) ?? 1;
            return [
              db.interview.create({
                data: {
                  applicationId: row.id,
                  round,
                  mode,
                  platform,
                  meetingLink,
                  address,
                  scheduledAt,
                  durationMin,
                  interviewers: JSON.stringify(interviewers),
                  status: "SCHEDULED",
                },
              }),
              // Sinkronkan kolom interviewAt lama (kalender/overview) — pola
              // yang sama dengan endpoint scheduling satu lamaran.
              db.application.update({
                where: { id: row.id },
                data: { interviewAt: scheduledAt },
              }),
            ];
          }),
        );

        await db.activityLog.createMany({
          data: rows.map((row) => ({
            applicationId: row.id,
            actor: session.name,
            action: "INTERVIEW_SCHEDULED",
            detail: `Wawancara ronde ${nextRoundByApp.get(row.id) ?? 1} dijadwalkan massal ${whenLabel}`,
          })),
        });

        // Email undangan sederhana per kandidat — memakai queueEmail (arsip
        // EmailOutbox + SMTP bila aktif) dengan kind INVITE, pola yang sama
        // dengan route reschedule-slot. Fire-and-forget, tidak menggagalkan aksi.
        for (const row of rows) {
          const email = row.email.trim();
          if (!email || !email.includes("@")) continue; // lamaran impor bisa tanpa email valid
          const positionTitle = row.position?.title ?? "posisi umum";
          void queueEmail({
            toEmail: email,
            subject: `Undangan wawancara — ${positionTitle}`,
            body: [
              `Halo ${row.name},`,
              "",
              `Kamu diundang untuk mengikuti wawancara posisi ${positionTitle}.`,
              "",
              `Jadwal: ${whenLabel}`,
              `Durasi: ${durationMin} menit`,
              mode === "ONSITE"
                ? `Lokasi: ${address ?? "akan diinformasikan tim"}`
                : `Platform: ${INTERVIEW_PLATFORM_LABELS[platform]}`,
              ...(mode !== "ONSITE" && meetingLink ? ["Link meeting: " + meetingLink] : []),
              ...(interviewers.length > 0 ? ["Pewawancara: " + interviewers.join(", ")] : []),
              "",
              `Buka halaman cek status lamaran dengan kode ${row.trackingCode ?? "-"} untuk melihat detail terbaru.`,
              "",
              "Salam hangat,",
              "Tim Lumina Studio",
            ].join("\n"),
            kind: "INVITE",
            applicationId: row.id,
          });
        }

        affected = rows.length;
        logAction = "BULK_SCHEDULE_INTERVIEW";
        logDetail = `${affected} wawancara dijadwalkan massal (${whenLabel})`;
        // Realtime tambahan: daftar jadwal wawancara & kalender ikut segar.
        void emitRealtime(REALTIME_EVENTS.interviews);
      } else {
        logAction = "BULK_SCHEDULE_INTERVIEW";
        logDetail = "Tidak ada lamaran valid untuk dijadwalkan";
      }
    } else {
      // SOFT DELETE: masuk tong sampah (deletedAt=now), bukan hapus permanen.
      // Pemulihan tersedia dari tab Data.
      const result = await db.application.updateMany({
        where: { id: { in: ids } },
        data: { deletedAt: new Date() },
      });
      affected = result.count;
      logAction = "BULK_DELETE";
      logDetail = `${affected} lamaran dipindahkan ke tong sampah (soft delete)`;
    }

    await db.activityLog.create({
      data: { applicationId: null, actor: session.name, action: logAction, detail: logDetail },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, affected });
  } catch (error) {
    console.error("[POST /api/admin/applications/bulk]", error);
    return NextResponse.json({ error: "Gagal menjalankan aksi massal. Coba lagi nanti." }, { status: 500 });
  }
}
