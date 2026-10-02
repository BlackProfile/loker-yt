// POST /api/public/cv/update — pelamar memperbarui CV dari halaman Cek Status
// (NR-15, idea 11). Multipart: { code, email, file }.
// Aturan:
// - Pasangan email + kode wajib cocok (sama seperti track/withdraw).
// - Hanya PDF (MIME application/pdf atau ekstensi .pdf), maks 10 MB.
// - Lamaran berstatus final (Diterima/Ditolak) tidak boleh mengganti CV (409).
// - Berkas disimpan sebagai FileAsset (folder uploads/, dilayani /api/files/{id})
//   dan cvFileId lamaran diganti ke aset baru.
// Efek samping: ActivityLog CV_UPDATED (aktor Pelamar) + notifikasi in-app admin.
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
import { isPdfFile, MAX_UPLOAD_BYTES, saveUpload } from "@/lib/upload";

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
    if (isThrottled(`cv-update:${ip}`, 2000)) {
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
    const file = form.get("file");

    const codeStr = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    const emailStr = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

    if (!codeStr) {
      return NextResponse.json({ ok: false, error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    if (!emailStr || !/\S+@\S+\.\S+/.test(emailStr)) {
      return NextResponse.json({ ok: false, error: "Email tidak valid." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0 || !file.name) {
      return NextResponse.json({ ok: false, error: "Pilih berkas CV (PDF) terlebih dahulu." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Ukuran berkas maksimal 10 MB." },
        { status: 413 },
      );
    }
    if (!isPdfFile(file)) {
      return NextResponse.json(
        { ok: false, error: "CV harus berupa berkas PDF." },
        { status: 400 },
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
        { ok: false, error: "Lamaran sudah selesai diproses — CV tidak bisa diperbarui lagi." },
        { status: 409 },
      );
    }

    let assetId: string;
    try {
      const asset = await saveUpload(file, "application/pdf");
      assetId = asset.id;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Gagal menyimpan berkas. Coba lagi nanti." },
        { status: 500 },
      );
    }

    await db.application.update({
      where: { id: application.id },
      data: { cvFileId: assetId },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "CV_UPDATED",
        detail: `${application.name} memperbarui CV dari halaman status (${file.name})`,
      },
    });

    await db.notificationItem.create({
      data: {
        title: "CV diperbarui pelamar",
        body: `${application.name} (${application.position?.title ?? "-"}) mengunggah CV baru: ${file.name}`,
        category: "APPLICATION",
        applicationId: application.id,
      },
    });

    return NextResponse.json({ ok: true, fileName: file.name });
  } catch (error) {
    console.error("[POST /api/public/cv/update]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal memperbarui CV. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
