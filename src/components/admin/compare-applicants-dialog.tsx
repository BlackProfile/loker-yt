"use client";

// NR38-B fitur 6 — Dialog bandingkan pelamar dari SELEKSI MASSAL (checkbox bulk).
// Berbeda dari ComparisonDialog (alur checkbox "Bandingkan" per baris + AI):
// dialog ini banding side-by-side 2-3 kandidat dari seleksi massal, murni dari
// data baris yang sudah ada di state (tanpa fetch ulang, tanpa panggilan AI).

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Share2, Star } from "lucide-react";
import { formatDate, formatRupiah } from "./format";
import { StatusBadge, AiScoreBadge, DomisiliChip } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { ApplicantAvatar } from "./applicant-avatar";
import { salaryVerdict } from "./stage-meta";
import { ageOf, type ApplicationRow } from "./applicant-row-types";
import { cn } from "@/lib/utils";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

/** Dialog bandingkan 2-3 pelamar terpilih (seleksi massal) — kolom per kandidat. */
export function CompareApplicantsDialog({
  apps,
  open,
  onOpenChange,
  currentUserId,
}: {
  apps: ApplicationRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Id admin aktif untuk cek bintang personal (starredBy). */
  currentUserId: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Bandingkan {apps.length} Pelamar</DialogTitle>
          <DialogDescription>
            Perbandingan cepat dari seleksi massal — semua data diambil dari daftar yang sedang tampil.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 grid max-h-[72vh] grid-cols-1 gap-3 overflow-y-auto pr-2 nice-scrollbar sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((app) => {
            const isStarred = app.starredBy?.includes(currentUserId) ?? false;
            const verdict = salaryVerdict(
              app.salaryExpectation,
              app.positionSalaryMin ?? null,
              app.positionSalaryMax ?? null
            );
            const age = ageOf(app.birthDate);
            return (
              <div
                key={app.id}
                className="flex flex-col gap-3 rounded-xl border bg-background p-4"
              >
                {/* Avatar + nama + bintang favorit */}
                <div className="flex items-center gap-3">
                  <ApplicantAvatar name={app.name} starred={isStarred} className="size-10" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" title={app.name}>
                      {app.name}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {app.positionTitle ?? "-"}
                    </p>
                  </div>
                  <Star
                    className={cn(
                      "size-4 shrink-0",
                      isStarred ? "fill-amber-400 text-amber-500" : "text-muted-foreground/40"
                    )}
                    aria-hidden="true"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={app.status} dot stageAgeIso={app.stageUpdatedAt || app.createdAt} />
                  <AiScoreBadge score={app.aiScore} />
                </div>

                <div className="flex items-center gap-2">
                  <RatingStars value={app.rating} size="size-3.5" disabled />
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {app.rating}/5
                  </span>
                </div>

                {/* Chip gaji vs rentang posisi */}
                <div>
                  <span
                    className={cn(
                      "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                      verdict.chipClass
                    )}
                    title={
                      app.salaryExpectation != null
                        ? `Ekspektasi: ${formatRupiah(app.salaryExpectation)}`
                        : "Ekspektasi gaji tidak diisi"
                    }
                  >
                    {verdict.label}
                  </span>
                </div>

                <Section label="Domisili">
                  {app.domisili?.trim() || app.komuterPlan ? (
                    <DomisiliChip domisili={app.domisili} komuterPlan={app.komuterPlan} />
                  ) : (
                    <p className="text-sm text-muted-foreground">-</p>
                  )}
                </Section>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <Section label="Umur">
                    <p>{age ?? "-"}</p>
                  </Section>
                  <Section label="Sumber">
                    <p className="flex min-w-0 items-center gap-1">
                      <Share2 className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="truncate" title={app.source ?? undefined}>
                        {app.source ?? "-"}
                      </span>
                    </p>
                  </Section>
                </div>

                <Section label="Tanggal Daftar">
                  <p className="text-sm">{formatDate(app.createdAt)}</p>
                </Section>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
