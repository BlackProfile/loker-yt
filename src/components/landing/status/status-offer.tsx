"use client";

// Kartu penawaran / offer (dipindah verbatim dari status-page.tsx pada NR-18-a):
// aksi Terima (dialog konfirmasi) / Tolak (form alasan) + tombol Unduh Surat
// Offer. Selalu tampak (tidak dilipat) — disembunyikan bila tahap final Ditolak.

import type { Dispatch, SetStateAction } from "react";
import { BadgeCheck, BadgeX, Clock, Download, Loader2, Sparkles } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fillTemplate, formatDateId, formatDateTimeId } from "@/components/landing/landing-utils";
import type { Dict } from "@/components/landing/strings";
import type { TrackOfferInfo } from "@/lib/types";
import { DetailRow } from "./status-shared";

export function OfferCard({
  offer,
  offerDaysLeft,
  t,
  offerBusy,
  declineOpen,
  setDeclineOpen,
  declineReason,
  setDeclineReason,
  onAccept,
  onDecline,
  onOpenLetter,
}: {
  offer: TrackOfferInfo;
  offerDaysLeft: number | null;
  t: Dict;
  offerBusy: "ACCEPT" | "DECLINE" | null;
  declineOpen: boolean;
  setDeclineOpen: Dispatch<SetStateAction<boolean>>;
  declineReason: string;
  setDeclineReason: (value: string) => void;
  onAccept: () => Promise<void>;
  onDecline: () => Promise<void>;
  onOpenLetter: () => void;
}) {
  return (
    <div>
      {offer.status === "PENDING" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t.status.offer.title}
          </p>
          {offer.message ? (
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-emerald-900/90 dark:text-emerald-200/90">
              {offer.message}
            </p>
          ) : null}
          <div className="mt-3 grid gap-1.5">
            {offer.salary ? (
              <DetailRow label={t.status.offer.salary} value={offer.salary} />
            ) : null}
            {offer.type ? (
              <DetailRow label={t.status.offer.type} value={offer.type} />
            ) : null}
            {offer.startDate ? (
              <DetailRow
                label={t.status.offer.start}
                value={formatDateTimeId(offer.startDate)}
              />
            ) : null}
            {offer.deadline && offerDaysLeft !== null ? (
              <p className="text-sm">
                <span className="text-muted-foreground">
                  {t.status.offer.deadlineLabel}:{" "}
                </span>
                <span className="font-medium">{formatDateId(offer.deadline)}</span>{" "}
                <span className="text-emerald-700 dark:text-emerald-400">
                  ({fillTemplate(t.status.offer.daysLeft, { n: offerDaysLeft })})
                </span>
              </p>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:h-9"
                  disabled={offerBusy !== null}
                >
                  {offerBusy === "ACCEPT" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t.status.offer.accept}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t.status.offer.acceptTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t.status.offer.acceptDesc}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={offerBusy === "ACCEPT"}>
                    {t.status.formCancel}
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={offerBusy === "ACCEPT"}
                    onClick={() => void onAccept()}
                  >
                    {offerBusy === "ACCEPT" ? (
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.status.offer.acceptYes}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              disabled={offerBusy !== null}
              onClick={() => setDeclineOpen((prev) => !prev)}
              aria-expanded={declineOpen}
            >
              {t.status.offer.decline}
            </Button>
          </div>
          {declineOpen ? (
            <div className="mt-3 rounded-lg border border-emerald-200/80 bg-background/70 p-3 dark:border-emerald-500/20">
              <Label
                htmlFor="offer-decline-reason"
                className="text-xs font-medium"
              >
                {t.status.offer.declineReasonLabel}
              </Label>
              <Textarea
                id="offer-decline-reason"
                rows={2}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder={t.status.offer.declineReasonPh}
                maxLength={500}
                className="mt-1 text-sm"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-11 sm:h-9"
                  disabled={offerBusy !== null}
                  onClick={() => void onDecline()}
                >
                  {offerBusy === "DECLINE" ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <BadgeX className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t.status.offer.declineSend}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-11 sm:h-9"
                  disabled={offerBusy !== null}
                  onClick={() => setDeclineOpen(false)}
                >
                  {t.status.formCancel}
                </Button>
              </div>
            </div>
          ) : null}

          {/* NR-15 (idea 12): unduh / cetak surat offer */}
          <div className="mt-3 border-t border-emerald-200/70 pt-3 dark:border-emerald-500/20">
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={onOpenLetter}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t.status.page.letterDownload}
            </Button>
          </div>
        </div>
      ) : offer.status === "ACCEPTED" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <p className="flex items-center gap-3 font-semibold text-emerald-800 dark:text-emerald-300">
            <BadgeCheck
              className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
              aria-hidden="true"
            />
            {t.status.offer.acceptedTitle}
          </p>
          {offer.respondedAt ? (
            <p className="mt-1 pl-8 text-emerald-700/90 dark:text-emerald-300/80">
              {fillTemplate(t.status.offer.respondedLabel, {
                time: formatDateTimeId(offer.respondedAt),
              })}
            </p>
          ) : null}
          <div className="mt-3 pl-8">
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={onOpenLetter}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t.status.page.letterDownload}
            </Button>
          </div>
        </div>
      ) : offer.status === "DECLINED" ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-500/30 dark:bg-zinc-500/10">
          <p className="flex items-center gap-3 font-semibold text-zinc-700 dark:text-zinc-300">
            <BadgeX className="h-5 w-5 shrink-0" aria-hidden="true" />
            {t.status.offer.declinedTitle}
          </p>
          {offer.declineReason ? (
            <p className="mt-1 pl-8 text-zinc-600 dark:text-zinc-400">
              {offer.declineReason}
            </p>
          ) : null}
        </div>
      ) : offer.status === "EXPIRED" ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
        >
          <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />
          {t.status.offer.expiredTitle}
        </div>
      ) : null}
    </div>
  );
}
