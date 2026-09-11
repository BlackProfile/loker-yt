"use client";

import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// Warna badge per status (tema terang, netral zinc, aksen rose — tanpa biru/indigo).
const BADGE_STYLES: Record<ApplicationStatus, string> = {
  NEW: "bg-amber-100 text-amber-700 border-amber-200",
  REVIEWED: "bg-zinc-100 text-zinc-700 border-zinc-200",
  INTERVIEW: "bg-orange-100 text-orange-700 border-orange-200",
  ACCEPTED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  REJECTED: "bg-rose-100 text-rose-700 border-rose-200",
};

// Warna segmen bar distribusi & dot legend (hex-safe via Tailwind bg classes).
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
