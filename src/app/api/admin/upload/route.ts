// POST /api/admin/upload — unggah gambar cover posisi (OWNER/HR).
// Multipart field "file"; hanya PNG/JPEG/WebP, maksimal 3 MB.
// Disimpan dengan pola yang sama seperti route applications (folder uploads/ + FileAsset).
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { AdminUploadResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/webp"];

const EXT_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

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

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Data unggahan tidak valid." }, { status: 400 });
    }

    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "File gambar wajib diunggah." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran gambar maksimal 3 MB." }, { status: 400 });
    }

    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const mimeType = ALLOWED_MIMES.includes(file.type)
      ? file.type
      : !file.type && ext in EXT_MIME
        ? EXT_MIME[ext]
        : null;
    if (!mimeType) {
      return NextResponse.json({ error: "Gambar harus berformat PNG, JPEG, atau WebP." }, { status: 400 });
    }

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
      select: { id: true },
    });

    const body: AdminUploadResponse = { ok: true, fileId: asset.id, url: `/api/files/${asset.id}` };
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/upload]", error);
    return NextResponse.json({ error: "Gagal mengunggah gambar. Coba lagi nanti." }, { status: 500 });
  }
}
