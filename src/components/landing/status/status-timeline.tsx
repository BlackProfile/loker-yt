"use client";

// Timeline progres lamaran (dipindah verbatim dari status-page.tsx pada NR-18-a):
// stepper vertikal + tanggal tahap + chip estimasi + catatan tahap expandable.
// Selalu tampak (tidak dilipat).

import { CheckCircle2, ChevronDown, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fillTemplate, formatDateTimeId } from "@/components/landing/landing-utils";
import type { Dict, Lang } from "@/components/landing/strings";
import type { StepView } from "./status-types";
import { formatShortDate } from "./status-types";

export function StatusTimeline({
  steps,
  currentKey,
  stageHistoryAt,
  stageNote,
  openNoteKey,
  setOpenNoteKey,
  currentEstimateDays,
  nowMs,
  lang,
  p,
}: {
  steps: StepView[];
  currentKey: string | undefined;
  stageHistoryAt: Record<string, string>;
  stageNote: Record<string, string> | null | undefined;
  openNoteKey: string | null;
  setOpenNoteKey: (value: string | null) => void;
  currentEstimateDays: number | null;
  nowMs: number;
  lang: Lang;
  p: Dict["status"]["page"];
}) {
  return (
    <Card className="rounded-2xl p-5 md:p-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {p.timelineTitle}
      </p>
      <ol className="mt-4 space-y-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isCurrent = step.key === currentKey && !step.done;
          // NR-15 (idea 1): tanggal tahap dari stageHistory (match by key).
          const stepDateIso = stageHistoryAt[step.key] ?? step.at ?? null;
          // NR-15 (idea 2): penjelasan tahap (default collapsed, satu terbuka).
          const noteText = stageNote?.[step.key] ?? null;
          const noteOpen = openNoteKey === step.key;
          return (
            <li key={`${step.key}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                {step.done ? (
                  <CheckCircle2
                    className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                ) : isCurrent ? (
                  <span
                    className="relative flex h-6 w-6 shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/30" />
                    <span className="relative h-3 w-3 rounded-full bg-rose-500" />
                  </span>
                ) : (
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center"
                    aria-hidden="true"
                  >
                    <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/40 bg-muted" />
                  </span>
                )}
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={
                      step.done
                        ? "my-1 w-px flex-1 bg-emerald-500/50 dark:bg-emerald-400/50"
                        : "my-1 w-px flex-1 bg-border"
                    }
                  />
                ) : null}
              </div>
              <div className={isLast ? "pb-0" : "pb-5"}>
                <div className="flex flex-wrap items-center gap-2">
                  <p
                    className={
                      step.done || isCurrent
                        ? "text-sm font-medium"
                        : "text-sm text-muted-foreground"
                    }
                  >
                    {step.label || step.key}
                  </p>
                  {isCurrent ? (
                    <Badge
                      variant="outline"
                      className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                    >
                      {p.currentStepBadge}
                    </Badge>
                  ) : null}
                  {/* NR-15 (idea 3): estimasi hari di tahap aktif (hanya current step) */}
                  {isCurrent && currentEstimateDays !== null ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                      <Clock className="h-3 w-3" aria-hidden="true" />
                      {fillTemplate(p.estimateChip, { n: currentEstimateDays })}
                    </span>
                  ) : null}
                </div>
                {step.done && stepDateIso ? (
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    {formatShortDate(stepDateIso, lang, nowMs)}
                  </p>
                ) : stepDateIso && isCurrent ? (
                  <p className="text-xs text-muted-foreground">
                    {formatDateTimeId(stepDateIso)}
                  </p>
                ) : null}
                {/* NR-15 (idea 2): tombol expandable "Apa yang terjadi di tahap ini?" */}
                {noteText ? (
                  <div className="mt-1.5">
                    <button
                      type="button"
                      onClick={() => setOpenNoteKey(noteOpen ? null : step.key)}
                      aria-expanded={noteOpen}
                      className="group inline-flex min-h-11 items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:min-h-0"
                    >
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform ${
                          noteOpen ? "rotate-180" : ""
                        }`}
                        aria-hidden="true"
                      />
                      {p.stageNoteHint}
                    </button>
                    {noteOpen ? (
                      <p className="mt-1.5 max-w-md rounded-lg border bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
                        {noteText}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
