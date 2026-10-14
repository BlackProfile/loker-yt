// POST /api/public/assessment/submit — pelamar mengumpulkan hasil tugas uji
// dari halaman Cek Status (NR-54). Multipart: { code, email, assessmentId, file }.
// Aturan:
// - Pasangan email + kode wajib cocok (sama seperti track / cv/update) — respons
//   gagal identik tanpa kebocoran info; tiap kegagalan dicatat untuk lockout.
// - Tugas uji wajib milik lamaran tersebut dan belum DIKUMPUL (409 bila sudah).
// - Lamaran berstatus final (Diterima/Ditolak) tidak menerima pengumpulan (409).
// - Berkas lewat whitelist magic bytes (PDF, dokumen, gambar, audio, video, ZIP,
//   teks) — maks 10 MB. Tersimpan sebagai FileAsset (kind=DOC) dan dirujuk
//   Assessment.submittedFileId; status tugas menjadi DIKUMPUL.
// Efek samping: ActivityLog ASSESSMENT_SUBMITTED (aktor Pelamar), notifikasi
// in-app admin, dan event realtime applications (daftar admin ikut segar).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clearAuthFails,
  clientIp,
  isLockedOut,
  isThrottled,
  lockRemainingSec,
  recordAuthFail,
} from "@/lib/status-gate";
import { MAX_UPLOAD_BYTES, saveUpload, UploadInvalidError } from "@/lib/upload";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);

    if (isLockedOut(ip)) {
      return NextResponse.json(
        { ok: false, lockedForSec: lockRemainingSec(ip) },
        { status: 429 },
      );
    }
    if (isThrottled(`assessment-submit:${ip}`, 2000)) {
      return NextResponse.json(
        { ok: false, error: "Terlalu cepat. Tunggu beberapa saat lagi." },
        { status: 429 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Data unggahan tidak valid." },
        { status: 400 },
      );
    }

    const rawCode = form.get("code");
    const rawEmail = form.get("email");
    const rawAssessmentId = form.get("assessmentId");
    const file = form.get("file");

    const codeStr = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    const emailStr = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const assessmentId = typeof rawAssessmentId === "string" ? rawAssessmentId.trim() : "";

    if (!codeStr) {
      return NextResponse.json({ ok: false, error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    if (!emailStr || !/\S+@\S+\.\S+/.test(emailStr)) {
      return NextResponse.json({ ok: false, error: "Email tidak valid." }, { status: 400 });
    }
    if (!assessmentId) {
      return NextResponse.json({ ok: false, error: "Tugas uji tidak valid." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0 || !file.name) {
      return NextResponse.json(
        { ok: false, error: "Pilih berkas hasil tugas uji terlebih dahulu." },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Ukuran berkas maksimal 10 MB." },
        { status: 413 },
      );
    }

    const application = await db.application.findUnique({
      where: { trackingCode: codeStr },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        deletedAt: true,
        position: { select: { title: true } },
      },
    });

    // Respons gagal identik dengan endpoint pelacakan lain (tanpa kebocoran info).
    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== emailStr) {
      recordAuthFail(ip);
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    clearAuthFails(ip);

    const status = application.status.trim() || "NEW";
    if (status === "ACCEPTED" || status === "REJECTED") {
      return NextResponse.json(
        { ok: false, error: "Lamaran sudah selesai diproses — hasil tugas uji tidak bisa dikirim lagi." },
        { status: 409 },
      );
    }

    const assessment = await db.assessment.findFirst({
      where: { id: assessmentId, applicationId: application.id },
      select: { id: true, title: true, status: true },
    });
    if (!assessment) {
      return NextResponse.json(
        { ok: false, error: "Tugas uji tidak ditemukan untuk lamaran ini." },
        { status: 404 },
      );
    }
    if (assessment.status === "DIKUMPUL") {
      return NextResponse.json(
        { ok: false, error: "Tugas ini sudah dikumpulkan sebelumnya." },
        { status: 409 },
      );
    }

    let assetId: string;
    try {
      const asset = await saveUpload(file, "application/octet-stream", { kind: "DOC" });
      assetId = asset.id;
    } catch (err) {
      // NR41-SEC-B (F7): berkas palsu/rusak (magic bytes tidak cocok) → 400 + log audit.
      if (err instanceof UploadInvalidError) {
        await db.activityLog
          .create({
            data: {
              applicationId: application.id,
              actor: "Pelamar",
              action: "UPLOAD_DITOLAK",
              detail: `Pengumpulan tugas uji "${assessment.title}" ditolak: tipe file tidak valid (${file.name})`,
            },
          })
          .catch(() => undefined);
        return NextResponse.json(
          { ok: false, error: "Tipe file tidak valid (berkas rusak atau palsu)" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { ok: false, error: "Gagal menyimpan berkas. Coba lagi nanti." },
        { status: 500 },
      );
    }

    await db.assessment.update({
      where: { id: assessment.id },
      data: {
        status: "DIKUMPUL",
        submittedFileId: assetId,
        completedAt: new Date(),
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "ASSESSMENT_SUBMITTED",
        detail: `${application.name} mengumpulkan tugas uji "${assessment.title}" (${file.name})`,
      },
    });

    await db.notificationItem.create({
      data: {
        title: "Hasil tugas uji dikumpulkan",
        body: `${application.name} (${application.position?.title ?? "-"}) mengumpulkan "${assessment.title}": ${file.name}`,
        category: "APPLICATION",
        applicationId: application.id,
      },
    });

    // Realtime: segarkan daftar/berkas di sisi admin.
    void emitRealtime(REALTIME_EVENTS.applications);

    return NextResponse.json({ ok: true, fileName: file.name });
  } catch (error) {
    console.error("[POST /api/public/assessment/submit]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal mengirim hasil tugas uji. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
