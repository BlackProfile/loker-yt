"use client";

// Panel "Apa yang Berubah" sejak kunjungan terakhir (NR-15 idea 4 — dipindah
// verbatim dari status-page.tsx pada NR-18-a). Selalu tampak bila ada isi.

import { CheckCircle2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dict } from "@/components/landing/strings";
import type { TrackChangeInfo } from "@/lib/types";
import { relativeTime } from "./status-types";

export function RecentChangesPanel({
  changes,
  nowMs,
  p,
  onDismiss,
}: {
  changes: TrackChangeInfo[];
  nowMs: number;
  p: Dict["status"]["page"];
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
          {p.changesTitle}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-11 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 sm:h-9 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
          onClick={onDismiss}
        >
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {p.changesMarkRead}
        </Button>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {changes.slice(0, 10).map((change, index) => (
          <li
            key={`${change.at}-${index}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-amber-200/70 bg-background/60 px-3 py-2 dark:border-amber-500/20"
          >
            <span className="text-sm text-amber-900 dark:text-amber-100">
              {change.text}
            </span>
            <span className="shrink-0 text-xs text-amber-700/80 dark:text-amber-300/70">
              {relativeTime(change.at, nowMs, p)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
