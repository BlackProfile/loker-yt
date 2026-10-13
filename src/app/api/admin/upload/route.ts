// POST /api/admin/upload — unggah gambar cover posisi manual (OWNER/HR).
// NR41-SEC-B (F7 + E3): dipakai form posisi (position-form-page "Unggah Gambar").
// - Menerima PNG/JPEG/WebP, maks 3 MB (selaras COVER_MIME & COVER_MAX_BYTES di UI).
// - F7: magic bytes diverifikasi SEBELUM ditulis ke disk (klaim MIME bisa dipalsukan).
// - E3: varian WebP terkompresi (maks lebar 1600px, kualitas 82) dibuat sebagai
//   `${path}.webp` dan dilayani /api/files/{id} bila browser mendukung WebP.
//   Unggahan asli TIDAK diubah.
// -> { ok: true, fileId, url } (AdminUploadResponse).
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { createWebpVariant, sanitizeFilename, UploadInvalidError } from "@/lib/upload";
import { verifyMagicBytes, UPLOAD_REJECTED_MESSAGE } from "@/lib/verify-upload";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB — sama dengan batas UI
const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/webp"];

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
      return NextResponse.json({ error: "File gambar wajib dipilih." }, { status: 400 });
    }
    if (file.size === 0 || !file.name) {
      return NextResponse.json({ error: "File gambar kosong." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran gambar maksimal 3 MB." }, { status: 400 });
    }
    if (!ALLOWED_MIMES.includes(file.type)) {
      return NextResponse.json(
        { error: "Format gambar harus PNG, JPEG, atau WebP." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // F7 — tolak berkas palsu/rusak sebelum menyentuh disk.
    const verdict = verifyMagicBytes(buffer, file.type);
    if (!verdict.ok) {
      return NextResponse.json({ ok: false, error: UPLOAD_REJECTED_MESSAGE }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const storedName = `${cuidLike()}-cover-${sanitizeFilename(file.name)}`;
    const absolutePath = path.join(uploadsDir, storedName);
    await writeFile(absolutePath, buffer);

    // E3 — varian WebP terkompresi (gagal kompresi tidak merusak asli).
    await createWebpVariant(absolutePath, buffer);

    const asset = await db.fileAsset.create({
      data: {
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        path: `uploads/${storedName}`,
        kind: "COVER",
      },
      select: { id: true },
    });

    // Realtime: cover baru tersedia — segarkan kartu publik & admin.
    void emitRealtime(REALTIME_EVENTS.positions);

    return NextResponse.json({ ok: true, fileId: asset.id, url: `/api/files/${asset.id}` });
  } catch (error) {
    // Berkas palsu yang lolos uji MIME terdeteksi di sini bila dipanggil lewat helper lain.
    if (error instanceof UploadInvalidError) {
      return NextResponse.json({ ok: false, error: UPLOAD_REJECTED_MESSAGE }, { status: 400 });
    }
    console.error("[POST /api/admin/upload]", error);
    return NextResponse.json({ error: "Gagal mengunggah gambar. Coba lagi nanti." }, { status: 500 });
  }
}
