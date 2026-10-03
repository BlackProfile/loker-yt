// NR-24 — Dokumen internal lamaran (hasil MCU, dokumen HR, dll — hanya terlihat admin).
// GET  /api/admin/applications/[id]/internal-docs — daftar dokumen urut terbaru (semua role admin).
// POST /api/admin/applications/[id]/internal-docs — unggah dokumen baru (OWNER/HR), multipart form-data.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { InternalDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

const FILE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const NAME_MAX = 120;

function serializeDoc(row: {
  id: string;
  name: string;
  fileId: string;
  uploadedBy: string;
  createdAt: Date;
}): InternalDoc {
  return {
    id: row.id,
    name: row.name,
    fileId: row.fileId,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Nama file aman: buang path, simpan karakter umum, batasi panjang (pola route lamaran publik). */
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

/** ID mirip cuid untuk prefiks nama file tersimpan. */
function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

/** Simpan file ke folder uploads/ + catat FileAsset (pola sama dengan route lamaran publik). */
async function saveUpload(file: File, fallbackMime: string): Promise<{ id: string }> {
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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const existing = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const rows = await db.applicationInternalDoc.findMany({
      where: { applicationId: id },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ docs: rows.map(serializeDoc) });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/internal-docs]", error);
    return NextResponse.json({ error: "Gagal memuat dokumen internal." }, { status: 500 });
  }
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

    const existing = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json(
        { error: "Data unggahan tidak valid (harus multipart form-data)." },
        { status: 400 }
      );
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Berkas wajib dipilih." }, { status: 400 });
    }
    if (file.size > FILE_MAX_BYTES) {
      return NextResponse.json(
        { error: "Ukuran berkas maksimal 10 MB." },
        { status: 400 }
      );
    }

    const rawName = form.get("name");
    if (rawName !== null && typeof rawName !== "string") {
      return NextResponse.json({ error: "Nama dokumen harus berupa teks." }, { status: 400 });
    }
    const name = (typeof rawName === "string" && rawName.trim() ? rawName.trim() : file.name).slice(0, NAME_MAX);

    // Simpan file fisik + FileAsset, lalu catat dokumen internal pada lamaran.
    const asset = await saveUpload(file, "application/octet-stream");
    const created = await db.applicationInternalDoc.create({
      data: {
        applicationId: id,
        name,
        fileId: asset.id,
        uploadedBy: session.name,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "INTERNAL_DOC",
        detail: `Dokumen internal diunggah: ${name}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ doc: serializeDoc(created) }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/internal-docs]", error);
    return NextResponse.json({ error: "Gagal mengunggah dokumen internal. Coba lagi nanti." }, { status: 500 });
  }
}
