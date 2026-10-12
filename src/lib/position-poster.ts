// SERVER-ONLY — NR49 Paket D: poster lowongan hasil AI (pembuatan gambar).
// buildPosterPrompt(position, style) → prompt bahasa Inggris untuk model gambar;
// generatePoster(position, style) → Buffer PNG/JPEG dari SDK ZAI;
// savePosterFile(buffer, positionTitle) → simpan mengikuti pola src/lib/upload.ts
// (berkas ke folder uploads/ + baris FileAsset, dilayani /api/files/{id}).
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { getZai, withTimeout, withZaiRetry } from "@/lib/ai";
import { verifyMagicBytes } from "@/lib/verify-upload";

export type PosterStyle = "minimalis" | "berani" | "hangat";

export const POSTER_STYLES: PosterStyle[] = ["minimalis", "berani", "hangat"];

const POSTER_TIMEOUT_MS = 170_000; // respons route selalu < 180 detik

/** Deskripsi gaya visual (bahasa Inggris) per pilihan style admin. */
function styleDescription(style: PosterStyle): string {
  switch (style) {
    case "berani":
      return "bold high-contrast poster design with large striking typography placement, dynamic diagonal composition, strong visual hierarchy";
    case "hangat":
      return "warm friendly illustrated poster style with soft gradients, inviting human-centered imagery, rounded shapes and a welcoming mood";
    case "minimalis":
    default:
      return "minimalist flat poster design with generous white space, clean typography placement, subtle geometric accents";
  }
}

function workModeLabel(mode: string): string {
  if (mode === "ONSITE") return "on-site at the studio";
  if (mode === "HYBRID") return "hybrid (office and remote)";
  return "remote / work from anywhere";
}

/** Prompt bahasa Inggris untuk model gambar — judul posisi ditampilkan apa adanya sebagai teks poster. */
export function buildPosterPrompt(
  position: { title: string; department: string; workMode: string; location: string; salaryText: string | null; salaryVisible: boolean; urgent: boolean },
  style: PosterStyle,
): string {
  const lines = [
    `Modern recruitment poster for a creative content studio, announcing an open position "${position.title}"`,
    `(the exact job title text "${position.title}" must appear as the main headline text overlay on the poster),`,
    `${position.department} team, work arrangement ${workModeLabel(position.workMode)} in ${position.location}.`,
    styleDescription(style),
    "Warm neutral color palette only: zinc grey background tones, rose red and amber orange accents,",
    "no dominant blue or purple colors anywhere in the image.",
    position.salaryVisible && position.salaryText
      ? `Include a small secondary text line showing the offered salary "${position.salaryText}".`
      : "Do not include any salary or numbers other than the job title text.",
    position.urgent ? "Convey a sense of urgency with an urgent hiring badge element." : "",
    "High quality, detailed, clean composition, no watermark.",
  ];
  return lines.filter(Boolean).join(" ");
}

/** Panggil model gambar SDK ZAI → Buffer gambar. Melempar Error bila gagal/kosong. */
export async function generatePoster(
  position: Parameters<typeof buildPosterPrompt>[0],
  style: PosterStyle,
): Promise<Buffer> {
  const prompt = buildPosterPrompt(position, style);
  const zai = await getZai();
  const response = await withTimeout(
    withZaiRetry((z) => z.images.generations.create({ prompt, size: "1024x1024" })),
    "Pembuatan poster AI",
    POSTER_TIMEOUT_MS,
  );
  const base64 = response?.data?.[0]?.base64;
  if (!base64) {
    throw new Error("Model gambar tidak mengembalikan hasil.");
  }
  return Buffer.from(base64, "base64");
}

/** Nama file aman: buang path, simpan karakter umum, batasi panjang (pola upload.ts). */
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

export type SavedPoster = { id: string; url: string; filename: string; mimeType: string };

/**
 * Simpan buffer poster mengikuti pola src/lib/upload.ts: berkas ditulis ke folder
 * uploads/ + metadata dicatat sebagai FileAsset, dilayani via /api/files/{id}
 * (butuh sesi admin — poster memang aset internal). Melempar Error bila buffer
 * bukan gambar yang dikenali atau penulisan gagal.
 */
export async function savePosterFile(buffer: Buffer, positionTitle: string): Promise<SavedPoster> {
  // AI bisa mengirim PNG atau JPEG — deteksi dari magic bytes sebelum ditulis.
  const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50;
  const isJpeg = buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const mimeType = isPng ? "image/png" : isJpeg ? "image/jpeg" : null;
  if (!mimeType) {
    throw new Error("Hasil gambar tidak dikenali sebagai PNG/JPEG.");
  }
  const verdict = verifyMagicBytes(buffer, mimeType);
  if (!verdict.ok) {
    throw new Error("Hasil gambar tidak lolos verifikasi.");
  }

  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const storedName = `${cuidLike()}-ai-poster-${sanitizeFilename(`${positionTitle}.png`)}`;
  await writeFile(path.join(uploadsDir, storedName), buffer);

  const asset = await db.fileAsset.create({
    data: {
      filename: `poster-${positionTitle}.png`,
      mimeType,
      size: buffer.byteLength,
      path: `uploads/${storedName}`,
      kind: "OTHER",
    },
    select: { id: true },
  });

  return {
    id: asset.id,
    url: `/api/files/${asset.id}`,
    filename: `poster-${positionTitle}.png`,
    mimeType,
  };
}
