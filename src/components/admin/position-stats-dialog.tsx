"use client";

// Dialog statistik per posisi: views, lamaran, konversi, rata-rata skor AI,
// funnel tahap (bar horizontal warna per tahap), dan sumber pelamar.
// Data dibaca dari baris GET /api/admin/position-stats (tanpa fetch ulang).

import {
  BarChart3,
  Eye,
  FileText,
  Inbox,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { Position, PositionStatsRow } from "@/lib/types";
import { stageDotClass, stageLabel } from "@/lib/stages";
import { CountUp } from "./motion-primitives";

function StatCell({
  label,
  children,
  icon: Icon,
}: {
  label: string;
  children: React.ReactNode;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
}) {
  return (
    <div className="rounded-xl border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-xl font-bold tabular-nums">{children}</p>
    </div>
  );
}

export function PositionStatsDialog({
  open,
  onOpenChange,
  position,
  stats,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
  stats: PositionStatsRow | null;
}) {
  const maxFunnel = stats
    ? stats.funnel.reduce((max, f) => Math.max(max, f.count), 0)
    : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Statistik Posisi
          </DialogTitle>
          <DialogDescription>
            {position ? position.title : "-"}
            {position ? ` — ${position.department}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 max-h-[70vh] overflow-y-auto pr-2 nice-scrollbar">
          {!stats ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Statistik belum tersedia.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Angka utama */}
              <div className="grid grid-cols-2 gap-3">
                <StatCell label="Dilihat" icon={Eye}>
                  <CountUp value={stats.views} />
                </StatCell>
                <StatCell label="Lamaran" icon={FileText}>
                  <CountUp value={stats.applications} />
                </StatCell>
                <StatCell label="Konversi" icon={TrendingUp}>
                  {stats.conversion == null ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <>
                      <CountUp value={stats.conversion} />
                      <span className="text-sm font-medium text-muted-foreground">%</span>
                    </>
                  )}
                </StatCell>
                <StatCell label="Rata-rata Skor AI" icon={Sparkles}>
                  {stats.avgAiScore == null ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    stats.avgAiScore.toFixed(1)
                  )}
                </StatCell>
              </div>

              {/* Funnel tahap */}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">Funnel Tahap</p>
                {stats.funnel.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Belum ada tahap.</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {stats.funnel.map((f) => {
                      const pct =
                        maxFunnel > 0 ? Math.max(f.count > 0 ? 8 : 0, Math.round((f.count / maxFunnel) * 100)) : 0;
                      return (
                        <li key={f.stage} className="flex flex-col gap-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span
                                className={`size-2 shrink-0 rounded-full ${stageDotClass(f.stage)}`}
                                aria-hidden="true"
                              />
                              <span className="truncate font-medium">{stageLabel(f.stage)}</span>
                            </span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {f.count}
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            <div
                              className={`h-full rounded-full transition-[width] duration-500 ${stageDotClass(f.stage)}`}
                              style={{ width: `${pct}%` }}
                              role="img"
                              aria-label={`${stageLabel(f.stage)}: ${f.count} lamaran`}
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Sumber pelamar */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Sumber Pelamar</p>
                  {stats.topSource ? (
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                    >
                      Terbanyak: {stats.topSource.source} ({stats.topSource.count})
                    </Badge>
                  ) : null}
                </div>
                {stats.sources.length === 0 ? (
                  <p className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    <Inbox className="size-4" aria-hidden="true" />
                    {stats.applications === 0
                      ? "Belum ada lamaran untuk posisi ini."
                      : "Belum ada data sumber pelamar."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {stats.sources.slice(0, 5).map((s) => (
                      <li
                        key={s.source}
                        className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate">{s.source}</span>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          {s.count}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
