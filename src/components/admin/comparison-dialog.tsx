"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link2, Loader2, Sparkles, ThumbsUp, TriangleAlert, Trophy } from "lucide-react";
import type { Application } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  formatDateTime,
  initialsOf,
  normalizeUrl,
} from "./format";
import { StatusBadge, aiScoreStyle } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { useAdminSession } from "./admin-context";
import { apiPost } from "./api";

// Rekomendasi AI head-to-head dari POST /api/admin/applications/compare-ai.
type CompareAiResult = {
  winner: string;
  confidence: "TINGGI" | "SEDANG" | "RENDAH";
  alasan: string;
  kekuatan_per_kandidat: Record<string, string>;
  risiko_per_kandidat: Record<string, string>;
};

const CONFIDENCE_BADGE: Record<CompareAiResult["confidence"], string> = {
  TINGGI:
    "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  SEDANG:
    "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  RENDAH:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
};

const CONFIDENCE_LABEL: Record<CompareAiResult["confidence"], string> = {
  TINGGI: "Keyakinan: Tinggi",
  SEDANG: "Keyakinan: Sedang",
  RENDAH: "Keyakinan: Rendah",
};

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

// Dialog perbandingan samping-untuk-samping maksimal 3 kandidat + rekomendasi AI head-to-head.
export function ComparisonDialog({
  apps,
  onOpenChange,
}: {
  apps: Application[];
  onOpenChange: (open: boolean) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<CompareAiResult | null>(null);

  // Reset hasil rekomendasi saat daftar kandidat yang dibandingkan berganti.
  useEffect(() => {
    setAiResult(null);
    setAiLoading(false);
  }, [apps]);

  const open = apps.length > 0;
  const winnerApp = aiResult ? apps.find((app) => app.id === aiResult.winner) : null;

  async function requestRecommendation() {
    if (aiLoading || apps.length < 2) return;
    setAiLoading(true);
    try {
      const res = await apiPost<CompareAiResult>("/api/admin/applications/compare-ai", {
        ids: apps.map((app) => app.id),
      });
      setAiResult(res);
    } catch (err) {
      reportError(err);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Bandingkan Kandidat</DialogTitle>
          <DialogDescription>
            Perbandingan {apps.length} kandidat berdampingan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {canMutate
              ? "Minta AI memilih finalis terbaik berdasarkan data kedua belah pihak."
              : "Rekomendasi AI hanya tersedia untuk OWNER dan HR."}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={() => void requestRecommendation()}
            disabled={aiLoading || !canMutate || apps.length < 2}
          >
            {aiLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            Minta Rekomendasi AI
          </Button>
        </div>

        <div className="-mr-2 max-h-[75vh] overflow-y-auto pr-2 nice-scrollbar">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {apps.map((app) => {
              const isWinner = winnerApp?.id === app.id;
              return (
              <div
                key={app.id}
                className={cn(
                  "flex flex-col gap-3 rounded-xl border p-4",
                  isWinner &&
                    "border-emerald-300 bg-emerald-50/50 ring-2 ring-emerald-500/60 dark:border-emerald-800 dark:bg-emerald-950/30"
                )}
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
                  {isWinner ? (
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
                      <Trophy className="size-3" aria-hidden="true" />
                      Pilihan AI
                    </span>
                  ) : null}
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
              );
            })}
          </div>

          {aiResult ? (
            <div className="mt-4 rounded-xl border bg-emerald-50/40 p-4 dark:bg-emerald-950/20">
              <div className="flex flex-wrap items-center gap-2">
                <Sparkles className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <p className="text-sm font-semibold">Rekomendasi AI</p>
                <Badge variant="outline" className={CONFIDENCE_BADGE[aiResult.confidence]}>
                  {CONFIDENCE_LABEL[aiResult.confidence]}
                </Badge>
                {winnerApp ? (
                  <Badge
                    variant="outline"
                    className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                  >
                    <Trophy className="size-3" aria-hidden="true" />
                    {winnerApp.name}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground">
                {aiResult.alasan}
              </p>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
                {apps.map((app) => (
                  <div key={app.id} className="rounded-lg border bg-background p-3">
                    <p className="truncate text-xs font-bold">{app.name}</p>
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <ThumbsUp
                        className="mt-0.5 size-3 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">Kekuatan: </span>
                        {aiResult.kekuatan_per_kandidat[app.id] ?? "-"}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <TriangleAlert
                        className="mt-0.5 size-3 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden="true"
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">Risiko: </span>
                        {aiResult.risiko_per_kandidat[app.id] ?? "-"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-3 text-[11px] text-muted-foreground">
                AI hanya bahan pertimbangan, keputusan tetap milikmu.
              </p>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
