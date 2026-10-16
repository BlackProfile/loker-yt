"use client";

// Hero status lamaran (dipindah verbatim dari status-page.tsx pada NR-18-a):
// chip status berwarna + judul posisi + waktu + salin kode/tautan + confetti
// perayaan. NR62: aksi "Tarik Lamaran" (AlertDialog) dipindah ke baris tautan
// footer di status-page.tsx — hero kini murni identitas status.

import { Copy, Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
}: {
  detail: TrackResponse;
  selectedCode: string | null;
  heroChip: StatusChipInfo;
  celebrate: boolean;
  p: Dict["status"]["page"];
  t: Dict;
  onCopyCode: () => void;
  onCopyStatusLink: () => void;
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
    </Card>
  );
}
