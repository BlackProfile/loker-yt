// Helper simpan berkas unggahan (SERVER-ONLY) — pola sama dengan route lamaran
// publik: file ditulis ke folder uploads/, metadata dicatat sebagai FileAsset,
// dilayani via /api/files/{id}. Dipakai endpoint pelamar NR-15 (perbarui CV &
// unggah dokumen onboarding).
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";

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
 * Melempar error bila penulisan gagal — pemanggil wajib try/catch.
 */
export async function saveUpload(file: File, fallbackMime: string): Promise<SavedUpload> {
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

/** Ukuran maksimum unggahan pelamar (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

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
