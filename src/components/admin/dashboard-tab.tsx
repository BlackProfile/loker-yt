"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { format, parseISO } from "date-fns";
import { id as localeId } from "date-fns/locale";
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
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Eye,
  Handshake,
  Inbox,
  MailCheck,
  RefreshCw,
  Sparkles,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type ActionItemsResponse,
  type AdminOverviewResponse,
  type AdminPositionStatsResponse,
  type Application,
  type ApplicationStatus,
  type PositionStatsRow,
} from "@/lib/types";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { formatDate, formatDateTime, formatRelative, initialsOf } from "./format";
import {
  StatusBadge,
  statusBarColor,
  aiScoreStyle,
} from "./status-badge";
import { ApplicationDetailDialog } from "./application-detail-dialog";
import { CountUp, STAGGER_CONTAINER, STAGGER_ITEM } from "./motion-primitives";
import { cn } from "@/lib/utils";

type StatCardConfig = {
  key: keyof AdminOverviewResponse["stats"];
  label: string;
  icon: LucideIcon;
  iconWrap: string;
  strip: string;
};

const STAT_CARDS: StatCardConfig[] = [
  { key: "total", label: "Total Pelamar", icon: Users, iconWrap: "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400", strip: "border-t-rose-500" },
  { key: "NEW", label: "Baru", icon: Inbox, iconWrap: "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400", strip: "border-t-amber-400" },
  { key: "REVIEWED", label: "Ditinjau", icon: Eye, iconWrap: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", strip: "border-t-zinc-400" },
  { key: "INTERVIEW", label: "Wawancara", icon: CalendarClock, iconWrap: "bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400", strip: "border-t-orange-500" },
  { key: "ACCEPTED", label: "Diterima", icon: CheckCircle2, iconWrap: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400", strip: "border-t-emerald-500" },
  { key: "REJECTED", label: "Ditolak", icon: XCircle, iconWrap: "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400", strip: "border-t-rose-500" },
];

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number | string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const raw = payload[0]?.value ?? 0;
  const dateLabel =
    typeof label === "string"
      ? format(parseISO(label), "d MMMM yyyy", { locale: localeId })
      : String(label);
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-sm">
      <p className="font-medium">{dateLabel}</p>
      <p className="text-muted-foreground">{raw} lamaran</p>
    </div>
  );
}

// Tooltip Perbandingan Lowongan: lamaran, views, dan konversi.
function CompareTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: {
    payload?: {
      fullTitle?: string;
      applications?: number;
      views?: number;
      conversion?: number | null;
    };
  }[];
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-sm">
      <p className="max-w-48 truncate font-medium">{row?.fullTitle ?? "-"}</p>
      <p className="text-muted-foreground">
        Lamaran: <span className="font-medium text-foreground">{row?.applications ?? 0}</span>
      </p>
      <p className="text-muted-foreground">
        Views: <span className="font-medium text-foreground">{row?.views ?? 0}</span>
      </p>
      <p className="text-muted-foreground">
        Konversi:{" "}
        <span className="font-medium text-foreground">
          {row?.conversion != null ? `${row.conversion}%` : "-"}
        </span>
      </p>
    </div>
  );
}

// Judul pendek untuk sumbu X grafik perbandingan lowongan.
function shortTitle(title: string): string {
  const clean = title.trim();
  return clean.length > 10 ? `${clean.slice(0, 10).trimEnd()}…` : clean;
}

export function DashboardTab() {
  const { reportError } = useAdminSession();
  const reducedMotion = useReducedMotion();
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Application | null>(null);

  // Perbandingan lowongan (GET /api/admin/position-stats).
  const [posStats, setPosStats] = useState<PositionStatsRow[]>([]);
  const [posStatsLoading, setPosStatsLoading] = useState(true);

  // Kartu "Perlu Tindakan" (GET /api/admin/action-items).
  const [actionItems, setActionItems] = useState<ActionItemsResponse | null>(null);

  const loadActionItems = useCallback(async () => {
    try {
      const data = await apiGet<ActionItemsResponse>("/api/admin/action-items");
      setActionItems(data);
    } catch {
      // Kartu pelengkap; senyap saat gagal (data lama dipertahankan).
    }
  }, []);

  // silent: refresh senyap (dipakai event realtime) — data lama tetap tampil,
  // state loading tidak disentuh sehingga skeleton tidak muncul ulang.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<AdminOverviewResponse>("/api/admin/overview");
      setOverview(data);
    } catch (err) {
      reportError(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportError]);

  const loadPosStats = useCallback(async (silent = false) => {
    if (!silent) setPosStatsLoading(true);
    try {
      const data = await apiGet<AdminPositionStatsResponse>("/api/admin/position-stats");
      setPosStats(data.rows);
    } catch {
      // Grafik pelengkap; tampilkan kosong tanpa toast agar tidak berisik.
      // Saat senyap, data lama dipertahankan (tanpa flash kosong).
      if (!silent) setPosStats([]);
    } finally {
      if (!silent) setPosStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadPosStats();
  }, [loadPosStats]);

  useEffect(() => {
    void loadActionItems();
  }, [loadActionItems]);

  // Realtime: lamaran baru/perubahan status memengaruhi overview + statistik.
  useLiveRefresh("applications:changed", () => {
    void load(true);
    void loadPosStats(true);
    void loadActionItems();
  });
  // Perubahan posisi memengaruhi grafik perbandingan (views/konversi/kuota).
  useLiveRefresh("positions:changed", () => {
    void loadPosStats(true);
  });
  // Sesi wawancara baru (reschedule/no-show) memengaruhi kartu tindakan.
  useLiveRefresh("interviews:changed", () => {
    void loadActionItems();
  });

  const stats = overview?.stats;
  const total = stats?.total ?? 0;

  // Distribusi: 5 tahap bawaan + bucket CUSTOM (agregat tahap kustom).
  type DistributionBucket = ApplicationStatus | "CUSTOM";
  const buckets: DistributionBucket[] = [...APPLICATION_STATUSES, "CUSTOM"];
  const segments = buckets
    .map((bucket) => {
      const value =
        bucket === "CUSTOM" ? (stats?.CUSTOM ?? 0) : (stats?.[bucket] ?? 0);
      return {
        bucket,
        label: bucket === "CUSTOM" ? "Tahap Kustom" : STATUS_LABELS[bucket],
        value,
        pct: total > 0 ? (value / total) * 100 : 0,
      };
    })
    .filter((s) => s.value > 0);

  const daily = overview?.daily ?? [];

  const compareData = posStats.map((row) => ({
    title: shortTitle(row.title),
    fullTitle: row.title,
    applications: row.applications,
    views: row.views,
    conversion: row.conversion,
  }));

  // Buka dialog detail pelamar dari kartu tindakan (butuh objek Application penuh).
  async function openAppById(id: string) {
    try {
      const apps = await apiGet<Application[]>("/api/admin/applications");
      const app = apps.find((a) => a.id === id);
      if (app) {
        setDetail(app);
      } else {
        toast.error("Lamaran tidak ditemukan.");
      }
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Kartu statistik: 6 status + rata-rata skor AI + pelanggan */}
      <motion.div
        className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4"
        variants={STAGGER_CONTAINER}
        initial={reducedMotion ? false : "hidden"}
        animate="show"
      >
        {STAT_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <motion.div key={card.key} variants={STAGGER_ITEM}>
              <Card
                className={cn(
                  "gap-0 overflow-hidden rounded-2xl border-t-2 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md",
                  card.strip
                )}
              >
                <CardContent className="px-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-2xl font-bold tabular-nums">
                      {loading ? "—" : <CountUp value={stats?.[card.key] ?? 0} />}
                    </span>
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${card.iconWrap}`}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                    {card.label}
                  </p>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}

        {/* Rata-rata Skor AI */}
        <motion.div variants={STAGGER_ITEM}>
          <Card className="gap-0 overflow-hidden rounded-2xl border-t-2 border-t-rose-600 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="px-4">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    overview?.avgAiScore != null ? aiScoreStyle(overview.avgAiScore) : "text-muted-foreground"
                  )}
                >
                  {loading
                    ? "—"
                    : overview?.avgAiScore != null
                      ? <CountUp value={overview.avgAiScore} />
                      : "-"}
                </span>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                  <Sparkles className="size-4" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                Rata-rata Skor AI
              </p>
            </CardContent>
          </Card>
        </motion.div>

        {/* Pelanggan Notifikasi */}
        <motion.div variants={STAGGER_ITEM}>
          <Card className="gap-0 overflow-hidden rounded-2xl border-t-2 border-t-amber-500 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardContent className="px-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-2xl font-bold tabular-nums">
                  {loading ? "—" : <CountUp value={overview?.subscriberCount ?? 0} />}
                </span>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
                  <MailCheck className="size-4" aria-hidden="true" />
                </span>
              </div>
              <p className="mt-1.5 text-xs font-medium text-muted-foreground">
                Pelanggan Notifikasi
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </motion.div>

      {/* Grafik tren 30 hari */}
      <Card className="rounded-2xl p-6">
        <CardTitle className="text-base">Tren Lamaran 30 Hari</CardTitle>
        <CardDescription className="mt-1">
          Jumlah lamaran masuk per hari dalam sebulan terakhir.
        </CardDescription>
        <CardContent className="mt-4 px-0">
          {loading ? (
            <Skeleton className="h-[260px] w-full rounded-xl" />
          ) : (
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f43f5e" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#f43f5e" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(v: string) => format(parseISO(v), "dd/MM")}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={{ stroke: "var(--border)" }}
                    minTickGap={20}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#f43f5e", strokeOpacity: 0.3 }} />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name="Lamaran"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    fill="url(#dailyFill)"
                    activeDot={{ r: 4, fill: "#f43f5e" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Perbandingan Lowongan */}
      <Card className="rounded-2xl p-6">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="size-4 text-rose-500" aria-hidden="true" />
          Perbandingan Lowongan
        </CardTitle>
        <CardDescription className="mt-1">
          Jumlah lamaran masuk dibanding tampilan halaman (views) per posisi.
        </CardDescription>
        <CardContent className="mt-4 px-0">
          {posStatsLoading ? (
            <Skeleton className="h-[280px] w-full rounded-xl" />
          ) : compareData.length === 0 ? (
            <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
              Belum ada data posisi.
            </div>
          ) : (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={compareData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="title"
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
                    content={<CompareTooltip />}
                    cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
                  />
                  <Bar
                    dataKey="applications"
                    name="Lamaran"
                    fill="#f43f5e"
                    radius={[4, 4, 0, 0]}
                    barSize={26}
                  />
                  <Bar
                    dataKey="views"
                    name="Views"
                    fill="#f59e0b"
                    radius={[4, 4, 0, 0]}
                    barSize={10}
                  />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1.5">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-[#f43f5e]" aria-hidden="true" />
                  Lamaran
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="size-2 rounded-full bg-[#f59e0b]" aria-hidden="true" />
                  Views
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wawancara mendatang + perlu ditindaklanjuti */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="gap-0 rounded-2xl py-6">
          <CardHeader className="px-6">
            <CardTitle className="text-base">Wawancara Mendatang</CardTitle>
            <CardDescription className="mt-1">
              Jadwal wawancara terdekat yang sudah diatur.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6">
            {loading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : (overview?.upcomingInterviews?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CalendarClock className="size-8 text-muted-foreground/50" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Belum ada jadwal wawancara mendatang.
                </p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto nice-scrollbar">
                {overview?.upcomingInterviews.map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center gap-3 border-b py-3 last:border-b-0"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-400">
                      {initialsOf(app.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{app.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {app.positionTitle ?? "-"} · {formatDateTime(app.interviewAt)}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 shrink-0 sm:h-8"
                      onClick={() => setDetail(app)}
                    >
                      Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 rounded-2xl border-amber-200 bg-amber-50/60 py-6 dark:border-amber-900 dark:bg-amber-950/20">
          <CardHeader className="px-6">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Perlu Ditindaklanjuti
            </CardTitle>
            <CardDescription className="mt-1">
              Lamaran tanpa perubahan lebih dari 7 hari — ubah status atau arsipkan.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6">
            {loading ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : (overview?.stale?.length ?? 0) === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CheckCircle2 className="size-8 text-emerald-500/70" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Semua lamaran tertangani. Kerja bagus!
                </p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto nice-scrollbar">
                {overview?.stale.map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center gap-3 border-b py-3 last:border-b-0"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                      {initialsOf(app.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{app.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {app.positionTitle ?? "-"} · masuk {formatDate(app.createdAt)} ({formatRelative(app.createdAt)})
                      </p>
                    </div>
                    <StatusBadge status={app.status} className="hidden shrink-0 sm:inline-flex" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-11 shrink-0 sm:h-8"
                      onClick={() => setDetail(app)}
                    >
                      Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bar distribusi status */}
      <Card className="rounded-2xl p-6">
        <CardTitle className="text-base">Distribusi Status Lamaran</CardTitle>
        <CardDescription className="mt-1">
          Proporsi lamaran berdasarkan tahapan seleksi.
        </CardDescription>
        <CardContent className="mt-4 px-0">
          {loading ? (
            <Skeleton className="h-3 w-full rounded-full" />
          ) : total > 0 ? (
            <div
              className="flex h-3 w-full overflow-hidden rounded-full"
              role="img"
              aria-label="Bar distribusi tahap lamaran"
            >
              {segments.map((s) => (
                <div
                  key={s.bucket}
                  className={statusBarColor(s.bucket)}
                  style={{ width: `${s.pct}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Belum ada data lamaran.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {segments.map((s) => (
              <span
                key={s.bucket}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  className={`size-2 rounded-full ${statusBarColor(s.bucket)}`}
                  aria-hidden="true"
                />
                {s.label}
                <span className="font-medium text-foreground">{s.value}</span>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Lamaran terbaru */}
      <Card className="gap-0 rounded-2xl py-6">
        <CardHeader className="flex-row items-center justify-between px-6">
          <div>
            <CardTitle className="text-base">Lamaran Terbaru</CardTitle>
            <CardDescription className="mt-1">
              5 lamaran terakhir yang masuk.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-10 active:scale-[0.99] sm:h-9"
            onClick={() => {
              void load();
              void loadPosStats();
            }}
            disabled={loading}
            aria-label="Segarkan data dashboard"
          >
            <RefreshCw
              className={`size-4 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Segarkan
          </Button>
        </CardHeader>
        <CardContent className="px-6">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : (overview?.recent?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Belum ada lamaran yang masuk.
              </p>
            </div>
          ) : (
            <div className="-mx-2 max-h-96 overflow-y-auto px-2 nice-scrollbar">
              {overview?.recent.map((app) => (
                <div
                  key={app.id}
                  className="flex items-center gap-3 border-b py-3 last:border-b-0"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                    {initialsOf(app.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{app.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {app.positionTitle ?? "Tanpa posisi"}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {formatDate(app.createdAt)}
                  </span>
                  <StatusBadge status={app.status} className="hidden shrink-0 sm:inline-flex" />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-11 shrink-0 sm:h-8"
                    onClick={() => setDetail(app)}
                  >
                    Detail
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={(updated) => {
          setOverview((prev) =>
            prev
              ? {
                  ...prev,
                  recent: prev.recent.map((a) => (a.id === updated.id ? updated : a)),
                  upcomingInterviews: prev.upcomingInterviews.map((a) =>
                    a.id === updated.id ? updated : a
                  ),
                  stale: prev.stale.map((a) => (a.id === updated.id ? updated : a)),
                }
              : prev
          );
          void load(true);
        }}
        onDeleted={() => void load(true)}
      />
    </div>
  );
}
