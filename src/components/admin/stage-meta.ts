// NR-38 — helper meta untuk triase cepat daftar pelamar.
// Semua fungsi murni (tanpa React) agar bisa dipakai tabel, kartu, dan dialog
// detail sekaligus. Palet warna mengikuti aturan tema: zinc/rose/amber/emerald,
// TANPA biru/indigo/violet.

/** Nada tampilan untuk umur lamaran sejak tahap terakhir berubah. */
export type AgingTone = "fresh" | "aging" | "stale" | "none";

const AGING_DOT: Record<AgingTone, string> = {
  fresh: "bg-emerald-500",
  aging: "bg-amber-500",
  stale: "bg-rose-500",
  none: "bg-zinc-300 dark:bg-zinc-700",
};

const AGING_TEXT: Record<AgingTone, string> = {
  fresh: "text-emerald-700 dark:text-emerald-400",
  aging: "text-amber-700 dark:text-amber-400",
  stale: "text-rose-700 dark:text-rose-400",
  none: "text-muted-foreground",
};

/**
 * Nada umur lamaran dari tanggal acuan (stageUpdatedAt bila ada, fallback createdAt):
 * <2 hari = fresh, 2-7 hari = aging, >7 hari = stale. Null/invalid = none.
 */
export function agingToneFrom(iso: string | null | undefined, now = Date.now()): AgingTone {
  if (!iso) return "none";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "none";
  const days = (now - t) / 86_400_000;
  if (days < 2) return "fresh";
  if (days <= 7) return "aging";
  return "stale";
}

/** Kelas dot warna untuk nada umur — dipakai bersama span bulat 8px. */
export function agingDotClass(tone: AgingTone): string {
  return AGING_DOT[tone];
}

/** Kelas teks untuk nada umur. */
export function agingTextClass(tone: AgingTone): string {
  return AGING_TEXT[tone];
}

/** "3h" / "2mg" / "5bl" — durasi singkat untuk label kecil di badge/kartu. */
export function shortDuration(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, now - t);
  const days = Math.floor(mins / 86_400_000);
  if (days < 1) return "hari ini";
  if (days < 14) return `${days}h`;
  const weeks = Math.floor(days / 7);
  if (weeks < 9) return `${weeks}mg`;
  const months = Math.floor(days / 30);
  return `${months}bl`;
}

/* ------------------------------ Verdict gaji ------------------------------ */

export type SalaryVerdict = {
  tone: "ok" | "over" | "under" | "unset" | "noRange";
  label: string;
  /** Kelas chip lengkap (latar+teks+border) siap tempel. */
  chipClass: string;
};

const SALARY_CHIP = {
  ok: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
  over: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  under:
    "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  unset:
    "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
  noRange:
    "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
} as const;

/**
 * Bandingkan ekspektasi gaji pelamar dengan rentang posisi.
 * expectations/rentang dalam rupiah bulanan; null = tidak diisi.
 */
export function salaryVerdict(
  expectation: number | null | undefined,
  min: number | null | undefined,
  max: number | null | undefined
): SalaryVerdict {
  const fmt = (n: number) =>
    new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(n);
  if (expectation == null) {
    return { tone: "unset", label: "Gaji tidak diisi", chipClass: SALARY_CHIP.unset };
  }
  if (min == null && max == null) {
    return {
      tone: "noRange",
      label: `Rp ${fmt(expectation)}/bln`,
      chipClass: SALARY_CHIP.noRange,
    };
  }
  if (max != null && expectation > max) {
    return {
      tone: "over",
      label: `Di atas range · Rp ${fmt(expectation)}/bln`,
      chipClass: SALARY_CHIP.over,
    };
  }
  if (min != null && expectation < min) {
    return {
      tone: "under",
      label: `Di bawah range · Rp ${fmt(expectation)}/bln`,
      chipClass: SALARY_CHIP.under,
    };
  }
  return { tone: "ok", label: `Sesuai range · Rp ${fmt(expectation)}/bln`, chipClass: SALARY_CHIP.ok };
}

/* ------------------------------ Avatar inisial ----------------------------- */

/** Warna latar avatar inisial — hash nama, tanpa biru/indigo/violet. */
const AVATAR_TONES = [
  "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
] as const;

/** Inisial nama: maks 2 huruf, mis. "Lestari Rahmawati" → "LR". */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.charAt(0) ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

/** Kelas warna avatar konsisten per nama (hash sederhana). */
export function avatarToneClass(name: string | null | undefined): string {
  const key = (name ?? "").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}
