"use client";

// Kartu Tanggal Mulai kerja (NR-15 idea 13 — dipindah verbatim dari
// status-page.tsx pada NR-18-a): konfirmasi tanggal / usul tanggal lain.
// Selalu tampak (tidak dilipat) — hanya render bila status diterima.

import type { Dispatch, SetStateAction } from "react";
import { CalendarCheck, CalendarClock, CheckCircle2, Clock, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fillTemplate } from "@/components/landing/landing-utils";
import type { Dict, Lang } from "@/components/landing/strings";
import type { TrackResponse } from "@/lib/types";
import { formatLongDate } from "./status-types";

type CandidateStart = NonNullable<TrackResponse["candidateStart"]>;

export function StartDateCard({
  candidateStart,
  startBusy,
  startProposeOpen,
  setStartProposeOpen,
  startDateValue,
  setStartDateValue,
  startNoteValue,
  setStartNoteValue,
  onSubmitStartDate,
  lang,
  p,
  t,
}: {
  candidateStart: CandidateStart;
  startBusy: "confirm" | "propose" | null;
  startProposeOpen: boolean;
  setStartProposeOpen: Dispatch<SetStateAction<boolean>>;
  startDateValue: string;
  setStartDateValue: (value: string) => void;
  startNoteValue: string;
  setStartNoteValue: (value: string) => void;
  onSubmitStartDate: (action: "confirm" | "propose") => Promise<void>;
  lang: Lang;
  p: Dict["status"]["page"];
  t: Dict;
}) {
  return (
    <Card className="rounded-2xl p-5 md:p-6">
      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <CalendarCheck className="h-4 w-4" aria-hidden="true" />
        {p.startDateTitle}
      </p>
      {candidateStart.startDate ? (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">{p.startDateLabel}: </span>
          <span className="font-medium">
            {formatLongDate(candidateStart.startDate, lang)}
          </span>
        </p>
      ) : null}
      {candidateStart.confirmedAt ? (
        <p className="mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {fillTemplate(p.startDateConfirmed, {
              date: formatLongDate(candidateStart.startDate ?? candidateStart.confirmedAt, lang),
            })}
          </span>
        </p>
      ) : candidateStart.proposedAt ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            {fillTemplate(p.startDateProposed, {
              date: formatLongDate(candidateStart.proposedAt, lang),
            })}
          </span>
          {candidateStart.note ? (
            <p className="whitespace-pre-line text-xs text-muted-foreground">
              {candidateStart.note}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:h-9"
              disabled={startBusy !== null}
              onClick={() => void onSubmitStartDate("confirm")}
            >
              {startBusy === "confirm" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <CalendarCheck className="h-4 w-4" aria-hidden="true" />
              )}
              {p.startDateConfirmBtn}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              disabled={startBusy !== null}
              onClick={() => setStartProposeOpen((prev) => !prev)}
              aria-expanded={startProposeOpen}
            >
              <CalendarClock className="h-4 w-4" aria-hidden="true" />
              {p.startDateProposeToggle}
            </Button>
          </div>
          {startProposeOpen ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <Label
                htmlFor="start-propose-date"
                className="text-xs font-medium text-amber-800 dark:text-amber-300"
              >
                {p.startDateProposeDateLabel}
              </Label>
              <Input
                id="start-propose-date"
                type="date"
                value={startDateValue}
                onChange={(e) => setStartDateValue(e.target.value)}
                className="mt-1 h-11 bg-background sm:h-9"
              />
              <Label
                htmlFor="start-propose-note"
                className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300"
              >
                {p.startDateProposeNoteLabel}
              </Label>
              <Textarea
                id="start-propose-note"
                rows={2}
                value={startNoteValue}
                onChange={(e) => setStartNoteValue(e.target.value)}
                placeholder={p.startDateProposeNotePh}
                maxLength={300}
                className="mt-1 bg-background text-sm"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-11 sm:h-9"
                  disabled={startBusy !== null || !startDateValue}
                  onClick={() => void onSubmitStartDate("propose")}
                >
                  {startBusy === "propose" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Send className="h-4 w-4" aria-hidden="true" />
                  )}
                  {p.startDateProposeSend}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-9"
                  disabled={startBusy !== null}
                  onClick={() => setStartProposeOpen(false)}
                >
                  {t.status.formCancel}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
