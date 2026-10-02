// Penjelasan tahap untuk halaman Cek Status (NR-15) — CLIENT-SAFE (tanpa import server).
// Urutan sumber teks per tahap:
//   1. Override posisi (Position.stageNotes JSON {"tahap": "teks"})
//   2. Teks bawaan (STAGE_NOTES_DEFAULT) untuk 5 status bawaan + SUBMITTED
//   3. Teks generik untuk tahap kustom tanpa override

export const STAGE_NOTES_DEFAULT: Record<string, string> = {
  SUBMITTED:
    "Lamaranmu sudah kami terima. Tim rekrutmen akan meninjau bersama kandidat lain — pantau halaman ini untuk pembaruan.",
  NEW: "Lamaranmu baru masuk dan menunggu giliran ditinjau oleh tim rekrutmen. Biasanya peninjauan pertama berlangsung beberapa hari kerja.",
  REVIEWED:
    "Lamaranmu sudah ditinjau tim kami. Bila profilmu cocok, kamu akan diundang ke tahap berikutnya lewat halaman ini dan email.",
  INTERVIEW:
    "Kamu naik ke tahap wawancara! Cek jadwal dan detail sesi pada panel di atas — jangan lupa konfirmasi kehadiranmu.",
  ACCEPTED:
    "Selamat, kamu diterima! Tim kami akan menghubungimu untuk langkah onboarding. Silakan cek checklist dokumen di halaman ini.",
  REJECTED:
    "Terima kasih sudah melamar. Kali ini kami memutuskan untuk belum melanjutkan prosesmu — datamu tetap kami simpan untuk kesempatan lain.",
};

/** Teks generik untuk tahap kustom tanpa override. */
export const STAGE_NOTE_FALLBACK = "Tim sedang meninjau lamaranmu pada tahap ini.";

/**
 * Bangun peta penjelasan untuk daftar tahap.
 * Prioritas: override posisi > teks bawaan > teks generik.
 */
export function buildStageNotes(
  stageKeys: string[],
  positionStageNotes: Record<string, string> | null,
): Record<string, string> {
  const notes: Record<string, string> = {};
  for (const key of stageKeys) {
    const clean = key.trim();
    if (!clean) continue;
    const override = positionStageNotes?.[clean];
    if (typeof override === "string" && override.trim()) {
      notes[clean] = override.trim();
      continue;
    }
    const builtIn = STAGE_NOTES_DEFAULT[clean];
    if (typeof builtIn === "string" && builtIn.trim()) {
      notes[clean] = builtIn;
      continue;
    }
    notes[clean] = STAGE_NOTE_FALLBACK;
  }
  return notes;
}

/** Parse Position.stageNotes (JSON string) secara aman — fallback null. */
export function parsePositionStageNotes(raw: string | null | undefined): Record<string, string> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === "string" && key.trim() && typeof value === "string" && value.trim()) {
        out[key.trim()] = value.trim();
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}
