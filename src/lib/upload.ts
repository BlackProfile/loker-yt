// Helper simpan berkas unggahan (SERVER-ONLY) — pola sama dengan route lamaran
// publik: file ditulis ke folder uploads/, metadata dicatat sebagai FileAsset,
// dilayani via /api/files/{id}. Dipakai endpoint pelamar NR-15 (perbarui CV &
// unggah dokumen onboarding).
// NR41-SEC-B (F7): setiap berkas diverifikasi magic bytes SEBELUM ditulis ke disk —
// berkas palsu/rusak melempar UploadInvalidError (respons 400 di route pemanggil).
// NR41-SEC-B (E3): helper createWebpVariant() — varian WebP terkompresi untuk cover
// posisi (maks lebar 1600px, kualitas 82), disimpan sebagai `${path}.webp`.
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { verifyMagicBytes, UPLOAD_REJECTED_MESSAGE } from "@/lib/verify-upload";

/** Error unggahan ditolak karena magic bytes tidak cocok → route harus 400. */
export class UploadInvalidError extends Error {
  constructor(message: string = UPLOAD_REJECTED_MESSAGE) {
    super(message);
    this.name = "UploadInvalidError";
  }
}

/** Nama file aman: buang path, simpan karakter umum, batasi panjang. */
export function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

/** ID mirip cuid untuk prefiks nama file tersimpan. */
function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

export type SavedUpload = { id: string };

/**
 * Simpan File (Web API) ke uploads/ + buat record FileAsset. Return id aset.
 * F7 — magic bytes diverifikasi dulu; bila palsu → UploadInvalidError (JANGAN tulis ke disk).
 * Melempar error bila penulisan gagal — pemanggil wajib try/catch.
 */
export async function saveUpload(
  file: File,
  fallbackMime: string,
  opts?: { kind?: string }, // NR-41 — kategori FileAsset (CV | INTRO | COVER | DOC | OFFER_PDF | DRAFT | OTHER)
): Promise<SavedUpload> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const storedName = `${cuidLike()}-${sanitizeFilename(file.name)}`;
  const absolutePath = path.join(uploadsDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());

  // F7 — tolak berkas yang klaim MIME-nya tidak cocok dengan isi sebenarnya.
  const mimeType = file.type || fallbackMime;
  const verdict = verifyMagicBytes(buffer, mimeType);
  if (!verdict.ok) {
    throw new UploadInvalidError();
  }

  await writeFile(absolutePath, buffer);

  const asset = await db.fileAsset.create({
    data: {
      filename: file.name,
      mimeType,
      size: file.size,
      path: `uploads/${storedName}`,
      kind: opts?.kind ?? null,
    },
    select: { id: true },
  });
  return asset;
}

/** Ukuran maksimum unggahan pelamar (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// E3 — parameter kompresi cover: maks lebar 1600px, WebP kualitas 82.
const COVER_MAX_WIDTH = 1600;
const COVER_WEBP_QUALITY = 82;

/**
 * E3 — buat varian WebP untuk cover/gambar: resize maks lebar 1600px,
 * format WebP kualitas 82, disimpan sebagai `${absolutePath}.webp`.
 * Tidak pernah melempar error — gagal kompresi tidak boleh merusak unggahan asli.
 * Return path varian bila sukses, null bila gagal/tidak perlu.
 */
export async function createWebpVariant(absolutePath: string, sourceBuffer?: Buffer): Promise<string | null> {
  try {
    const sharp = (await import("sharp")).default;
    const input = sourceBuffer ?? absolutePath;
    const output = `${absolutePath}.webp`;
    await sharp(input)
      .resize({ width: COVER_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: COVER_WEBP_QUALITY })
      .toFile(output);
    return output;
  } catch (error) {
    console.error("[upload] gagal membuat varian WebP:", error);
    return null;
  }
}

/** True bila file berupa PDF (MIME application/pdf atau ekstensi .pdf). */
export function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return ext === ".pdf";
}

/** True bila file PDF/JPG/PNG (MIME daftar atau ekstensi aman). */
export function isOnboardingDocFile(file: File): boolean {
  const allowedMimes = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  if (allowedMimes.includes(file.type)) return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return [".pdf", ".jpg", ".jpeg", ".png"].includes(ext);
}
