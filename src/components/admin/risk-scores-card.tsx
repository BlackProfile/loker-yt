"use client";

// NR49 Paket C — Kartu "Risiko Tidak Hadir & Offer" di Dashboard.
// Daftar kandidat berisiko (wawancara berpotensi tidak hadir / offer tak
// dijawab) dengan skor heuristik deterministik dari server. Tombol "Tanya AI"
// meminta penjelasan naratif + saran tindakan (ditampilkan inline di bawah item).
// Polling 5 menit (detik dilewati saat tab tersembunyi; interval dibersihkan).

import { useCallback, useEffect, useRef, useState } from "react";
import { BadgeCheck, Loader2, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CollapsibleCard, type CardStatus } from "./collapsible-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "./api";
import { useAdminSession } from "./admin-context";
import { formatRelative } from "./format";
import { cn } from "@/lib/utils";

type RiskItem = {
  kind: "interview" | "offer";
  id: string;
  name: string;
  positionTitle: string | null;
  when: string | null;
  score: number;
  reasons: string[];
};

type RiskExplain = { reason: string; suggestion: string };

function scoreBadgeClass(score: number): string {
  if (score >= 70) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-400";
  }
  if (score >= 40) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

function scoreLabel(score: number): string {
  if (score >= 70) return `Tinggi · ${score}`;
  if (score >= 40) return `Sedang · ${score}`;
  return `Rendah · ${score}`;
}

export function RiskScoresCard() {
  const { reportError } = useAdminSession();

  const [items, setItems] = useState<RiskItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [explain, setExplain] = useState<Record<string, RiskExplain>>({});
  const [explainBusyId, setExplainBusyId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ items: RiskItem[] }>("/api/admin/risk-scores");
      if (!mountedRef.current) return;
      setItems(res.items);
      setLoadFailed(false);
    } catch {
      if (!mountedRef.current) return;
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void load();
    }, 5 * 60 * 1000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [load]);

  async function askAi(item: RiskItem) {
    if (explainBusyId) return;
    setExplainBusyId(item.id);
    try {
      const res = await apiPost<RiskExplain>("/api/admin/risk-explain", {
        kind: item.kind,
        id: item.id,
      });
      setExplain((prev) => ({ ...prev, [item.id]: res }));
    } catch (err) {
      reportError(err);
    } finally {
      setExplainBusyId(null);
    }
  }

  const count = items?.length ?? 0;
  const hasHigh = (items ?? []).some((item) => item.score >= 70);
  const status: CardStatus =
    items == null
      ? { label: "Memuat...", tone: "neutral" }
      : count === 0
        ? { label: "Tidak ada", tone: "ok" }
        : { label: `${count} kandidat berisiko`, tone: hasHigh ? "danger" : "warn" };

  return (
    <CollapsibleCard
      id="risk-scores"
      icon={ShieldAlert}
      title="Risiko Tidak Hadir & Offer"
      description="Kandidat wawancara 7 hari ke depan dan offer menunggu jawaban yang perlu diperhatikan."
      status={status}
    >
      {items == null ? (
        loadFailed ? (
          <div className="flex flex-col items-start gap-2">
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Belum dapat memuat skor risiko.
            </p>
            <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
              Coba Lagi
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2" aria-live="polite">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-3/4 rounded-xl" />
          </div>
        )
      ) : count === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          Tidak ada kandidat berisiko saat ini.
        </p>
      ) : (
        <ul className="nice-scrollbar flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
          {items.map((item) => {
            const itemExplain = explain[item.id];
            return (
              <li key={`${item.kind}-${item.id}`} className="flex flex-col gap-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.positionTitle ?? "Posisi telah dihapus"}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0",
                      item.kind === "interview"
                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
                    )}
                  >
                    {item.kind === "interview" ? "Wawancara" : "Offer"}
                  </Badge>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatRelative(item.when)}
                  </span>
                  <Badge variant="outline" className={cn("shrink-0 tabular-nums", scoreBadgeClass(item.score))}>
                    {scoreLabel(item.score)}
                  </Badge>
                </div>

                {item.reasons.length > 0 ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.reasons.join(" · ")}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-fit text-xs"
                    onClick={() => void askAi(item)}
                    disabled={explainBusyId !== null}
                  >
                    {explainBusyId === item.id ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        Menjelaskan...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3.5" aria-hidden="true" />
                        Tanya AI
                      </>
                    )}
                  </Button>
                </div>

                {itemExplain ? (
                  <div className="rounded-lg border bg-zinc-50/60 p-2.5 dark:bg-zinc-900/40">
                    <p className="text-sm font-medium leading-relaxed">
                      <BadgeCheck className="mr-1 inline size-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                      {itemExplain.reason}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Saran: {itemExplain.suggestion}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleCard>
  );
}
