"use client";

// Spanduk status final (dipindah verbatim dari status-page.tsx pada NR-18-a):
// Diterima & Ditolak/Ditarik. Selalu tampak (tidak dilipat).

import { BadgeCheck, BadgeX, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Dict } from "@/components/landing/strings";
import type { TrackResponse } from "@/lib/types";

export function AcceptedNotice({ t }: { t: Dict }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
    >
      <BadgeCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
      {t.status.accepted}
    </div>
  );
}

export function RejectedNotice({
  detail,
  p,
  t,
  onBrowseJobs,
}: {
  detail: TrackResponse;
  p: Dict["status"]["page"];
  t: Dict;
  onBrowseJobs: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm dark:border-rose-500/30 dark:bg-rose-500/10"
    >
      <p className="flex items-center gap-3 font-semibold text-rose-700 dark:text-rose-300">
        <BadgeX className="h-5 w-5 shrink-0" aria-hidden="true" />
        {detail.rejectionReason === "MENARIK_DIRI"
          ? p.statusWithdrawn
          : t.status.rejected}
      </p>
      {detail.rejection?.reasonLabel &&
      detail.rejectionReason !== "MENARIK_DIRI" ? (
        <p className="pl-8 text-rose-700/90 dark:text-rose-300/90">
          {t.status.rejectedDetail.reasonLabel}: {detail.rejection.reasonLabel}
        </p>
      ) : null}
      {detail.rejection?.note && detail.rejectionReason !== "MENARIK_DIRI" ? (
        <div className="ml-8 rounded-lg border border-rose-200/80 bg-background/60 px-3 py-2 dark:border-rose-500/20">
          <p className="font-medium text-rose-700 dark:text-rose-300">
            {t.status.rejectedDetail.feedback}:
          </p>
          <p className="mt-1 whitespace-pre-line leading-relaxed text-rose-700/90 dark:text-rose-300/90">
            {detail.rejection.note}
          </p>
        </div>
      ) : null}
      <div className="pl-8">
        <Button
          variant="outline"
          size="sm"
          className="h-11 border-rose-300 bg-transparent text-rose-700 hover:bg-rose-100 hover:text-rose-800 sm:h-9 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
          onClick={onBrowseJobs}
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {t.status.rejectedDetail.otherPositions}
        </Button>
      </div>
    </div>
  );
}
