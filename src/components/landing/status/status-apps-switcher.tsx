"use client";

// Daftar multi-lamaran / switcher lamaran (dipindah verbatim dari status-page.tsx
// pada NR-18-a). Selalu tampak bila pelamar punya lebih dari satu lamaran.

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { fillTemplate, formatDateId } from "@/components/landing/landing-utils";
import { loadSeenAt } from "@/lib/status-session";
import type { Dict } from "@/components/landing/strings";
import type { TrackSummary } from "@/lib/types";

export type StatusChipInfo = { label: string; cls: string };

export function AppsSwitcher({
  apps,
  selectedCode,
  p,
  chipFor,
  onSelectApp,
}: {
  apps: TrackSummary[];
  selectedCode: string | null;
  p: Dict["status"]["page"];
  chipFor: (
    status: string | undefined,
    rejectionReason: string | null | undefined,
  ) => StatusChipInfo;
  onSelectApp: (code: string) => void;
}) {
  return (
    <Card className="rounded-2xl p-4 text-left md:p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {fillTemplate(p.myApps, { n: String(apps.length) })}
      </p>
      <div className="mt-3 grid gap-2">
        {apps.map((app) => {
          const selected = app.trackingCode === selectedCode;
          const hasUpdate =
            !selected &&
            new Date(app.statusUpdatedAt).getTime() > loadSeenAt(app.trackingCode);
          const chip = chipFor(app.status, null);
          return (
            <button
              key={app.trackingCode}
              type="button"
              onClick={() => onSelectApp(app.trackingCode)}
              aria-label={fillTemplate(p.selectAppAria, {
                title: app.positionTitle ?? app.trackingCode,
              })}
              aria-current={selected ? "true" : undefined}
              className={`min-h-11 rounded-xl border p-3.5 text-left transition-colors ${
                selected
                  ? "border-rose-600/50 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/10"
                  : "border-border bg-background hover:border-rose-600/30 hover:bg-muted/50"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {app.positionTitle ?? "—"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDateId(app.submittedAt)} ·{" "}
                    <span className="font-mono">{app.trackingCode}</span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {hasUpdate ? (
                    <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" variant="outline">
                      {p.updatedBadge}
                    </Badge>
                  ) : null}
                  <Badge variant="outline" className={chip.cls}>
                    {chip.label}
                  </Badge>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
