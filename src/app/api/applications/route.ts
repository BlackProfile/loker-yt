// POST /api/applications — kirim lamaran dari form publik.
// Menerima multipart/form-data (dengan file CV/audio intro) ATAU application/json (kompatibilitas).
// Mendukung fitur per posisi v3: kuota pelamar, berkas wajib, pertanyaan screening,
// sumber pelamar + UTM, auto-reply template, dan info tes/assignment.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateUniqueTrackingCode } from "@/lib/tracking";
import { parseScreeningQuestions, parseStringRecord } from "@/lib/seed";
import { CV_MAX_BYTES, INTRO_MAX_BYTES, type ApplySuccessResponse } from "@/lib/types";
import { startBackgroundProcessing } from "@/lib/processing";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_AUDIO_MIMES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
];

const AUDIO_EXT_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
};

const SCREENING_ANSWER_MAX = 500; // batas karakter tiap jawaban screening

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown): string | null {
  const trimmed = asTrimmedString(value);
  return trimmed.length > 0 ? trimmed : null;
}

/** Nama file aman: buang path, simpan karakter umum, batasi panjang. */
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

/** ID mirip cuid untuk prefiks nama file tersimpan. */
function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

type SavedFile = { id: string };

async function saveUpload(file: File, fallbackMime: string): Promise<SavedFile> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const storedName = `${cuidLike()}-${sanitizeFilename(file.name)}`;
  const absolutePath = path.join(uploadsDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, buffer);

  const asset = await db.fileAsset.create({
    data: {
      filename: file.name,
      mimeType: file.type || fallbackMime,
      size: file.size,
      path: `uploads/${storedName}`,
    },
    select: { id: true },
  });
  return asset;
}

/** Substitusi variabel template balasan: {nama}, {posisi}, {kode}. */
function fillTemplate(template: string, name: string, positionTitle: string, code: string): string {
  return template
    .replace(/\{nama\}/g, name)
    .replace(/\{posisi\}/g, positionTitle)
    .replace(/\{kode\}/g, code);
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    const fields: Record<string, string> = {};
    let cvFile: File | null = null;
    let introFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return NextResponse.json({ error: "Data lamaran tidak valid." }, { status: 400 });
      }
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") {
          fields[key] = value;
          continue;
        }
        // File kosong (tidak dipilih) diabaikan.
        if (value.size === 0 || !value.name) continue;
        if (key === "cvFile") cvFile = value;
        else if (key === "introFile") introFile = value;
      }
    } else {
      const body: unknown = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json({ error: "Data lamaran tidak valid." }, { status: 400 });
      }
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        fields[key] = typeof value === "string" ? value : value == null ? "" : String(value);
      }
    }

    const name = asTrimmedString(fields.name);
    const email = asTrimmedString(fields.email);
    const phone = asTrimmedString(fields.phone);
    const positionId = asTrimmedString(fields.positionId);
    const portfolioUrl = asOptionalString(fields.portfolioUrl);
    const socialLinks = asOptionalString(fields.socialLinks);
    const experience = asTrimmedString(fields.experience);
    const motivation = asTrimmedString(fields.motivation);
    // Sumber pelamar & UTM (metadata non-kritis: dipotong bila melebihi batas).
    const source = asOptionalString(fields.source)?.slice(0, 40) ?? null;
    const utmSource = asOptionalString(fields.utmSource)?.slice(0, 60) ?? null;
    const utmMedium = asOptionalString(fields.utmMedium)?.slice(0, 60) ?? null;
    const utmCampaign = asOptionalString(fields.utmCampaign)?.slice(0, 60) ?? null;

    if (name.length < 3) {
      return NextResponse.json({ error: "Nama minimal 3 karakter." }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    if (phone.replace(/\D/g, "").length < 8) {
      return NextResponse.json({ error: "Nomor telepon/WhatsApp minimal 8 digit." }, { status: 400 });
    }
    if (!positionId) {
      return NextResponse.json({ error: "Posisi wajib dipilih." }, { status: 400 });
    }
    const position = await db.position.findUnique({ where: { id: positionId } });
    const now = new Date();
    // Posisi terbuka = aktif, belum lewat closesAt, dan publishAt sudah tercapai.
    if (
      !position ||
      !position.isActive ||
      (position.closesAt && position.closesAt <= now) ||
      (position.publishAt && position.publishAt > now)
    ) {
      return NextResponse.json({ error: "Posisi tidak ditemukan atau sudah ditutup" }, { status: 400 });
    }
    if (experience.length < 10) {
      return NextResponse.json({ error: "Ceritakan pengalamanmu minimal 10 karakter." }, { status: 400 });
    }
    if (motivation.length < 10) {
      return NextResponse.json({ error: "Ceritakan motivasimu minimal 10 karakter." }, { status: 400 });
    }

    // Cek kuota pelamar (lamaran non-ditolak) bila posisi memakai kuota.
    if (position.maxApplicants != null) {
      const used = await db.application.count({
        where: { positionId: position.id, status: { not: "REJECTED" } },
      });
      if (used >= position.maxApplicants) {
        return NextResponse.json(
          { error: "Kuota pelamar untuk posisi ini sudah penuh." },
          { status: 409 },
        );
      }
    }

    // Cooldown lamar ulang: posisi dapat membatasi jeda minimal setelah melamar (mis. setelah ditolak).
    const cooldownDays = position.reapplyCooldownDays ?? 0;
    if (cooldownDays > 0) {
      const cutoff = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000);
      const recent = await db.application.findFirst({
        where: { positionId: position.id, email, createdAt: { gt: cutoff } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      });
      if (recent) {
        const canReapplyAt = new Date(recent.createdAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
        const dateLabel = canReapplyAt.toLocaleDateString("id-ID", { dateStyle: "long" });
        const rejectedRecently = recent.status === "REJECTED";
        return NextResponse.json(
          {
            error: rejectedRecently
              ? `Kamu baru saja ditolak untuk posisi ini. Coba lamar lagi setelah ${dateLabel}.`
              : `Kamu sudah melamar posisi ini. Lamarmu masih diproses — cek status dengan kode pelacakanmu.`,
            cooldownUntil: canReapplyAt.toISOString(),
          },
          { status: 429 },
        );
      }
    }

    // Validasi berkas wajib sesuai konfigurasi posisi.
    if (position.requireCv && !cvFile) {
      return NextResponse.json({ error: "CV wajib diunggah untuk posisi ini." }, { status: 400 });
    }
    if (position.requireIntro && !introFile) {
      return NextResponse.json({ error: "Audio perkenalan wajib diunggah untuk posisi ini." }, { status: 400 });
    }
    if (position.requirePortfolio && !portfolioUrl && !socialLinks) {
      return NextResponse.json(
        { error: "Portofolio atau link sosial media wajib untuk posisi ini." },
        { status: 400 },
      );
    }

    // Validasi file opsional
    if (cvFile) {
      if (cvFile.size > CV_MAX_BYTES) {
        return NextResponse.json({ error: "Ukuran CV maksimal 5 MB." }, { status: 400 });
      }
      const isPdf =
        cvFile.type === "application/pdf" ||
        (!cvFile.type && cvFile.name.toLowerCase().endsWith(".pdf"));
      if (!isPdf) {
        return NextResponse.json({ error: "CV harus berupa file PDF." }, { status: 400 });
      }
    }
    if (introFile) {
      if (introFile.size > INTRO_MAX_BYTES) {
        return NextResponse.json({ error: "Ukuran audio perkenalan maksimal 10 MB." }, { status: 400 });
      }
      const ext = introFile.name.slice(introFile.name.lastIndexOf(".")).toLowerCase();
      const mimeOk =
        ALLOWED_AUDIO_MIMES.includes(introFile.type) ||
        (!introFile.type && ext in AUDIO_EXT_MIME);
      if (!mimeOk) {
        return NextResponse.json(
          { error: "Audio perkenalan harus berformat MP3, WAV, M4A, atau WEBM." },
          { status: 400 },
        );
      }
    }

    // Validasi jawaban pertanyaan screening posisi (jika ada).
    const questions = parseScreeningQuestions(position.screeningQuestions);
    let screeningAnswersJson: string | null = null;
    if (questions.length > 0) {
      const rawAnswers = asOptionalString(fields.screeningAnswers);
      const parsed = rawAnswers ? parseStringRecord(rawAnswers) : null;
      if (rawAnswers && !parsed) {
        return NextResponse.json({ error: "Format jawaban screening tidak valid." }, { status: 400 });
      }
      const record: Record<string, string> = {};
      for (const question of questions) {
        const answer = (parsed?.[question.id] ?? "").trim();
        if (question.required && !answer) {
          return NextResponse.json(
            { error: `Jawaban untuk pertanyaan "${question.label}" wajib diisi.` },
            { status: 400 },
          );
        }
        if (answer) {
          if (answer.length > SCREENING_ANSWER_MAX) {
            return NextResponse.json(
              { error: `Jawaban untuk pertanyaan "${question.label}" maksimal ${SCREENING_ANSWER_MAX} karakter.` },
              { status: 400 },
            );
          }
          record[question.id] = answer;
        }
      }
      screeningAnswersJson = JSON.stringify(record);
    }

    // Simpan file (opsional) ke folder uploads + catat FileAsset
    const cvAsset = cvFile ? await saveUpload(cvFile, "application/pdf") : null;
    const introAsset = introFile
      ? await saveUpload(introFile, AUDIO_EXT_MIME[introFile.name.slice(introFile.name.lastIndexOf(".")).toLowerCase()] ?? "audio/mpeg")
      : null;

    const trackingCode = await generateUniqueTrackingCode();

    const created = await db.application.create({
      data: {
        name,
        email,
        phone,
        positionId,
        portfolioUrl,
        socialLinks,
        experience,
        motivation,
        trackingCode,
        cvFileId: cvAsset?.id ?? null,
        introFileId: introAsset?.id ?? null,
        source,
        utmSource,
        utmMedium,
        utmCampaign,
        screeningAnswers: screeningAnswersJson,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: created.id,
        actor: "Pelamar",
        action: "APPLICATION_SUBMITTED",
        detail: `Lamaran masuk untuk posisi ${position.title}`,
      },
    });

    // Pipeline latar belakang: AI screening -> transkripsi ASR -> notifikasi webhook.
    // Fire-and-forget: tidak memblokir respons dan dijamin tidak melempar error.
    void startBackgroundProcessing(created.id).catch(() => {});

    // Auto-reply dari template posisi (bila diatur) + info tes/assignment posisi.
    const autoReply = position.applyTemplate
      ? fillTemplate(position.applyTemplate, name, position.title, trackingCode)
      : null;
    const assignment =
      position.assignmentTitle || position.assignmentUrl || position.assignmentNote
        ? {
            title: position.assignmentTitle ?? null,
            url: position.assignmentUrl ?? null,
            note: position.assignmentNote ?? null,
          }
        : null;

    const body: ApplySuccessResponse = {
      ok: true,
      id: created.id,
      trackingCode,
      autoReply,
      assignment,
    };
    // Realtime: beri tahu semua client (panel admin) bahwa ada lamaran baru.
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    console.error("[POST /api/applications]", error);
    return NextResponse.json({ error: "Gagal mengirim lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
