// POST /api/applications — kirim lamaran dari form publik.
// Menerima multipart/form-data (dengan file CV/audio intro) ATAU application/json (kompatibilitas).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateUniqueTrackingCode } from "@/lib/tracking";
import { CV_MAX_BYTES, INTRO_MAX_BYTES } from "@/lib/types";
import { startBackgroundProcessing } from "@/lib/processing";

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
    if (!position || !position.isActive || (position.closesAt && position.closesAt <= now)) {
      return NextResponse.json({ error: "Posisi tidak ditemukan atau sudah ditutup" }, { status: 400 });
    }
    if (experience.length < 10) {
      return NextResponse.json({ error: "Ceritakan pengalamanmu minimal 10 karakter." }, { status: 400 });
    }
    if (motivation.length < 10) {
      return NextResponse.json({ error: "Ceritakan motivasimu minimal 10 karakter." }, { status: 400 });
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

    return NextResponse.json({ ok: true, id: created.id, trackingCode }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/applications]", error);
    return NextResponse.json({ error: "Gagal mengirim lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
