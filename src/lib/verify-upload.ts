// NR41-SEC-B (F7) — verifikasi magic bytes unggahan (SERVER-ONLY).
// Browser bisa memalsukan Content-Type; berkas yang benar-benar berbeda dari klaim
// MIME-nya ditolak SEBELUM ditulis ke disk. Dipakai oleh src/lib/upload.ts (helper
// terpusat) dan route unggahan yang menulis berkas langsung.
// Pesan error standar untuk konsumen API:
//   { ok: false, error: "Tipe file tidak valid (berkas rusak atau palsu)" }

export const UPLOAD_REJECTED_MESSAGE = "Tipe file tidak valid (berkas rusak atau palsu)";

export type MagicBytesResult = { ok: boolean; reason?: string };

// Signature biner: [offset, bytes hex, label]
type Signature = { offset: number; bytes: number[]; ext: string };

const SIGNATURES: Signature[] = [
  { offset: 0, bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], ext: "pdf" }, // "%PDF-"
  { offset: 0, bytes: [0xff, 0xd8, 0xff], ext: "jpeg" }, // JPEG
  { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47], ext: "png" }, // PNG
  { offset: 0, bytes: [0x47, 0x49, 0x46, 0x38], ext: "gif" }, // "GIF8"
  // WEBP: "RIFF"...."WEBP" — dicek khusus di bawah
  // WAV: "RIFF"...."WAVE" — dicek khusus di bawah
  { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04], ext: "zip/docx/xlsx" }, // "PK\x03\x04"
  { offset: 0, bytes: [0x49, 0x44, 0x33], ext: "mp3" }, // "ID3"
  { offset: 0, bytes: [0xff, 0xfb], ext: "mp3" }, // MPEG-1 Layer 3
  { offset: 0, bytes: [0xff, 0xf3], ext: "mp3" }, // MPEG-2 Layer 3
  { offset: 0, bytes: [0xff, 0xf1], ext: "aac" }, // ADTS AAC
  { offset: 0, bytes: [0xff, 0xf9], ext: "aac" }, // ADTS AAC
  { offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53], ext: "ogg" }, // "OggS"
  { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70], ext: "mp4/mov/m4a" }, // "ftyp" di offset 4
  { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3], ext: "webm/mkv" }, // EBML (WebM/MKV)
  // Pelengkap whitelist (aman & dipakai fitur lama):
  { offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], ext: "doc/xls (OLE2)" }, // .doc/.xls lama
  { offset: 0, bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00], ext: "sqlite" }, // "SQLite format 3\0"
];

// MIME yang punya signature pasti — bila klaim MIME ini, signature HARUS cocok.
const KNOWN_MIME_MAP: { mimes: string[]; check: (buf: Buffer) => boolean }[] = [
  { mimes: ["application/pdf"], check: (b) => hasSignature(b, "pdf") },
  { mimes: ["image/jpeg", "image/jpg"], check: (b) => hasSignature(b, "jpeg") },
  { mimes: ["image/png"], check: (b) => hasSignature(b, "png") },
  { mimes: ["image/gif"], check: (b) => hasSignature(b, "gif") },
  { mimes: ["image/webp"], check: isWebp },
  { mimes: [
    "application/zip",
    "application/x-zip-compressed",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // xlsx
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", // pptx
  ], check: (b) => hasSignature(b, "zip/docx/xlsx") },
  { mimes: ["audio/mpeg", "audio/mp3"], check: (b) => hasSignature(b, "mp3") },
  { mimes: ["audio/aac", "audio/x-hx-aac-adts"], check: (b) => hasSignature(b, "aac") },
  { mimes: ["audio/ogg", "application/ogg"], check: (b) => hasSignature(b, "ogg") },
  { mimes: ["audio/wav", "audio/x-wav", "audio/vnd.wave", "audio/wave"], check: isWav },
  { mimes: ["video/mp4", "audio/mp4", "audio/m4a", "audio/x-m4a", "video/quicktime"], check: (b) => hasSignature(b, "mp4/mov/m4a") },
  { mimes: ["video/webm", "audio/webm"], check: (b) => hasSignature(b, "webm/mkv") },
  { mimes: ["video/x-matroska"], check: (b) => hasSignature(b, "webm/mkv") },
  { mimes: ["application/msword", "application/vnd.ms-excel"], check: (b) => hasSignature(b, "doc/xls (OLE2)") },
];

function startsWithAt(buf: Buffer, offset: number, bytes: number[]): boolean {
  if (buf.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (buf[offset + i] !== bytes[i]) return false;
  }
  return true;
}

function hasSignature(buf: Buffer, ext: string): boolean {
  return SIGNATURES.some((sig) => sig.ext === ext && startsWithAt(buf, sig.offset, sig.bytes));
}

/** WEBP: "RIFF" di offset 0 dan "WEBP" di offset 8. */
function isWebp(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  );
}

/** WAV: "RIFF" di offset 0 dan "WAVE" di offset 8. */
function isWav(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  return (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45
  );
}

/** Teks bersih (CSV/TXT/JSON): tidak ada byte biner di sampel pertama. */
function looksLikePlainText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 1024));
  for (const byte of sample) {
    // Perbolehkan printable, tab/LF/CR, dan UTF-8 lanjutan (0x80-0xBF) + BOM.
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte === 0xef || byte === 0xbb || byte === 0xbf) continue;
    if (byte < 0x20) return false;
    if (byte === 0x7f) return false;
  }
  return true;
}

/**
 * Verifikasi magic bytes berkas terhadap whitelist signature.
 * - MIME dikenal → signature HARUS cocok (ok:false bila tidak).
 * - application/octet-stream / tanpa MIME → hanya lolos bila ada signature yang
 *   cocok dari daftar putih ATAU konten teks bersih (CSV/JSON untuk impor).
 * - MIME teks (text/*) → lolos bila konten teks bersih.
 * - berkas kosong (0 byte) → ok:false.
 */
export function verifyMagicBytes(buffer: Buffer, mimeType: string): MagicBytesResult {
  if (!buffer || buffer.length === 0) {
    return { ok: false, reason: "berkas kosong" };
  }

  const mime = (mimeType || "").trim().toLowerCase();

  // Teks: CSV/TXT/JSON untuk impor data — wajib benar-benar teks.
  if (mime.startsWith("text/") || mime === "application/json") {
    return looksLikePlainText(buffer)
      ? { ok: true }
      : { ok: false, reason: "konten bukan teks yang valid" };
  }

  // Klaim MIME dikenal → wajib cocok dengan signature-nya.
  for (const entry of KNOWN_MIME_MAP) {
    if (entry.mimes.includes(mime)) {
      if (entry.check(buffer)) return { ok: true };
      return { ok: false, reason: `signature tidak cocok dengan ${mime}` };
    }
  }

  // application/octet-stream / MIME tak dikenal: izinkan hanya bila signature
  // cocok dengan daftar putih ATAU teks bersih.
  if (mime === "application/octet-stream" || mime === "") {
    if (looksLikePlainText(buffer)) return { ok: true };
    if (SIGNATURES.some((sig) => startsWithAt(buffer, sig.offset, sig.bytes))) return { ok: true };
    if (isWebp(buffer) || isWav(buffer)) return { ok: true };
    return { ok: false, reason: "tipe berkas tidak dikenali" };
  }

  // MIME tidak ada di daftar dikenal: perlakukan sama seperti octet-stream —
  // hanya lolos bila signature cocok dengan daftar putih ATAU teks bersih.
  if (looksLikePlainText(buffer)) return { ok: true };
  if (SIGNATURES.some((sig) => startsWithAt(buffer, sig.offset, sig.bytes))) return { ok: true };
  if (isWebp(buffer) || isWav(buffer)) return { ok: true };
  return { ok: false, reason: `tipe berkas tidak dikenali (${mime})` };
}
