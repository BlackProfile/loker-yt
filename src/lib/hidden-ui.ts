// NR-22 — UI tersembunyi per posisi.
// Daftar blok di dialog detail lamaran yang bisa disembunyikan per posisi
// (disimpan sebagai JSON string[] pada Position.hiddenUi).
// Kunci stabil — jangan ubah nilai `key` yang sudah ada di database.

export type HiddenUiKey =
  | "ai" // Panel AI (analisis & rekomendasi otomatis)
  | "portfolio" // InfoItem Portofolio & Media Sosial
  | "experience" // Pengalaman & Alasan Bergabung
  | "screening" // Jawaban Screening (mode klasik)
  | "rubric" // Rubrik Evaluasi
  | "checklist" // Checklist Evaluasi
  | "salary" // Ekspektasi Gaji
  | "assessment"; // Tugas Uji (tracker NR-24)

export type HiddenUiOption = {
  key: HiddenUiKey;
  label: string;
  hint: string;
};

export const HIDDEN_UI_OPTIONS: HiddenUiOption[] = [
  {
    key: "ai",
    label: "Panel AI",
    hint: "Analisis CV otomatis dan rekomendasi AI — kurang relevan untuk posisi operasional non-kreatif.",
  },
  {
    key: "portfolio",
    label: "Portofolio & Media Sosial",
    hint: "Tautan portofolio dan akun sosial media pelamar.",
  },
  {
    key: "experience",
    label: "Pengalaman & Alasan Bergabung",
    hint: "Teks pengalaman dan motivasi dari formulir lamaran.",
  },
  {
    key: "screening",
    label: "Jawaban Screening",
    hint: "Jawaban pertanyaan screening mode klasik.",
  },
  {
    key: "rubric",
    label: "Rubrik Evaluasi",
    hint: "Penilaian rubrik per kriteria di dalam dialog detail.",
  },
  {
    key: "checklist",
    label: "Checklist Evaluasi",
    hint: "Checklist pemeriksaan kelengkapan lamaran.",
  },
  {
    key: "salary",
    label: "Ekspektasi Gaji",
    hint: "Kolom ekspektasi gaji pelamar dan perbandingannya dengan rentang posisi.",
  },
  {
    key: "assessment",
    label: "Tugas Uji",
    hint: "Pelacak tugas uji (kirim, tenggat, pengumpulan) di dialog detail.",
  },
];

const VALID_KEYS = new Set<string>(HIDDEN_UI_OPTIONS.map((o) => o.key));

/** Parse aman kolom DB Position.hiddenUi (JSON string[]) — buang kunci tak dikenal. */
export function parseHiddenUi(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && VALID_KEYS.has(v));
  } catch {
    return [];
  }
}

/** Cek apakah blok tertentu disembunyikan untuk posisi (aman thd posisi null). */
export function isHiddenUi(hiddenUi: string[] | null | undefined, key: HiddenUiKey): boolean {
  return Array.isArray(hiddenUi) && hiddenUi.includes(key);
}
