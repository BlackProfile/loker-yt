"use client";

import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// Warna badge per status (netral zinc, aksen rose — tanpa biru/indigo),
// dengan varian dark mode agar tetap terbaca.
const BADGE_STYLES: Record<ApplicationStatus, string> = {
  NEW: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  REVIEWED:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  INTERVIEW:
    "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900",
  ACCEPTED:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
  REJECTED:
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900",
};

// Warna segmen bar distribusi & dot legend (via Tailwind bg classes).
export const STATUS_BAR_COLORS: Record<ApplicationStatus, string> = {
  NEW: "bg-amber-400",
  REVIEWED: "bg-zinc-400",
  INTERVIEW: "bg-orange-500",
  ACCEPTED: "bg-emerald-500",
  REJECTED: "bg-rose-500",
};

export const STATUS_DOT_COLORS: Record<ApplicationStatus, string> = {
  NEW: "bg-amber-400",
  REVIEWED: "bg-zinc-400",
  INTERVIEW: "bg-orange-500",
  ACCEPTED: "bg-emerald-500",
  REJECTED: "bg-rose-500",
};

export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE_STYLES[status],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
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
