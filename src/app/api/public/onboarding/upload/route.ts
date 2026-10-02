// POST /api/public/onboarding/upload — pelamar mengunggah dokumen onboarding
// dari halaman Cek Status (NR-15, perbaikan bug 404: route sebelumnya TIDAK ADA
// padahal dipanggil klien). Multipart: { code, docId, file }.
// Aturan:
// - Cukup kode pelacakan (email tidak dikirim klien pada panggilan ini) + lamaran
//   tidak boleh berstatus final (Diterima/Ditolak).
// - docId wajib ada di parseOnboardingDocs(application.onboardingDocs).
// - Terima PDF/JPG/PNG, maks 10 MB; simpan FileAsset (folder uploads/).
// - Entri dokumen pada onboardingDocs diperbarui {done:true, fileId}.
// Keamanan: throttle per IP (pola withdraw via status-gate).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, isThrottled } from "@/lib/status-gate";
import { parseOnboardingDocs } from "@/lib/seed";
import { isOnboardingDocFile, MAX_UPLOAD_BYTES, saveUpload } from "@/lib/upload";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (isThrottled(`onboarding-upload:${ip}`, 2000)) {
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
    const rawDocId = form.get("docId");
    const file = form.get("file");

    const codeStr = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
    const docIdStr = typeof rawDocId === "string" ? rawDocId.trim() : "";

    if (!codeStr) {
      return NextResponse.json({ ok: false, error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    if (!docIdStr) {
      return NextResponse.json({ ok: false, error: "Dokumen tidak valid." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0 || !file.name) {
      return NextResponse.json(
        { ok: false, error: "Pilih berkas dokumen terlebih dahulu." },
        { status: 400 },
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Ukuran berkas maksimal 10 MB." },
        { status: 413 },
      );
    }
    if (!isOnboardingDocFile(file)) {
      return NextResponse.json(
        { ok: false, error: "Dokumen harus berupa PDF, JPG, atau PNG." },
        { status: 400 },
      );
    }

    const application = await db.application.findUnique({
      where: { trackingCode: codeStr },
      select: { id: true, name: true, status: true, deletedAt: true, onboardingDocs: true },
    });
    if (!application || application.deletedAt) {
      return NextResponse.json({ ok: false, error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
    }

    const status = application.status.trim() || "NEW";
    if (status === "ACCEPTED" || status === "REJECTED") {
      // Lamaran final: proses onboarding tidak berlaku lagi.
      return NextResponse.json(
        { ok: false, error: "Lamaran sudah selesai diproses — dokumen tidak bisa diunggah lagi." },
        { status: 409 },
      );
    }

    const docs = parseOnboardingDocs(application.onboardingDocs);
    const targetDoc = docs.find((doc) => doc.id === docIdStr);
    if (!targetDoc) {
      return NextResponse.json(
        { ok: false, error: "Dokumen tidak ditemukan pada checklist onboarding." },
        { status: 404 },
      );
    }

    let assetId: string;
    try {
      const asset = await saveUpload(file, "application/octet-stream");
      assetId = asset.id;
    } catch {
      return NextResponse.json(
        { ok: false, error: "Gagal menyimpan berkas. Coba lagi nanti." },
        { status: 500 },
      );
    }

    // Perbarui entri dokumen dalam JSON onboardingDocs (done + fileId).
    const updatedDocs = docs.map((doc) =>
      doc.id === docIdStr ? { ...doc, done: true, fileId: assetId } : doc,
    );
    await db.application.update({
      where: { id: application.id },
      data: { onboardingDocs: JSON.stringify(updatedDocs) },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "ONBOARDING_DOC_UPLOADED",
        detail: `${application.name} mengunggah dokumen onboarding "${targetDoc.label}" (${file.name})`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/onboarding/upload]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal mengunggah dokumen. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
