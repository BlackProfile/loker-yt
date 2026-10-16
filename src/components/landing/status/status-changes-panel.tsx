"use client";

// Panel "Apa yang Berubah" sejak kunjungan terakhir (NR-15 idea 4 — dipindah
// verbatim dari status-page.tsx pada NR-18-a). Selalu tampak bila ada isi.
// NR62: baris ringkasan jadi daftar polos (titik + teks, tanpa kotak per baris);
// tombol "Tandai dibaca" jadi tombol ikon X di header kartu (semantik sama).

import { Sparkles, X } from "lucide-react";
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
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
          {p.changesTitle}
        </p>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-amber-700 hover:bg-amber-100 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-500/15 dark:hover:text-amber-200"
          onClick={onDismiss}
          aria-label={p.changesMarkRead}
          title={p.changesMarkRead}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <ul className="mt-2.5 flex flex-col gap-1.5">
        {changes.slice(0, 10).map((change, index) => (
          <li key={`${change.at}-${index}`} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-[7px] size-1.5 shrink-0 rounded-full bg-amber-500/80 dark:bg-amber-400/80"
            />
            <span className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">
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
