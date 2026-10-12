"use client";

// NR49-A — Kartu "Log Aktivitas AI" (tab Pengaturan, kelompok Pusat Kendali AI).
// GET /api/admin/ai-usage?days=N -> { usage: AiUsageView } (semua role login).
//
// Karakter penting:
// - Select rentang (7/14/30 hari) + tombol Segarkan.
// - Grafik batang harian MURNI div/flex (tanpa library chart), tanpa animasi
//   (menghormati prefers-reduced-motion), tooltip memakai atribut title.
// - Daftar log terbaru (maks 60) dengan scrollbar tipis.
// - Polling 60 detik, SKIP saat document.hidden, interval dibersihkan saat
//   unmount (pola server-health-card). Toleran gagal: baris amber + Coba Lagi.

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ScrollText } from "lucide-react";
import type { AiUsagePoint, AiUsageRow, AiUsageView } from "@/lib/ai-features";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CollapsibleCard } from "./collapsible-card";
import { apiGet } from "./api";
import { formatDate, formatShortDateTime } from "./format";

const POLL_MS = 60_000;

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  OK: {
    label: "Berhasil",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  },
  ERROR: {
    label: "Gagal",
    className:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  },
  BLOCKED: {
    label: "Diblokir",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
};

// Sel ringkasan kecil (pola MetricCell server-health-card).
function SummaryCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ok" | "error" | "blocked" | "neutral";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "error"
        ? "text-rose-600 dark:text-rose-400"
        : tone === "blocked"
          ? "text-amber-600 dark:text-amber-400"
          : "";
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 text-base font-bold tabular-nums ${toneClass}`}>
        {value.toLocaleString("id-ID")}
      </p>
    </div>
  );
}

// Satu kolom batang harian (tanpa animasi/transisi apa pun).
function DayBar({ day, maxTotal }: { day: AiUsagePoint; maxTotal: number }) {
  const total = day.ok + day.error + day.blocked;
  const pct = (n: number) => `${(n / maxTotal) * 100}%`;
  const title = `${day.date}: ${day.ok} berhasil, ${day.error} gagal, ${day.blocked} diblokir`;
  const okIsTop = day.error === 0 && day.blocked === 0;
  const blockedIsTop = day.error === 0;
  return (
    <div
      className="flex min-w-0 flex-1 flex-col justify-end"
      style={{ height: "100%" }}
      title={title}
    >
      {total === 0 ? (
        <div className="h-0.5 w-full rounded-sm bg-zinc-200 dark:bg-zinc-700" />
      ) : (
        <>
          {day.error > 0 ? (
            <div className="w-full rounded-t-sm bg-rose-500" style={{ height: pct(day.error) }} />
          ) : null}
          {day.blocked > 0 ? (
            <div
              className={`w-full bg-amber-500 ${blockedIsTop ? "rounded-t-sm" : ""}`}
              style={{ height: pct(day.blocked) }}
            />
          ) : null}
          <div
            className={`w-full bg-emerald-500 ${okIsTop ? "rounded-t-sm" : ""}`}
            style={{ height: pct(day.ok) }}
          />
        </>
      )}
    </div>
  );
}

// Satu baris log terbaru.
function LogRow({ row }: { row: AiUsageRow }) {
  const meta = STATUS_BADGE[row.status] ?? {
    label: row.status,
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatShortDateTime(row.createdAt)}
        </span>
        <Badge variant="outline" className={`shrink-0 px-1.5 py-0 text-[10px] ${meta.className}`}>
          {meta.label}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.featureLabel}</span>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {row.durationMs.toLocaleString("id-ID")} ms
        </span>
      </div>
      <p className="truncate text-xs text-muted-foreground">Aktor: {row.actor ?? "-"}</p>
      {row.detail ? (
        <p className="truncate text-xs text-muted-foreground/80" title={row.detail}>
          {row.detail}
        </p>
      ) : null}
    </li>
  );
}

export function AiUsageCard() {
  const [usage, setUsage] = useState<AiUsageView | null>(null);
  const [days, setDays] = useState(14);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);

  const refresh = useCallback(async (nextDays: number, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<{ usage: AiUsageView }>(`/api/admin/ai-usage?days=${nextDays}`);
      setUsage(data.usage);
      setFetchFailed(false);
    } catch {
      setFetchFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh(days);
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void refresh(days, true);
    }, POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) void refresh(days, true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, days]);

  function handleDays(value: string) {
    const next = Number(value);
    if (!Number.isFinite(next) || next === days) return;
    setDays(next);
    void refresh(next);
  }

  const totals = usage?.totals;
  const daily = usage?.daily ?? [];
  const maxTotal = Math.max(1, ...daily.map((d) => d.ok + d.error + d.blocked));
  const firstDay = daily.length > 0 ? daily[0].date : null;
  const lastDay = daily.length > 0 ? daily[daily.length - 1].date : null;

  return (
    <CollapsibleCard
      id="log-aktivitas-ai"
      icon={ScrollText}
      title="Log Aktivitas AI"
      description="Riwayat pemanggilan fitur AI: berhasil, gagal, atau diblokir gerbang kendali."
      status={
        usage && totals
          ? { label: `${totals.ok} panggilan · ${usage.days} hari`, tone: "neutral" }
          : undefined
      }
    >
      {fetchFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Belum dapat memuat log aktivitas AI.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950"
            onClick={() => void refresh(days)}
          >
            Coba Lagi
          </Button>
        </div>
      ) : null}

      {/* Header: rentang + segarkan */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(days)} onValueChange={handleDays}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Rentang log aktivitas AI">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">7 Hari</SelectItem>
            <SelectItem value="14">14 Hari</SelectItem>
            <SelectItem value="30">30 Hari</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => void refresh(days)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="size-3.5" aria-hidden="true" />
          )}
          Segarkan
        </Button>
      </div>

      {loading && !usage ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[68px] rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : usage && totals ? (
        <>
          {/* Ringkasan */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryCell label="Berhasil" value={totals.ok} tone="ok" />
            <SummaryCell label="Gagal" value={totals.error} tone="error" />
            <SummaryCell label="Diblokir" value={totals.blocked} tone="blocked" />
            <SummaryCell label="Fitur terpakai" value={totals.featuresUsed} tone="neutral" />
          </div>

          {/* Grafik batang harian — murni div/flex, tanpa animasi */}
          <div>
            <div
              className="flex h-24 items-end gap-1"
              role="img"
              aria-label="Grafik pemanggilan AI per hari"
            >
              {daily.map((d) => (
                <DayBar key={d.date} day={d} maxTotal={maxTotal} />
              ))}
            </div>
            {firstDay && lastDay ? (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {formatDate(firstDay)} – {formatDate(lastDay)} · batang hijau berhasil, kuning
                diblokir, merah gagal
              </p>
            ) : null}
          </div>

          {/* Log terbaru */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Log Terbaru
            </p>
            {usage.recent.length === 0 ? (
              <p className="rounded-lg border bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                Belum ada aktivitas AI pada rentang ini.
              </p>
            ) : (
              <ul
                className="nice-scrollbar flex max-h-96 flex-col gap-2 overflow-y-auto pr-1"
                aria-label="Log terbaru aktivitas AI"
              >
                {usage.recent.map((row) => (
                  <LogRow key={row.id} row={row} />
                ))}
              </ul>
            )}
          </div>
        </>
      ) : null}
    </CollapsibleCard>
  );
}
