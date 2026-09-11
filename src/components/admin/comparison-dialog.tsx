"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Link2 } from "lucide-react";
import type { Application } from "@/lib/types";
import {
  formatDateTime,
  initialsOf,
  normalizeUrl,
} from "./format";
import { StatusBadge, aiScoreStyle } from "./status-badge";
import { RatingStars } from "./rating-stars";

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

// Dialog perbandingan samping-untuk-samping maksimal 3 kandidat.
export function ComparisonDialog({
  apps,
  onOpenChange,
}: {
  apps: Application[];
  onOpenChange: (open: boolean) => void;
}) {
  const open = apps.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bandingkan Kandidat</DialogTitle>
          <DialogDescription>
            Perbandingan {apps.length} kandidat berdampingan.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 max-h-[75vh] overflow-y-auto pr-2 nice-scrollbar">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {apps.map((app) => (
              <div
                key={app.id}
                className="flex flex-col gap-3 rounded-xl border p-4"
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                    {initialsOf(app.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{app.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {app.positionTitle ?? "-"}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={app.status} />
                  {app.talentPool ? (
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                    >
                      Talent Pool
                    </Badge>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-lg border px-2.5 py-1 text-2xl font-bold tabular-nums ${aiScoreStyle(app.aiScore)}`}
                  >
                    {app.aiScore ?? "-"}
                  </span>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Skor AI</p>
                    <RatingStars value={app.rating} size="size-3" disabled />
                  </div>
                </div>

                <Section label="Jadwal Wawancara">
                  <p className="text-sm">
                    {app.interviewAt ? formatDateTime(app.interviewAt) : "Belum dijadwalkan"}
                  </p>
                </Section>

                <Section label="Tags">
                  {app.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {app.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">-</p>
                  )}
                </Section>

                <Section label="Pengalaman">
                  <p className="line-clamp-6 text-sm whitespace-pre-line text-muted-foreground">
                    {app.experience || "-"}
                  </p>
                </Section>

                <Section label="Alasan Bergabung">
                  <p className="line-clamp-6 text-sm whitespace-pre-line text-muted-foreground">
                    {app.motivation || "-"}
                  </p>
                </Section>

                <Section label="Tautan">
                  <div className="flex flex-col gap-1">
                    {app.portfolioUrl ? (
                      <a
                        href={normalizeUrl(app.portfolioUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-rose-600 underline-offset-2 hover:underline"
                      >
                        <Link2 className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">Portofolio</span>
                      </a>
                    ) : null}
                    {app.socialLinks ? (
                      <a
                        href={normalizeUrl(app.socialLinks)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-rose-600 underline-offset-2 hover:underline"
                      >
                        <Link2 className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">Sosial Media</span>
                      </a>
                    ) : null}
                    {!app.portfolioUrl && !app.socialLinks ? (
                      <p className="text-sm text-muted-foreground">-</p>
                    ) : null}
                  </div>
                </Section>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
