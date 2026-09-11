"use client";

// Tab Analitik: metrik rekrutmen + grafik funnel/alasan penolakan/bulanan
// + daftar beban pewawancara. Sumber: GET /api/admin/analytics, refresh senyap
// saat event applications:changed / interviews:changed (anti-flicker).

import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  CalendarCheck,
  Handshake,
  Inbox,
  Percent,
  RefreshCw,
  Timer,
  TrendingUp,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  STATUS_LABELS,
  type AnalyticsResponse,
  type ApplicationStatus,
} from "@/lib/types";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { cn } from "@/lib/utils";

// Palet tema (zinc + rose + amber + emerald) — tanpa biru/indigo/violet.
const ROSE = "#f43f5e";
const AMBER = "#f59e0b";
const EMERALD = "#10b981";

type MetricCard = {
  key: string;
  label: string;
  icon: LucideIcon;
  iconWrap: string;
  strip: string;
  value: string;
};

function funnelLabel(stage: string): string {
  if (stage === "CUSTOM") return "Tahap Kustom";
  return STATUS_LABELS[stage as ApplicationStatus] ?? stage;
}

// Tooltip generik untuk bar chart (judul + baris nilai).
function ChartTooltip({
  active,
  payload,
  label,
  valueSuffix = "",
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
  valueSuffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{String(label ?? "")}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-muted-foreground">
          {p.name}:{" "}
          <span className="font-medium text-foreground">
            {p.value}
            {valueSuffix}
          </span>
        </p>
      ))}
    </div>
  );
}

export function AnalyticsTab() {
  const { reportError } = useAdminSession();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // silent: refresh senyap — data lama tetap tampil, skeleton hanya load pertama.
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await apiGet<AnalyticsResponse>("/api/admin/analytics");
        setData(res);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useLiveRefresh("applications:changed", () => {
    void load(true);
  });
  useLiveRefresh("interviews:changed", () => {
    void load(true);
  });

  const totals = data?.totals;
  // Empty state: belum ada lamaran sama sekali.
  const empty = !loading && (totals?.applications ?? 0) === 0;

  const funnelData = (data?.funnel ?? []).map((f) => ({
    stage: f.stage,
    label: funnelLabel(f.stage),
    count: f.count,
  }));

  const rejectionData = (data?.rejectionReasons ?? []).map((r) => ({
    label: r.label,
    count: r.count,
  }));

  const monthlyData = (data?.monthly ?? []).map((m) => {
    const [year, month] = m.month.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    return {
      month: date.toLocaleDateString("id-ID", { month: "short" }),
      applications: m.applications,
      hires: m.hires,
    };
  });

  const maxInterviewerLoad = Math.max(
    1,
    ...(data?.interviewerLoad ?? []).map((i) => i.count)
  );

  function metric(label: string, icon: LucideIcon, iconWrap: string, strip: string, value: string): MetricCard {
    return { key: label, label, icon, iconWrap, strip, value };
  }

  const metrics: MetricCard[] = data
    ? [
        metric(
          "Total Lamaran",
          Users,
          "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400",
          "border-t-rose-500",
          String(totals?.applications ?? 0)
        ),
        metric(
          "Diterima Kerja",
          CalendarCheck,
          "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
          "border-t-emerald-500",
          String(totals?.hired ?? 0)
        ),
        metric(
          "Time-to-Hire",
          Timer,
          "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
          "border-t-amber-400",
          data.timeToHireAvgDays != null ? `${data.timeToHireAvgDays.toFixed(1)} hari` : "-"
        ),
        metric(
          "Offer Diterima",
          Percent,
          "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400",
          "border-t-emerald-500",
          data.offerAcceptanceRate != null ? `${data.offerAcceptanceRate.toFixed(1)}%` : "-"
        ),
        metric(
          "Lolos Wawancara",
          TrendingUp,
          "bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400",
          "border-t-orange-500",
          data.interviewPassRate != null ? `${data.interviewPassRate.toFixed(1)}%` : "-"
        ),
        metric(
          "Rata Skor Wawancara",
          Handshake,
          "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400",
          "border-t-rose-500",
          data.avgInterviewScore != null ? `${data.avgInterviewScore.toFixed(1)}/5` : "-"
        ),
      ]
    : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Analitik Rekrutmen</h2>
          <p className="text-xs text-muted-foreground">
            Funnel, penolakan, penawaran, dan performa wawancara.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-11 active:scale-[0.99] sm:h-9"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Segarkan data analitik"
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
          Segarkan
        </Button>
      </div>

      {/* Empty state */}
      {empty ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm font-medium">Belum cukup data</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Analitik terisi otomatis setelah ada lamaran yang masuk dan diproses
              (wawancara, penawaran, keputusan akhir).
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Kartu metrik */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
            {loading && !data
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-[92px] w-full rounded-2xl" />
                ))
              : metrics.map((m) => {
                  const Icon = m.icon;
                  return (
                    <Card
                      key={m.key}
                      className={cn(
                        "gap-0 overflow-hidden rounded-2xl border-t-2 py-4",
                        m.strip
                      )}
                    >
                      <CardContent className="px-4">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xl font-bold tabular-nums sm:text-2xl">
                            {m.value}
                          </span>
                          <span
                            className={cn(
                              "flex size-9 shrink-0 items-center justify-center rounded-lg",
                              m.iconWrap
                            )}
                          >
                            <Icon className="size-4" aria-hidden="true" />
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                          {m.label}
                        </p>
                      </CardContent>
                    </Card>
                  );
                })}
          </div>

          {/* Funnel tahapan */}
          <Card className="rounded-2xl p-4 sm:p-6">
            <CardTitle className="text-base">Funnel Rekrutmen</CardTitle>
            <CardDescription className="mt-1">
              Jumlah lamaran pada tiap tahapan seleksi.
            </CardDescription>
            <CardContent className="mt-4 px-0">
              {loading && !data ? (
                <Skeleton className="h-[260px] w-full rounded-xl" />
              ) : funnelData.length === 0 ? (
                <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                  Belum cukup data.
                </div>
              ) : (
                <div className="h-[260px] w-full">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={funnelData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={{ stroke: "var(--border)" }}
                        interval={0}
                      />
                      <YAxis
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        tickLine={false}
                        axisLine={false}
                        width={40}
                      />
                      <Tooltip
                        content={<ChartTooltip valueSuffix=" lamaran" />}
                        cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
                      />
                      <Bar
                        dataKey="count"
                        name="Lamaran"
                        fill={ROSE}
                        radius={[4, 4, 0, 0]}
                        barSize={34}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Alasan penolakan (bar horizontal) */}
            <Card className="rounded-2xl p-4 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base">
                <XCircle className="size-4 text-rose-500" aria-hidden="true" />
                Alasan Penolakan
              </CardTitle>
              <CardDescription className="mt-1">
                Distribusi alasan lamaran ditolak.
              </CardDescription>
              <CardContent className="mt-4 px-0">
                {loading && !data ? (
                  <Skeleton className="h-[280px] w-full rounded-xl" />
                ) : rejectionData.length === 0 ? (
                  <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                    Belum ada penolakan.
                  </div>
                ) : (
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart
                        data={rejectionData}
                        layout="vertical"
                        margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
                      >
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
                        <XAxis
                          type="number"
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          tickLine={false}
                          axisLine={{ stroke: "var(--border)" }}
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          width={140}
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          tickLine={false}
                          axisLine={false}
                        />
                        <Tooltip
                          content={<ChartTooltip valueSuffix=" lamaran" />}
                          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
                        />
                        <Bar
                          dataKey="count"
                          name="Ditolak"
                          fill={AMBER}
                          radius={[0, 4, 4, 0]}
                          barSize={16}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Tren bulanan lamaran vs diterima */}
            <Card className="rounded-2xl p-4 sm:p-6">
              <CardTitle className="text-base">Lamaran vs Diterima per Bulan</CardTitle>
              <CardDescription className="mt-1">
                Perbandingan 6 bulan terakhir.
              </CardDescription>
              <CardContent className="mt-4 px-0">
                {loading && !data ? (
                  <Skeleton className="h-[280px] w-full rounded-xl" />
                ) : monthlyData.length === 0 ? (
                  <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
                    Belum cukup data.
                  </div>
                ) : (
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          tickLine={false}
                          axisLine={{ stroke: "var(--border)" }}
                          interval={0}
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                          tickLine={false}
                          axisLine={false}
                          width={40}
                        />
                        <Tooltip
                          content={<ChartTooltip />}
                          cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
                        />
                        <Bar
                          dataKey="applications"
                          name="Lamaran"
                          fill={ROSE}
                          radius={[4, 4, 0, 0]}
                          barSize={18}
                        />
                        <Bar
                          dataKey="hires"
                          name="Diterima"
                          fill={EMERALD}
                          radius={[4, 4, 0, 0]}
                          barSize={10}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1.5">
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="size-2 rounded-full" style={{ background: ROSE }} aria-hidden="true" />
                        Lamaran
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="size-2 rounded-full" style={{ background: EMERALD }} aria-hidden="true" />
                        Diterima
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Beban pewawancara */}
          <Card className="gap-0 rounded-2xl py-6">
            <CardHeader className="px-6">
              <CardTitle className="text-base">Beban Pewawancara</CardTitle>
              <CardDescription className="mt-1">
                Jumlah sesi wawancara yang ditangani tiap pewawancara.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6">
              {loading && !data ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full rounded-lg" />
                  ))}
                </div>
              ) : (data?.interviewerLoad ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Belum ada pewawancara tercatat.
                </p>
              ) : (
                <div className="flex max-h-72 flex-col gap-3 overflow-y-auto nice-scrollbar">
                  {data?.interviewerLoad.map((row) => (
                    <div key={row.name} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate font-medium">{row.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {row.count} sesi
                        </span>
                      </div>
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                        role="img"
                        aria-label={`Beban ${row.name}: ${row.count} sesi`}
                      >
                        <div
                          className="h-full rounded-full bg-rose-500"
                          style={{ width: `${Math.round((row.count / maxInterviewerLoad) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
