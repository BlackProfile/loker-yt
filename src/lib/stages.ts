// Helper pipeline tahapan (stage) per lowongan — CLIENT-SAFE (tanpa import server).
// Application.status menyimpan tahap sebagai string: 5 status bawaan ATAU
// label tahap kustom milik posisi (Position.stages). File ini satu-satunya
// sumber kebenaran untuk label, warna, dan urutan tahap.

import {
  APPLICATION_STATUSES,
  STAGE_CATEGORIES,
  STATUS_LABELS,
  type ApplicationStatus,
  type StageCategory,
  type StageKey,
} from "@/lib/types";

/** Tahap bawaan bila posisi tidak mendefinisikan stages kustom. */
export const DEFAULT_STAGES: StageKey[] = [...APPLICATION_STATUSES];

export function isBuiltInStage(stage: string): stage is ApplicationStatus {
  return (APPLICATION_STATUSES as string[]).includes(stage);
}

/** Normalisasi daftar stages posisi: bersih, unik, maks 12; kosong -> bawaan. */
export function stagesForPosition(rawStages: string[] | null | undefined): StageKey[] {
  if (!rawStages || rawStages.length === 0) return [...DEFAULT_STAGES];
  const cleaned: StageKey[] = [];
  for (const item of rawStages) {
    const stage = typeof item === "string" ? item.trim() : "";
    if (stage.length > 0 && stage.length <= 40 && !cleaned.includes(stage)) cleaned.push(stage);
  }
  return cleaned.length > 0 ? cleaned.slice(0, 12) : [...DEFAULT_STAGES];
}

/** Label tampilan sebuah tahap: bawaan pakai STATUS_LABELS, kustom pakai teksnya sendiri. */
export function stageLabel(stage: StageKey): string {
  return isBuiltInStage(stage) ? STATUS_LABELS[stage] : stage;
}

/* ---------------------------------- Palet warna ---------------------------------- */
/* Palet TANPA biru/indigo/violet — konsisten dengan tema zinc/rose/amber.           */

type StagePalette = {
  badge: string; // untuk badge/chip kecil
  dot: string; // untuk dot legend & stepper
  bar: string; // untuk segmen bar & header kolom kanban
  soft: string; // latar lembut (kanban kolom, highlight)
};

const BUILT_IN_PALETTE: Record<ApplicationStatus, StagePalette> = {
  NEW: {
    badge:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
    dot: "bg-amber-400",
    bar: "bg-amber-400",
    soft: "bg-amber-50 dark:bg-amber-950/40",
  },
  REVIEWED: {
    badge:
      "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
    dot: "bg-zinc-400",
    bar: "bg-zinc-400",
    soft: "bg-zinc-50 dark:bg-zinc-900/60",
  },
  INTERVIEW: {
    badge:
      "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900",
    dot: "bg-orange-500",
    bar: "bg-orange-500",
    soft: "bg-orange-50 dark:bg-orange-950/40",
  },
  ACCEPTED: {
    badge:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    soft: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  REJECTED: {
    badge:
      "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900",
    dot: "bg-rose-500",
    bar: "bg-rose-500",
    soft: "bg-rose-50 dark:bg-rose-950/40",
  },
};

// Palet tahap kustom (dipilih via hash nama tahap agar konsisten antar render).
const CUSTOM_PALETTE: StagePalette[] = [
  {
    badge:
      "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900",
    dot: "bg-rose-500",
    bar: "bg-rose-500",
    soft: "bg-rose-50 dark:bg-rose-950/40",
  },
  {
    badge:
      "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
    dot: "bg-amber-400",
    bar: "bg-amber-400",
    soft: "bg-amber-50 dark:bg-amber-950/40",
  },
  {
    badge:
      "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
    soft: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  {
    badge:
      "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900",
    dot: "bg-orange-500",
    bar: "bg-orange-500",
    soft: "bg-orange-50 dark:bg-orange-950/40",
  },
  {
    badge:
      "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-400 dark:border-teal-900",
    dot: "bg-teal-500",
    bar: "bg-teal-500",
    soft: "bg-teal-50 dark:bg-teal-950/40",
  },
  {
    badge:
      "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-950 dark:text-pink-400 dark:border-pink-900",
    dot: "bg-pink-500",
    bar: "bg-pink-500",
    soft: "bg-pink-50 dark:bg-pink-950/40",
  },
  {
    badge:
      "bg-yellow-100 text-yellow-700 border-yellow-200 dark:bg-yellow-950 dark:text-yellow-400 dark:border-yellow-900",
    dot: "bg-yellow-400",
    bar: "bg-yellow-400",
    soft: "bg-yellow-50 dark:bg-yellow-950/40",
  },
  {
    badge:
      "bg-lime-100 text-lime-700 border-lime-200 dark:bg-lime-950 dark:text-lime-400 dark:border-lime-900",
    dot: "bg-lime-500",
    bar: "bg-lime-500",
    soft: "bg-lime-50 dark:bg-lime-950/40",
  },
];

function hashStage(stage: StageKey): number {
  let hash = 0;
  for (let i = 0; i < stage.length; i++) {
    hash = (hash * 31 + stage.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Warna + label untuk sebuah tahap (bawaan maupun kustom). */
export function stageMeta(stage: StageKey): { label: string; palette: StagePalette } {
  if (isBuiltInStage(stage)) {
    return { label: STATUS_LABELS[stage], palette: BUILT_IN_PALETTE[stage] };
  }
  return { label: stage, palette: CUSTOM_PALETTE[hashStage(stage) % CUSTOM_PALETTE.length] };
}

/** Kelas badge untuk tahap — drop-in pengganti BADGE_STYLES[status]. */
export function stageBadgeClass(stage: StageKey): string {
  return stageMeta(stage).palette.badge;
}

/** Kelas dot/bar untuk tahap — drop-in pengganti STATUS_DOT_COLORS[status]. */
export function stageDotClass(stage: StageKey): string {
  return stageMeta(stage).palette.dot;
}

/** Kelas latar lembut untuk kolom kanban/section tahap. */
export function stageSoftClass(stage: StageKey): string {
  return stageMeta(stage).palette.soft;
}

/**
 * Daftar kolom kanban untuk kumpulan lamaran terfilter:
 * - satu posisi dipilih -> tahap milik posisi itu
 * - tanpa/tanda posisi   -> 5 tahap bawaan + "LAINNYA" untuk tahap kustom
 */
export const OTHER_STAGE_KEY = "__LAINNYA__";

export function kanbanColumns(
  stages: string[] | null | undefined,
  hasPositionFilter: boolean,
): StageKey[] {
  if (hasPositionFilter && stages && stages.length > 0) {
    return stagesForPosition(stages);
  }
  return [...DEFAULT_STAGES];
}

/** Bucket dashboard: tahap bawaan dipetakan apa adanya; tahap kustom masuk "CUSTOM". */
export function dashboardBucket(stage: StageKey): ApplicationStatus | "CUSTOM" {
  return isBuiltInStage(stage) ? stage : "CUSTOM";
}

/* ---------------------- Kategori fitur per tahap (Pipeline) ---------------------- */
/* Admin dikelompokkan per kategori: Ditinjau | Wawancara | Diterima | Ditolak.     */
/* Tahap bawaan kategorinya tetap; tahap kustom dipetakan lewat                       */
/* Position.stageCategories, dengan heuristik kata kunci sebagai nilai awal.        */

const INTERVIEW_KEYWORDS = [
  "wawancara", "interview", "tes", "test", "tugas", "assignment", "ujian", "screening",
];
const ACCEPTED_KEYWORDS = [
  "offer", "penawaran", "onboard", "kontrak", "hired", "diterima", "gaji",
];

/** Nilai awal kategori tahap kustom dari nama tahapnya (heuristik kata kunci). */
export function defaultCategoryForCustomStage(stage: string): StageCategory {
  const lower = stage.toLowerCase();
  if (ACCEPTED_KEYWORDS.some((k) => lower.includes(k))) return "ACCEPTED";
  if (INTERVIEW_KEYWORDS.some((k) => lower.includes(k))) return "INTERVIEW";
  return "REVIEW";
}

function isStageCategory(value: unknown): value is StageCategory {
  return typeof value === "string" && (STAGE_CATEGORIES as string[]).includes(value);
}

/**
 * Kategori fitur untuk sebuah tahap:
 * - bawaan: tetap (NEW/REVIEWED->Ditinjau, INTERVIEW->Wawancara, dst.)
 * - kustom: ikut Position.stageCategories bila ada, selain itu heuristik nama.
 */
export function categoryForStage(
  stage: StageKey,
  stageCategories?: Record<string, StageCategory> | null,
): StageCategory {
  if (isBuiltInStage(stage)) {
    if (stage === "INTERVIEW") return "INTERVIEW";
    if (stage === "ACCEPTED") return "ACCEPTED";
    if (stage === "REJECTED") return "REJECTED";
    return "REVIEW";
  }
  const mapped = stageCategories?.[stage];
  if (mapped && isStageCategory(mapped)) return mapped;
  return defaultCategoryForCustomStage(stage);
}

/** Tahap tahap milik satu kategori untuk sebuah posisi (urut sesuai pipeline). */
export function stagesForCategory(
  stages: string[] | null | undefined,
  stageCategories: Record<string, StageCategory> | null | undefined,
  category: StageCategory,
): StageKey[] {
  return stagesForPosition(stages).filter(
    (s) => categoryForStage(s, stageCategories) === category,
  );
}
