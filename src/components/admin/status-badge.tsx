"use client";

import type { ApplicationStatus, StageKey } from "@/lib/types";
import { stageBadgeClass, stageLabel, stageMeta } from "@/lib/stages";
import { cn } from "@/lib/utils";

/**
 * Badge tahap pipeline: label & warna diambil dari @/lib/stages.
 * 5 tahap bawaan tampil persis seperti sebelumnya; tahap kustom
 * mendapat palet hash konsisten (tanpa biru/indigo/violet).
 */
export function StatusBadge({
  status,
  className,
}: {
  status: StageKey;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        stageBadgeClass(status),
        className
      )}
    >
      {stageLabel(status)}
    </span>
  );
}

/**
 * Warna segmen bar distribusi dashboard — berbasis fungsi tahap.
 * Menerima bucket dashboard: 5 status bawaan atau "CUSTOM" (agregat
 * seluruh tahap kustom, ditampilkan teal agar berbeda dari bawaan).
 */
export function statusBarColor(bucket: ApplicationStatus | "CUSTOM"): string {
  if (bucket === "CUSTOM") return "bg-teal-500";
  return stageMeta(bucket).palette.bar;
}

/** Warna dot legend/stepper — berbasis fungsi tahap (bucket sama seperti statusBarColor). */
export function stageDotColor(stage: StageKey): string {
  return stageMeta(stage).palette.dot;
}

/** Warna latar lembut untuk section/kolom bertahap. */
export function stageSoftBg(stage: StageKey): string {
  return stageMeta(stage).palette.soft;
}

// Badge skor AI: >=75 emerald, >=50 amber, 0-49 rose, null -> zinc "Belum".
const AI_SCORE_STYLES = {
  high: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
  mid: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  low: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900",
  none: "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
} as const;

export function aiScoreStyle(score: number | null): string {
  if (score == null) return AI_SCORE_STYLES.none;
  if (score >= 75) return AI_SCORE_STYLES.high;
  if (score >= 50) return AI_SCORE_STYLES.mid;
  return AI_SCORE_STYLES.low;
}

export function AiScoreBadge({
  score,
  className,
}: {
  score: number | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap tabular-nums",
        aiScoreStyle(score),
        className
      )}
    >
      {score == null ? "Belum" : score}
    </span>
  );
}
