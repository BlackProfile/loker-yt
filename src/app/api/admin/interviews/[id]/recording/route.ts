// POST /api/admin/interviews/[id]/recording — unggah file rekaman wawancara (audio/video, maks 25MB).
// File disimpan lewat mekanisme FileAsset yang sudah ada (folder uploads/) dan
// Interview.recordingUrl diisi ke /api/files/{fileId}.
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Sesi wawancara tidak ditemukan." };

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
const AUDIO_MIME_PREFIX = "audio/";
const VIDEO_MIME_PREFIX = "video/";

const EXT_MIME_FALLBACK: Record<string, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  weba: "audio/webm",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
};

/** Nama file aman: buang path, simpan karakter umum, batasi panjang. */
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
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

    const interview = await db.interview.findUnique({ where: { id }, select: { id: true, applicationId: true, round: true } });
    if (!interview) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Data unggahan tidak valid." }, { status: 400 });
    }
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "File rekaman wajib dipilih." }, { status: 400 });
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "File rekaman kosong." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimal 25 MB." }, { status: 400 });
    }

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const mimeType = file.type || EXT_MIME_FALLBACK[ext] || "application/octet-stream";
    if (!mimeType.startsWith(AUDIO_MIME_PREFIX) && !mimeType.startsWith(VIDEO_MIME_PREFIX)) {
      return NextResponse.json(
        { error: "File harus berupa audio atau video (mis. mp3, wav, m4a, mp4, webm)." },
        { status: 400 },
      );
    }

    // Simpan lewat mekanisme FileAsset yang sudah ada (folder uploads/ di root proyek).
    const uploadsDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const storedName = `${cuidLike()}-${sanitizeFilename(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadsDir, storedName), buffer);

    const asset = await db.fileAsset.create({
      data: {
        filename: file.name,
        mimeType,
        size: file.size,
        path: `uploads/${storedName}`,
      },
      select: { id: true, filename: true },
    });

    const recordingUrl = `/api/files/${asset.id}`;
    await db.interview.update({ where: { id }, data: { recordingUrl } });
    await db.activityLog.create({
      data: {
        applicationId: interview.applicationId,
        actor: session.name,
        action: "UPLOAD",
        detail: `Rekaman wawancara ronde ${interview.round} diunggah (${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.interviews);

    return NextResponse.json({
      ok: true,
      recordingUrl,
      fileName: asset.filename,
      mimeType,
      size: file.size,
    });
  } catch (error) {
    console.error("[POST /api/admin/interviews/[id]/recording]", error);
    return NextResponse.json({ error: "Gagal mengunggah rekaman. Coba lagi nanti." }, { status: 500 });
  }
}
