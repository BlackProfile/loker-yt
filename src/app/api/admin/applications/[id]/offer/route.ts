// POST  /api/admin/applications/[id]/offer — kirim penawaran ke kandidat (OWNER/HR).
// PATCH /api/admin/applications/[id]/offer — perbarui penawaran / batalkan (EXPIRED) /
//         kirim ulang / setujui ("approve") / tolak ("reject") permintaan persetujuan.
// Offer berstatus PENDING sampai pelamar menjawab dari halaman status (terima/tolak).
// NR44 — persetujuan offer dua lapis: bila Setting "offer_approval".enabled=true dan
// pengaju role HR, offer TIDAK langsung terkirim; draft disimpan + offerApprovalState
// PENDING menunggu OWNER approve/reject. Bila setting mati atau pengaju OWNER,
// jalur kirim lama berjalan PERSIS seperti sebelumnya (bentuk respons tidak berubah).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, serializeApplication } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { sendSystemEvent } from "@/lib/notify";
import { emitWebhook } from "@/lib/webhooks";
import { POSITION_TYPES } from "@/lib/types";
import { readOfferApprovalEnabled } from "@/app/api/admin/offer-approval/route";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

function formatDateId(value: Date | null | undefined): string {
  return value ? value.toLocaleDateString("id-ID", { dateStyle: "long" }) : "-";
}

function buildOfferMessage(
  template: string | null | undefined,
  values: { name: string; positionTitle: string; salary: string; type: string; startDate: Date | null; deadline: Date | null },
): string {
  const base =
    template ??
    "Selamat {nama}!\n\nKami terkesan denganmu dan dengan senang hati menawarkanmu posisi {posisi} ({tipe}) di Lumina Studio dengan kompensasi {gaji}. Rencana mulai bekerja: {tanggal}.\n\nSilakan jawab penawaran ini paling lambat {deadline} melalui halaman status lamaran dengan kode pelacakanmu.\n\nSalam hangat,\nTim Lumina Studio";
  return fill(base, {
    nama: values.name,
    posisi: values.positionTitle,
    tipe: values.type,
    gaji: values.salary || "sesuai kesepakatan",
    tanggal: formatDateId(values.startDate),
    deadline: formatDateId(values.deadline),
  });
}

async function loadApp(id: string) {
  return db.application.findUnique({
    where: { id },
    include: {
      ...APPLICATION_INCLUDE,
      position: { select: { title: true, offerTemplate: true, probationMonths: true } },
    },
  });
}

type SendOfferInput = {
  existing: NonNullable<Awaited<ReturnType<typeof loadApp>>>;
  salary: string | null;
  type: string;
  startDate: Date | null;
  note: string | null;
  deadlineDays: number;
  actorName: string;
  /** Field tambahan (mis. resolve offerApprovalState saat OWNER menyetujui). */
  extraData?: Record<string, unknown>;
};

/**
 * JALUR KIRIM LAMA — dipakai POST langsung (owner/flow mati) dan aksi "approve".
 * Persis perilaku sebelumnya: update offerStatus PENDING + offerSentAt, email/
 * telegram via sendSystemEvent, webhook offer.sent sekali, ActivityLog OFFER_SENT.
 */
async function sendOfferNow(input: SendOfferInput) {
  const { existing, salary, type, startDate, note, deadlineDays, actorName } = input;
  const id = existing.id;
  const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);

  const updated = await db.application.update({
    where: { id },
    data: {
      offerStatus: "PENDING",
      offerSalary: salary,
      offerType: type,
      offerStartDate: startDate,
      offerNote: note,
      offerDeadline: deadline,
      offerSentAt: new Date(),
      offerRespondedAt: null,
      offerDeclineReason: null,
      ...(input.extraData ?? {}),
    },
    include: APPLICATION_INCLUDE,
  });

  const message = buildOfferMessage(existing.position?.offerTemplate, {
    name: existing.name,
    positionTitle: existing.position?.title ?? "-",
    salary: salary ?? "",
    type,
    startDate,
    deadline,
  });

  await db.activityLog.createMany({
    data: [
      {
        applicationId: id,
        actor: actorName,
        action: "OFFER_SENT",
        detail: `Penawaran dikirim (${type}${salary ? `, ${salary}` : ""}) — jawaban sebelum ${formatDateId(deadline)}`,
      },
    ],
  });

  void sendSystemEvent({
    title: "Offer Dikirim",
    detail: `${existing.name} menerima penawaran posisi ${existing.position?.title ?? "-"} (${type}${salary ? `, ${salary}` : ""}). Jawaban sebelum ${formatDateId(deadline)}.`,
    applicationId: id,
    action: "OFFER_SENT",
  });

  // Webhook keluar: offer PERTAMA dikirim ke pelamar — fire-and-forget.
  // Hanya saat transisi pertama ke PENDING (belum pernah ada offer sebelumnya);
  // edit/batal/kirim-ulang via PATCH tidak pernah memicu webhook ini.
  // Gaji TIDAK dikirim ke endpoint eksternal — salary selalu null.
  if (!existing.offerStatus) {
    void emitWebhook("offer.sent", {
      applicationId: id,
      trackingCode: existing.trackingCode ?? null,
      positionTitle: existing.position?.title ?? null,
      type,
      salary: null,
      sentAt: (updated.offerSentAt ?? new Date()).toISOString(),
      deadline: deadline.toISOString(),
    });
  }

  void emitRealtime(REALTIME_EVENTS.applications);
  return { application: serializeApplication(updated), message, deadline };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const existing = await loadApp(id);
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (existing.status === "REJECTED") {
      return NextResponse.json({ error: "Lamaran sudah ditolak — tidak bisa menerima offer." }, { status: 400 });
    }
    if (existing.offerStatus === "PENDING") {
      return NextResponse.json({ error: "Offer masih menunggu jawaban pelamar." }, { status: 400 });
    }
    if (existing.offerStatus === "ACCEPTED") {
      return NextResponse.json({ error: "Offer sudah diterima pelamar." }, { status: 400 });
    }

    const salary = typeof data.salary === "string" && data.salary.trim() ? data.salary.trim().slice(0, 120) : null;
    const type =
      typeof data.type === "string" && (POSITION_TYPES as readonly string[]).includes(data.type.trim())
        ? data.type.trim()
        : existing.position?.title
          ? (existing.offerType ?? "Full-time")
          : "Full-time";
    const startDate = typeof data.startDate === "string" && data.startDate ? new Date(data.startDate) : null;
    if (data.startDate !== undefined && data.startDate !== null && data.startDate !== "" && (!startDate || Number.isNaN(startDate.getTime()))) {
      return NextResponse.json({ error: "Tanggal mulai tidak valid." }, { status: 400 });
    }
    const note = typeof data.note === "string" && data.note.trim() ? data.note.trim().slice(0, 1000) : null;

    let deadlineDays = 3;
    if (typeof data.deadlineDays === "number" && Number.isInteger(data.deadlineDays)) {
      deadlineDays = Math.min(30, Math.max(1, data.deadlineDays));
    }

    // NR44 — HR tidak boleh mengirim ulang saat permintaan approval masih PENDING.
    if (existing.offerApprovalState === "PENDING" && session.role !== "OWNER") {
      return NextResponse.json(
        { error: "Permintaan offer masih menunggu persetujuan OWNER." },
        { status: 400 },
      );
    }

    const approvalEnabled = await readOfferApprovalEnabled();

    // NR44 — alur persetujuan: aktif + pengaju HR -> simpan draft, JANGAN kirim.
    if (approvalEnabled && session.role !== "OWNER") {
      const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);
      const updated = await db.application.update({
        where: { id },
        data: {
          // Draft offer — offerStatus/offerSentAt TIDAK diubah (belum terkirim).
          offerSalary: salary,
          offerType: type,
          offerStartDate: startDate,
          offerNote: note,
          offerDeadline: deadline,
          offerApprovalState: "PENDING",
          offerRequestedBy: session.name,
          offerRequestedAt: new Date(),
        },
        include: APPLICATION_INCLUDE,
      });

      const positionTitle = existing.position?.title ?? "-";
      await db.activityLog.create({
        data: {
          applicationId: id,
          actor: session.name,
          action: "OFFER_REQUESTED",
          detail: `Permintaan persetujuan offer diajukan (${type}${salary ? `, ${salary}` : ""}) — menunggu OWNER`,
        },
      });

      // Notifikasi in-app untuk OWNER (fire-and-forget).
      void db.notificationItem
        .create({
          data: {
            title: "Permintaan persetujuan offer",
            body: `${session.name} mengajukan offer untuk ${existing.name} — posisi ${positionTitle}, gaji ${salary ?? "belum diisi"}.`,
            category: "SYSTEM",
          },
        })
        .catch(() => undefined);

      void emitRealtime(REALTIME_EVENTS.applications);
      return NextResponse.json(
        {
          approvalRequired: true,
          application: serializeApplication(updated),
          message: `Permintaan persetujuan offer untuk ${existing.name} dikirim ke OWNER.`,
        },
        { status: 201 },
      );
    }

    // Jalur lama (setting mati atau pelaku OWNER) — PERSIS perilaku sebelumnya.
    // Bila ada permintaan PENDING yang di-override OWNER dengan kirim langsung,
    // resolve statusnya menjadi APPROVED (aditif, tidak mengubah aliran lama).
    const resolvePending =
      existing.offerApprovalState === "PENDING"
        ? {
            offerApprovalState: "APPROVED" as const,
            offerReviewedBy: session.name,
            offerReviewedAt: new Date(),
          }
        : undefined;

    const result = await sendOfferNow({
      existing,
      salary,
      type,
      startDate,
      note,
      deadlineDays,
      actorName: session.name,
      extraData: resolvePending,
    });

    if (resolvePending) {
      await db.activityLog.create({
        data: {
          applicationId: id,
          actor: session.name,
          action: "OFFER_APPROVED",
          detail: "Permintaan persetujuan disetujui (kirim langsung oleh OWNER)",
        },
      });
    }

    return NextResponse.json({ application: result.application, message: result.message }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/offer]", error);
    return NextResponse.json({ error: "Gagal mengirim penawaran. Coba lagi nanti." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const existing = await loadApp(id);
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (!existing.offerStatus && !existing.offerApprovalState) {
      return NextResponse.json({ error: "Belum ada penawaran untuk lamaran ini." }, { status: 400 });
    }

    // NR44 — aksi persetujuan OWNER atas permintaan offer dari HR.
    if (data.action === "approve" || data.action === "reject") {
      if (session.role !== "OWNER") {
        return NextResponse.json(FORBIDDEN, { status: 403 });
      }
      if (existing.offerApprovalState !== "PENDING") {
        return NextResponse.json(
          { error: "Tidak ada permintaan persetujuan offer yang menunggu." },
          { status: 400 },
        );
      }

      const reviewNote =
        typeof data.note === "string" && data.note.trim()
          ? data.note.trim().slice(0, 1000)
          : typeof data.offerReviewNote === "string" && data.offerReviewNote.trim()
            ? data.offerReviewNote.trim().slice(0, 1000)
            : null;

      if (data.action === "reject") {
        // Catatan WAJIB saat menolak agar HR tahu alasan revisi.
        if (!reviewNote) {
          return NextResponse.json(
            { error: "Catatan penolakan wajib diisi." },
            { status: 400 },
          );
        }
        const rejected = await db.application.update({
          where: { id },
          data: {
            offerApprovalState: "REJECTED",
            offerReviewedBy: session.name,
            offerReviewedAt: new Date(),
            offerReviewNote: reviewNote,
          },
          include: APPLICATION_INCLUDE,
        });
        await db.activityLog.create({
          data: {
            applicationId: id,
            actor: session.name,
            action: "OFFER_REJECTED",
            detail: `Permintaan offer ditolak — ${reviewNote}`,
          },
        });
        void emitRealtime(REALTIME_EVENTS.applications);
        return NextResponse.json({ application: serializeApplication(rejected) });
      }

      // approve — jalur kirim lama PERSIS, memakai nilai draft tersimpan.
      let deadlineDays = 3;
      if (typeof data.deadlineDays === "number" && Number.isInteger(data.deadlineDays)) {
        deadlineDays = Math.min(30, Math.max(1, data.deadlineDays));
      }
      const result = await sendOfferNow({
        existing,
        salary: existing.offerSalary,
        type: existing.offerType ?? "Full-time",
        startDate: existing.offerStartDate,
        note: existing.offerNote,
        deadlineDays,
        actorName: session.name,
        extraData: {
          offerApprovalState: "APPROVED",
          offerReviewedBy: session.name,
          offerReviewedAt: new Date(),
          offerReviewNote: reviewNote,
        },
      });
      await db.activityLog.create({
        data: {
          applicationId: id,
          actor: session.name,
          action: "OFFER_APPROVED",
          detail: `Permintaan offer disetujui${reviewNote ? ` — ${reviewNote}` : ""}`,
        },
      });
      void sendSystemEvent({
        title: "Offer Disetujui",
        detail: `${session.name} menyetujui permintaan offer untuk ${existing.name} — penawaran dikirim.`,
        applicationId: id,
        action: "OFFER_APPROVED",
      });
      return NextResponse.json({ application: result.application, message: result.message }, { status: 201 });
    }

    // Aksi khusus: batalkan offer (tandai EXPIRED) atau kirim ulang.
    if (data.action === "CANCEL") {
      if (existing.offerStatus !== "PENDING") {
        return NextResponse.json({ error: "Hanya offer yang menunggu jawaban bisa dibatalkan." }, { status: 400 });
      }
      const updated = await db.application.update({
        where: { id },
        data: { offerStatus: "EXPIRED" },
        include: APPLICATION_INCLUDE,
      });
      await db.activityLog.create({
        data: { applicationId: id, actor: session.name, action: "OFFER_EXPIRED", detail: "Penawaran dibatalkan admin" },
      });
      void emitRealtime(REALTIME_EVENTS.applications);
      return NextResponse.json({ application: serializeApplication(updated) });
    }

    if (data.action === "RESEND") {
      if (existing.offerStatus !== "PENDING") {
        return NextResponse.json({ error: "Hanya offer yang menunggu jawaban bisa dikirim ulang." }, { status: 400 });
      }
      // NR44 — HR tidak boleh mengirim ulang saat masih ada permintaan PENDING.
      if (existing.offerApprovalState === "PENDING" && session.role !== "OWNER") {
        return NextResponse.json(
          { error: "Permintaan offer masih menunggu persetujuan OWNER." },
          { status: 400 },
        );
      }
      let deadlineDays = 3;
      if (typeof data.deadlineDays === "number" && Number.isInteger(data.deadlineDays)) {
        deadlineDays = Math.min(30, Math.max(1, data.deadlineDays));
      }
      const deadline = new Date(Date.now() + deadlineDays * 24 * 60 * 60 * 1000);
      const updated = await db.application.update({
        where: { id },
        data: { offerDeadline: deadline, offerSentAt: new Date() },
        include: APPLICATION_INCLUDE,
      });
      await db.activityLog.create({
        data: { applicationId: id, actor: session.name, action: "OFFER_SENT", detail: `Penawaran dikirim ulang — jawaban sebelum ${formatDateId(deadline)}` },
      });
      void emitRealtime(REALTIME_EVENTS.applications);
      return NextResponse.json({ application: serializeApplication(updated) });
    }

    if (existing.offerStatus !== "PENDING") {
      return NextResponse.json({ error: "Hanya offer yang menunggu jawaban bisa diedit." }, { status: 400 });
    }

    const updateData: {
      offerSalary?: string | null;
      offerType?: string;
      offerStartDate?: Date | null;
      offerNote?: string | null;
      offerDeadline?: Date;
    } = {};

    if (data.salary !== undefined) {
      updateData.offerSalary = typeof data.salary === "string" && data.salary.trim() ? data.salary.trim().slice(0, 120) : null;
    }
    if (data.type !== undefined) {
      const type = typeof data.type === "string" ? data.type.trim() : "";
      if (!(POSITION_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json({ error: "Jenis pekerjaan tidak valid." }, { status: 400 });
      }
      updateData.offerType = type;
    }
    if (data.startDate !== undefined) {
      if (data.startDate === null || data.startDate === "") {
        updateData.offerStartDate = null;
      } else if (typeof data.startDate === "string") {
        const parsed = new Date(data.startDate);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Tanggal mulai tidak valid." }, { status: 400 });
        }
        updateData.offerStartDate = parsed;
      }
    }
    if (data.note !== undefined) {
      updateData.offerNote = typeof data.note === "string" && data.note.trim() ? data.note.trim().slice(0, 1000) : null;
    }
    if (data.deadlineDays !== undefined) {
      if (typeof data.deadlineDays !== "number" || !Number.isInteger(data.deadlineDays) || data.deadlineDays < 1 || data.deadlineDays > 30) {
        return NextResponse.json({ error: "Batas jawaban harus 1-30 hari." }, { status: 400 });
      }
      updateData.offerDeadline = new Date(Date.now() + data.deadlineDays * 24 * 60 * 60 * 1000);
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const updated = await db.application.update({ where: { id }, data: updateData, include: APPLICATION_INCLUDE });
    await db.activityLog.create({
      data: { applicationId: id, actor: session.name, action: "OFFER_UPDATED", detail: "Detail penawaran diperbarui" },
    });
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ application: serializeApplication(updated) });
  } catch (error) {
    console.error("[PATCH /api/admin/applications/[id]/offer]", error);
    return NextResponse.json({ error: "Gagal memperbarui penawaran. Coba lagi nanti." }, { status: 500 });
  }
}
