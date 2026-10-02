"use client";

// Overlay cetak Surat Offer (NR-15 idea 12 — dipindah verbatim dari
// status-page.tsx pada NR-18-a). Sengaja dirender di luar wrapper utama yang
// print:hidden, sehingga saat mencetak hanya surat yang tampil di kertas.

import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fillTemplate, formatDateId } from "@/components/landing/landing-utils";
import type { Dict, Lang } from "@/components/landing/strings";
import type { TrackOfferInfo } from "@/lib/types";
import { formatLongDate } from "./status-types";

export function OfferLetterOverlay({
  offer,
  positionTitle,
  sessionEmail,
  lang,
  p,
  t,
  onClose,
}: {
  offer: TrackOfferInfo;
  positionTitle: string | null | undefined;
  sessionEmail: string | null;
  lang: Lang;
  p: Dict["status"]["page"];
  t: Dict;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={p.letterTitle}
      className="fixed inset-0 z-[60] overflow-y-auto bg-zinc-950/60 p-4 backdrop-blur-sm print:static print:overflow-visible print:bg-transparent print:p-0 print:backdrop-blur-none"
    >
      <div className="mx-auto my-6 w-full max-w-2xl print:my-0">
        <div className="rounded-2xl border bg-white p-6 text-zinc-900 shadow-xl sm:p-8 print:rounded-none print:border-0 print:shadow-none">
          <p className="text-center text-2xl font-bold tracking-tight">Lumina Studio</p>
          <hr className="my-5 border-zinc-300" />
          <p className="text-sm">
            {fillTemplate(p.letterTo, { email: sessionEmail ?? "-" })}
          </p>
          <h2 className="mt-4 text-lg font-bold">{p.letterTitle}</h2>
          <div className="mt-3 grid gap-1.5 text-sm">
            {positionTitle ? (
              <p>
                <span className="text-muted-foreground">{t.status.positionLabel}: </span>
                <span className="font-medium">{positionTitle}</span>
              </p>
            ) : null}
            {offer.salary ? (
              <p>
                <span className="text-muted-foreground">{t.status.offer.salary}: </span>
                <span className="font-medium">{offer.salary}</span>
              </p>
            ) : null}
            {offer.type ? (
              <p>
                <span className="text-muted-foreground">{t.status.offer.type}: </span>
                <span className="font-medium">{offer.type}</span>
              </p>
            ) : null}
            {offer.startDate ? (
              <p>
                <span className="text-muted-foreground">{t.status.offer.start}: </span>
                <span className="font-medium">{formatLongDate(offer.startDate, lang)}</span>
              </p>
            ) : null}
            {offer.deadline ? (
              <p>
                <span className="text-muted-foreground">{t.status.offer.deadlineLabel}: </span>
                <span className="font-medium">{formatDateId(offer.deadline)}</span>
              </p>
            ) : null}
          </div>
          {offer.message ? (
            <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-700">
              {offer.message}
            </p>
          ) : null}
          <p className="mt-6 text-xs text-zinc-500">
            {fillTemplate(p.letterPrintedOn, {
              date: formatLongDate(new Date().toISOString(), lang),
            })}
          </p>
          <div className="mt-10 max-w-60">
            <div className="h-14 border-b border-zinc-400" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium">{p.letterSignName}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2 print:hidden">
          <Button className="h-11 gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {p.letterPrint}
          </Button>
          <Button variant="outline" className="h-11 gap-2" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
            {p.letterClose}
          </Button>
        </div>
      </div>
    </div>
  );
}
