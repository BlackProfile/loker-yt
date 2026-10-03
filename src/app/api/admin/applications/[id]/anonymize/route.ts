// POST /api/admin/applications/[id]/anonymize — anonimkan data pelamar (NR-19, ide 7: hak hapus data).
// Role OWNER/HR (VIEWER 403). Karyawan aktif (hiredAt terisi) tidak boleh dianonimkan (409).
// Scrub permanen (tidak dapat dibatalkan):
//   name  → "Kandidat (dianonimkan)", email → "anon-{trackingCode}@dihapus.local", phone → ""
//   socialLinks/portfolioUrl → null, experience/motivation → "", cvText → null
//   cvFileId/introFileId → null (berkas CV & intro audio = PII), transcript/aiSummary → null
//   (ringkasan & transkrip diturunkan dari isi CV/intro pelamar), extraDocs → []
//   (dokumen unggahan pelamar), offerSalary/offerNote → null (gaji & pesan offer),
//   formAnswers/screeningAnswers → seluruh nilai diganti "[dihapus]".
// Keputusan scrubbing jawaban: opsi AMAN — SEMUA nilai diganti "[dihapus]" (struktur kunci
// dipertahankan untuk statistik), bukan hanya nilai berisi "@" / 8+ digit, karena jawaban
// bebas teks bisa memuat PII tanpa penanda yang jelas; konsisten dengan teks konfirmasi UI
// "jawaban akan dihapus permanen".
// Dipertahankan: status, trackingCode, createdAt, rating, tags, stageHistory, offerStatus
// (beserta metadata offer lain), rating/rubrik/checklist/catatan admin, botFiles, onboarding.
// Log hanya mencatat kode pelacakan — TIDAK menyimpan PII lama. Respons menyertakan objek
// application hasil anonimisasi (bebas PII) agar dialog bisa menyegarkan tampilan.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, serializeApplication } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const ANON_NAME = "Kandidat (dianonimkan)";
const ANON_ANSWER = "[dihapus]";

/** Parse Record<string, unknown> dari JSON string kolom jawaban (aman terhadap nilai rusak). */
function parseAnswersMap(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // nilai rusak — perlakukan kosong
  }
  return {};
}

/** Ganti seluruh nilai jawaban dengan penanda "[dihapus]" (struktur kunci dipertahankan). */
function scrubAnswers(raw: string | null): string | null {
  const map = parseAnswersMap(raw);
  const keys = Object.keys(map);
  if (keys.length === 0) return raw && raw.trim() ? JSON.stringify({}) : raw || null;
  const scrubbed: Record<string, string> = {};
  for (const key of keys) scrubbed[key] = ANON_ANSWER;
  return JSON.stringify(scrubbed);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const existing = await db.application.findUnique({
      where: { id },
      include: APPLICATION_INCLUDE,
    });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (existing.hiredAt) {
      return NextResponse.json(
        { error: "Karyawan aktif tidak dapat dianonimkan." },
        { status: 409 },
      );
    }

    const trackingCode = existing.trackingCode ?? existing.id;
    const updated = await db.application.update({
      where: { id },
      include: APPLICATION_INCLUDE,
      data: {
        name: ANON_NAME,
        email: `anon-${trackingCode}@dihapus.local`,
        phone: "",
        socialLinks: null,
        portfolioUrl: null,
        experience: "",
        motivation: "",
        cvText: null,
        cvFileId: null,
        introFileId: null,
        transcript: null,
        aiSummary: null,
        extraDocs: "[]",
        offerSalary: null,
        offerNote: null,
        formAnswers: scrubAnswers(existing.formAnswers),
        screeningAnswers: scrubAnswers(existing.screeningAnswers),
      },
    });

    // Log & notifikasi TANPA PII lama — hanya kode pelacakan.
    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "APPLICATION_ANONYMIZED",
        detail: `Data pelamar kode ${trackingCode} dianonimkan — nama lama diganti "${ANON_NAME}", kontak/CV/jawaban dihapus permanen`,
      },
    });
    await db.notificationItem.create({
      data: {
        title: "Data pelamar dianonimkan",
        body: `Data pribadi pelamar kode ${trackingCode} telah dihapus permanen sesuai permintaan. Statistik lamaran tetap tersimpan.`,
        category: "APPLICATION",
        applicationId: id,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);

    // Objek application hasil anonimisasi (bebas PII) — dipakai dialog untuk refresh.
    return NextResponse.json({ ok: true, application: serializeApplication(updated) });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/anonymize]", error);
    return NextResponse.json(
      { error: "Gagal menganonimkan data. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
