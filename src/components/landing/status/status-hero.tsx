"use client";

// Hero status lamaran (dipindah verbatim dari status-page.tsx pada NR-18-a):
// chip status berwarna + judul posisi + waktu + salin kode/tautan + tarik
// lamaran (AlertDialog) + confetti perayaan. Selalu tampak (tidak dilipat).

import type { Dispatch, SetStateAction } from "react";
import { Copy, Link2, Loader2, XCircle } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fillTemplate, formatDateTimeId } from "@/components/landing/landing-utils";
import type { Dict } from "@/components/landing/strings";
import type { TrackResponse } from "@/lib/types";
import { StatusConfetti } from "./status-confetti";
import type { StatusChipInfo } from "./status-apps-switcher";

export function StatusHero({
  detail,
  selectedCode,
  heroChip,
  celebrate,
  p,
  t,
  onCopyCode,
  onCopyStatusLink,
  canWithdraw,
  withdrawOpen,
  setWithdrawOpen,
  withdrawReason,
  setWithdrawReason,
  withdrawBusy,
  onWithdraw,
}: {
  detail: TrackResponse;
  selectedCode: string | null;
  heroChip: StatusChipInfo;
  celebrate: boolean;
  p: Dict["status"]["page"];
  t: Dict;
  onCopyCode: () => void;
  onCopyStatusLink: () => void;
  canWithdraw: boolean;
  withdrawOpen: boolean;
  setWithdrawOpen: Dispatch<SetStateAction<boolean>>;
  withdrawReason: string;
  setWithdrawReason: (value: string) => void;
  withdrawBusy: boolean;
  onWithdraw: () => void;
}) {
  return (
    <Card className="relative overflow-hidden rounded-2xl p-5 md:p-6">
      <StatusConfetti celebrate={celebrate} />
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {p.currentStatus}
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <Badge variant="outline" className={`px-3 py-1.5 text-sm font-semibold ${heroChip.cls}`}>
          {heroChip.label}
        </Badge>
        {detail.positionTitle ? (
          <p className="text-base font-bold tracking-tight">
            {detail.positionTitle}
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
        {detail.submittedAt ? (
          <p>
            <span className="text-muted-foreground">{t.status.submittedLabel}: </span>
            <span className="font-medium">{formatDateTimeId(detail.submittedAt)}</span>
          </p>
        ) : null}
        {detail.updatedAt ? (
          <p className="text-muted-foreground">
            {fillTemplate(p.lastUpdated, {
              time: formatDateTimeId(detail.updatedAt),
            })}
          </p>
        ) : null}
        {selectedCode ? (
          <div className="inline-flex items-center">
            <button
              type="button"
              onClick={onCopyCode}
              className="inline-flex h-8 items-center gap-1.5 rounded-l-md border px-2.5 font-mono text-xs font-medium hover:bg-muted"
              aria-label={p.copyCodeAria}
              title={p.copyCode}
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              {selectedCode}
            </button>
            <button
              type="button"
              onClick={onCopyStatusLink}
              className="inline-flex h-8 items-center rounded-r-md border border-l-0 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={p.copyLinkAria}
              title={p.copyLink}
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {/* Tarik lamaran (self-service, tahap belum final) */}
      {canWithdraw ? (
        <div className="mt-4 border-t pt-4">
          <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-11 border-rose-200 bg-transparent text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:h-9 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                disabled={withdrawBusy}
              >
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {p.withdraw}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{p.withdrawTitle}</AlertDialogTitle>
                <AlertDialogDescription>
                  {fillTemplate(p.withdrawDesc, {
                    position: detail.positionTitle ?? "—",
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-2">
                <Label htmlFor="withdraw-reason" className="text-sm font-medium">
                  {p.withdrawReasonLabel}
                </Label>
                <Textarea
                  id="withdraw-reason"
                  rows={2}
                  value={withdrawReason}
                  onChange={(e) => setWithdrawReason(e.target.value)}
                  placeholder={p.withdrawReasonPh}
                  maxLength={500}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={withdrawBusy}>
                  {t.status.formCancel}
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  disabled={withdrawBusy}
                  onClick={(event) => {
                    event.preventDefault();
                    onWithdraw();
                  }}
                >
                  {withdrawBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                  )}
                  {p.withdrawConfirm}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}
    </Card>
  );
}
