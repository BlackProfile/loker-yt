"use client";

// NR49 Paket C — Kartu "Analisis Alasan Penolakan" di Dashboard.
// Statistik penolakan 90 hari terakhir (top alasan dengan bar mini) + insight
// AI tersimpan (bisa dibuat ulang oleh OWNER/HR via tombol). Gagal gate AI
// (503) ditampilkan sebagai pesan amber — kartu tidak pernah crash.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, MessageSquareWarning, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CollapsibleCard, type CardStatus } from "./collapsible-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, ApiError } from "./api";
import { useAdminSession } from "./admin-context";

type RejectionStats = {
  total: number;
  perReason: { key: string; label: string; count: number }[];
  insight: { content: string; generatedAt: string } | null;
};

export function RejectionAnalysisCard() {
  const { role, reportError } = useAdminSession();
  const canManage = role === "OWNER" || role === "HR";

  const [stats, setStats] = useState<RejectionStats | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gateMessage, setGateMessage] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<RejectionStats>("/api/admin/rejection-analysis");
      if (!mountedRef.current) return;
      setStats(res);
      setLoadFailed(false);
    } catch {
      if (!mountedRef.current) return;
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  async function analyze() {
    if (busy) return;
    setBusy(true);
    setGateMessage(null);
    try {
      const res = await apiPost<{ insight: { content: string; generatedAt: string } }>(
        "/api/admin/rejection-analysis",
      );
      if (!mountedRef.current) return;
      setStats((prev) => (prev ? { ...prev, insight: res.insight } : prev));
      toast.success("Analisis penolakan selesai dibuat");
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setGateMessage(err.message);
      } else {
        reportError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  const total = stats?.total ?? 0;
  const topReasons = (stats?.perReason ?? []).slice(0, 5);
  const maxCount = topReasons[0]?.count ?? 0;

  return (
    <CollapsibleCard
      id="rejection-analysis"
      icon={MessageSquareWarning}
      title="Analisis Alasan Penolakan"
      description="Pola alasan penolakan 90 hari terakhir dan saran perbaikan proses dari AI."
      status={{ label: `${total} penolakan · 90 hari`, tone: "neutral" }}
    >
      {stats == null ? (
        loadFailed ? (
          <div className="flex flex-col items-start gap-2">
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Belum dapat memuat statistik penolakan.
            </p>
            <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
              Coba Lagi
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2" aria-live="polite">
            <Skeleton className="h-4 w-2/3 rounded-full" />
            <Skeleton className="h-4 w-1/2 rounded-full" />
            <Skeleton className="h-4 w-3/5 rounded-full" />
          </div>
        )
      ) : (
        <>
          {total === 0 ? (
            <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              Belum ada penolakan dalam 90 hari terakhir.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Alasan terbanyak
              </p>
              <ul className="flex flex-col gap-1.5">
                {topReasons.map((reason) => (
                  <li key={reason.key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-medium">{reason.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{reason.count}</span>
                    </div>
                    <div
                      className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                      role="presentation"
                    >
                      <div
                        className="h-full rounded-full bg-rose-500/80"
                        style={{ width: `${maxCount > 0 ? Math.max(6, Math.round((reason.count / maxCount) * 100)) : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {gateMessage ? (
            <div
              className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
              role="alert"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{gateMessage}</span>
            </div>
          ) : null}

          {stats.insight ? (
            <div className="nice-scrollbar max-h-72 overflow-y-auto rounded-xl border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Insight AI
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed">{stats.insight.content}</p>
            </div>
          ) : null}

          {canManage ? (
            <Button
              className="h-11 w-fit bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99] sm:h-9"
              onClick={() => void analyze()}
              disabled={busy || total === 0}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menganalisis...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden="true" />
                  Analisis dengan AI
                </>
              )}
            </Button>
          ) : null}
        </>
      )}
    </CollapsibleCard>
  );
}
