"use client";

// NR-28 (Paket B) — widget dasbor admin:
//   Item 6  : Sparkline (SVG polyline inline) + indikator tren 7 hari.
//   Item 8  : Kartu "Aktivitas Terbaru" (feed log aktivitas, refresh live).
//   Item 9  : Kartu "Corong Rekrutmen" (bar animasi saat masuk viewport).
// Semua teks UI Bahasa Indonesia, palet zinc + rose + amber (tanpa biru/indigo/
// ungu), tanpa emoji, tanpa alert()/confirm(), dan setiap animasi menghormati
// prefers-reduced-motion. Tanpa dependensi baru — hanya framer-motion + lucide.

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRightCircle,
  CalendarClock,
  Filter,
  Inbox,
  Minus,
  Sparkles,
  Star,
  TrendingDown,
  TrendingUp,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { LogEntry } from "@/lib/types";
import { apiGet } from "./api";
import { useLiveRefresh } from "./use-live-refresh";
import { actionLabel, actorBadgeClass, formatRelative } from "./format";

/* ------------------- Item 6 — sparkline & indikator tren ------------------- */

/**
 * Sparkline mini (SVG polyline inline, tanpa library grafik).
 * Stroke rose-500 2px, ukuran ~90x28. Deret pendek/kosong tidak digambar.
 */
export function Sparkline({
  values,
  width = 90,
  height = 28,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const pad = 2;
  const stepX = (width - pad * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * stepX;
      // Deret datar (semua nilai sama) digambar sebagai garis lurus di tengah.
      const y =
        span === 0
          ? height / 2
          : pad + (1 - (v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke="#f43f5e" /* rose-500 */
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Ringkasan tren 7 hari dari deret harian overview yang SUDAH ter-fetch
 * (`AdminOverviewResponse.daily`) — tanpa API call tambahan.
 * pct = persentase perubahan total 7 hari terakhir vs 7 hari sebelumnya.
 */
export function weeklyTrend(
  daily: { date: string; count: number }[]
): { current: number; previous: number; pct: number | null } {
  const sum = (rows: { count: number }[]) =>
    rows.reduce((acc, r) => acc + r.count, 0);
  const current = sum(daily.slice(-7));
  const previous = sum(daily.slice(-14, -7));
  const pct = previous > 0 ? ((current - previous) / previous) * 100 : null;
  return { current, previous, pct };
}

/**
 * Indikator tren kecil: panah naik/turun + persentase vs 7 hari sebelumnya.
 * Warna: emerald untuk tren baik, rose untuk tren buruk (mis. Ditolak naik),
 * zinc bila netral. goodWhenUp=false membalik makna (metrik yang naik = buruk).
 */
export function TrendHint({
  pct,
  goodWhenUp = true,
  className,
}: {
  pct: number | null;
  goodWhenUp?: boolean;
  className?: string;
}) {
  const neutral = pct == null || Math.abs(pct) < 0.5;
  const up = (pct ?? 0) > 0;
  const good = neutral ? null : goodWhenUp ? up : !up;
  const Icon: LucideIcon = neutral ? Minus : up ? TrendingUp : TrendingDown;
  const color = neutral
    ? "text-zinc-500 dark:text-zinc-400"
    : good
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-rose-600 dark:text-rose-400";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap",
        color,
        className
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {pct != null && !neutral ? `${up ? "+" : ""}${Math.round(pct)}%` : null}
      <span className="font-normal text-muted-foreground">vs minggu lalu</span>
    </span>
  );
}

/* ---------------------- Item 8 — feed Aktivitas Terbaru --------------------- */

// Aksi log yang menarik untuk feed — hanya yang benar-benar dihasilkan
// oleh API (sesuai ACTION_LABELS di ./format dan penulisan log di backend).
const FEED_ACTIONS = new Set([
  "APPLICATION_SUBMITTED",
  "STATUS_CHANGE",
  "RATING",
  "INTERVIEW_SCHEDULED",
  "CHECKIN",
  "AUTO_SHORTLIST",
]);

// Ikon + warna wrap per jenis aksi (palet rose/amber/orange/emerald/zinc).
const FEED_ICONS: Record<string, { icon: LucideIcon; wrap: string }> = {
  APPLICATION_SUBMITTED: {
    icon: Inbox,
    wrap: "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400",
  },
  STATUS_CHANGE: {
    icon: ArrowRightCircle,
    wrap: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  },
  RATING: {
    icon: Star,
    wrap: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  },
  INTERVIEW_SCHEDULED: {
    icon: CalendarClock,
    wrap: "bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400",
  },
  CHECKIN: {
    icon: UserCheck,
    wrap: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
  },
  AUTO_SHORTLIST: {
    icon: Sparkles,
    wrap: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
  },
};

const FEED_ICON_FALLBACK = {
  icon: Inbox,
  wrap: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

/**
 * Kartu "Aktivitas Terbaru": 8 entri log terakhir yang menarik.
 * Terhubung ke refresh live (useLiveRefresh). Bila log membawa id lamaran,
 * klik baris membuka dialog detail lamaran via callback `onOpenApplication`.
 */
export function RecentActivityFeed({
  className,
  onOpenApplication,
}: {
  className?: string;
  onOpenApplication?: (applicationId: string) => void;
}) {
  // null = sedang memuat pertama; setelah itu data lama dipertahankan saat refresh senyap.
  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setFailed(false);
    try {
      // Filter aksi dilakukan di sisi client karena param `action` di API
      // hanya mendukung satu nilai prefix per permintaan.
      const all = await apiGet<LogEntry[]>("/api/admin/logs?limit=200");
      setLogs(all.filter((l) => FEED_ACTIONS.has(l.action)).slice(0, 8));
    } catch {
      // Saat senyap, data lama dipertahankan tanpa mengganggu.
      if (!silent) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh live: lamaran masuk/berubah status dan jadwal wawancara baru
  // memengaruhi isi feed (mekanisme yang sama dengan dashboard-tab).
  useLiveRefresh("applications:changed", () => void load(true));
  useLiveRefresh("interviews:changed", () => void load(true));

  return (
    <Card className={cn("gap-0 rounded-2xl py-6", className)}>
      <CardHeader className="px-6">
        <CardTitle className="text-base">Aktivitas Terbaru</CardTitle>
        <CardDescription className="mt-1">
          8 aktivitas terakhir dari log rekrutmen.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        {logs === null && !failed ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : failed && logs === null ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Gagal memuat aktivitas. Coba segarkan halaman.
            </p>
          </div>
        ) : (logs?.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada aktivitas yang tercatat.
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto nice-scrollbar">
            {logs!.map((log) => {
              const meta = FEED_ICONS[log.action] ?? FEED_ICON_FALLBACK;
              const Icon = meta.icon;
              const clickable = Boolean(log.applicationId && onOpenApplication);
              const body = (
                <>
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg",
                      meta.wrap
                    )}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {log.applicationName ?? actionLabel(log.action)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4",
                          actorBadgeClass(log.actor)
                        )}
                      >
                        {log.actor}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground" title={log.detail ?? undefined}>
                      {log.detail?.trim() ? log.detail : actionLabel(log.action)}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] whitespace-nowrap text-muted-foreground">
                    {formatRelative(log.createdAt)}
                  </span>
                </>
              );
              const rowClass =
                "flex w-full items-center gap-3 border-b py-3 text-left last:border-b-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50";
              return clickable ? (
                <button
                  key={log.id}
                  type="button"
                  className={cn(rowClass, "transition-colors hover:bg-accent/60")}
                  onClick={() => {
                    if (log.applicationId) onOpenApplication?.(log.applicationId);
                  }}
                  aria-label={`Buka detail lamaran: ${log.applicationName ?? actionLabel(log.action)}`}
                >
                  {body}
                </button>
              ) : (
                <div key={log.id} className={rowClass}>
                  {body}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ----------------------- Item 9 — Corong Rekrutmen -------------------------- */

// Bentuk respons GET /api/admin/reports/funnel (tanpa positionId = semua posisi).
type FunnelStage = {
  key: string;
  label: string;
  count: number;
  conversionPct_dari_sebelumnya: number;
  basisLabel: string | null;
};
type FunnelResponse = { stages: FunnelStage[] };

// Warna isian bar: tahap pertama gradasi rose->amber (aksen utama), tahap
// proses zinc, Diterima emerald, Ditolak rose muda — konsisten dengan palet.
function funnelFill(key: string, isFirst: boolean): string {
  if (isFirst) return "bg-gradient-to-r from-rose-600 to-amber-500";
  if (key === "DITERIMA") return "bg-gradient-to-r from-emerald-600 to-emerald-400";
  if (key === "DITOLAK") return "bg-gradient-to-r from-rose-400 to-rose-300";
  return "bg-gradient-to-r from-zinc-400 to-zinc-500 dark:from-zinc-600 dark:to-zinc-500";
}

/**
 * Kartu "Corong Rekrutmen": bar horizontal per tahap, lebar = % dari tahap
 * pertama. Bar dianimasikan dari 0 saat masuk viewport (whileInView) dan
 * langsung lebar penuh bila pengguna memakai prefers-reduced-motion.
 */
export function RecruitmentFunnel({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  const [data, setData] = useState<FunnelResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setFailed(false);
    try {
      setData(await apiGet<FunnelResponse>("/api/admin/reports/funnel"));
    } catch {
      if (!silent) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Lamaran masuk/perubahan status mengubah isi corong.
  useLiveRefresh("applications:changed", () => void load(true));

  const stages = data?.stages ?? [];
  const basisCount = stages[0]?.count ?? 0;
  const empty = failed || stages.length === 0 || basisCount === 0;

  return (
    <Card className={cn("gap-0 rounded-2xl py-6", className)}>
      <CardHeader className="px-6">
        <CardTitle className="flex items-center gap-2 text-base">
          <Filter className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          Corong Rekrutmen
        </CardTitle>
        <CardDescription className="mt-1">
          Jumlah lamaran yang pernah mencapai tiap tahap seleksi.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        {data === null && !failed ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-32 rounded" />
                <Skeleton className="h-7 w-full rounded-lg" />
              </div>
            ))}
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Filter className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Data belum cukup untuk menampilkan corong.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {stages.map((stage, idx) => {
              // Lebar bar relatif terhadap tahap pertama (tahap pertama = 100%).
              const pctWidth =
                basisCount > 0 ? Math.round((stage.count / basisCount) * 100) : 0;
              return (
                <div key={stage.key} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
                    <span className="font-medium">{stage.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{stage.count}</span>
                      {" lamaran"}
                      {idx > 0 ? (
                        <span className="ml-1.5 text-[11px]">
                          · {stage.conversionPct_dari_sebelumnya}% dari{" "}
                          {stage.basisLabel ?? "tahap sebelumnya"}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <div
                    className="h-7 w-full overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800"
                    role="img"
                    aria-label={`${stage.label}: ${stage.count} lamaran`}
                  >
                    <motion.div
                      className={cn("h-full rounded-lg", funnelFill(stage.key, idx === 0))}
                      initial={reduced ? false : { width: 0 }}
                      whileInView={reduced ? undefined : { width: `${pctWidth}%` }}
                      viewport={{ once: true, margin: "0px 0px -8% 0px" }}
                      transition={{
                        duration: reduced ? 0 : 0.6,
                        delay: reduced ? 0 : idx * 0.07,
                        ease: "easeOut",
                      }}
                      style={reduced ? { width: `${pctWidth}%` } : undefined}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
