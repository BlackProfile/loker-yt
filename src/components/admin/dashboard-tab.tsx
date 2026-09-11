"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Avatar,
  AvatarFallback,
} from "@/components/ui/avatar";
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
  CalendarClock,
  CheckCircle2,
  Eye,
  Inbox,
  Loader2,
  RefreshCw,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type AdminOverviewResponse,
  type Application,
  type ApplicationStatus,
} from "@/lib/types";
import { apiGet } from "./api";
import { formatDate, initialsOf } from "./format";
import {
  StatusBadge,
  STATUS_BAR_COLORS,
  STATUS_DOT_COLORS,
} from "./status-badge";
import { ApplicationDetailDialog } from "./application-detail-dialog";

type StatCardConfig = {
  key: keyof AdminOverviewResponse["stats"];
  label: string;
  icon: LucideIcon;
  iconWrap: string;
  strip: string;
};

const STAT_CARDS: StatCardConfig[] = [
  { key: "total", label: "Total Pelamar", icon: Users, iconWrap: "bg-rose-100 text-rose-600", strip: "border-t-rose-500" },
  { key: "NEW", label: "Baru", icon: Inbox, iconWrap: "bg-amber-100 text-amber-600", strip: "border-t-amber-400" },
  { key: "REVIEWED", label: "Ditinjau", icon: Eye, iconWrap: "bg-zinc-100 text-zinc-600", strip: "border-t-zinc-400" },
  { key: "INTERVIEW", label: "Wawancara", icon: CalendarClock, iconWrap: "bg-orange-100 text-orange-600", strip: "border-t-orange-500" },
  { key: "ACCEPTED", label: "Diterima", icon: CheckCircle2, iconWrap: "bg-emerald-100 text-emerald-600", strip: "border-t-emerald-500" },
  { key: "REJECTED", label: "Ditolak", icon: XCircle, iconWrap: "bg-rose-100 text-rose-600", strip: "border-t-rose-500" },
];

export function DashboardTab() {
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Application | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<AdminOverviewResponse>("/api/admin/overview");
      setOverview(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = overview?.stats;
  const total = stats?.total ?? 0;

  const segments = APPLICATION_STATUSES.map((status) => {
    const value = stats?.[status] ?? 0;
    return {
      status,
      value,
      pct: total > 0 ? (value / total) * 100 : 0,
    };
  }).filter((s) => s.value > 0);

  return (
    <div className="flex flex-col gap-6">
      {/* Kartu statistik */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-6">
        {STAT_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <Card
              key={card.key}
              className={`gap-0 overflow-hidden rounded-2xl border-t-2 py-4 ${card.strip}`}
            >
              <CardContent className="px-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-bold tabular-nums">
                    {loading ? "—" : (stats?.[card.key] ?? 0)}
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
          );
        })}
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
              aria-label="Bar distribusi status lamaran"
            >
              {segments.map((s) => (
                <div
                  key={s.status}
                  className={STATUS_BAR_COLORS[s.status]}
                  style={{ width: `${s.pct}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Belum ada data lamaran.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {APPLICATION_STATUSES.map((status: ApplicationStatus) => (
              <span
                key={status}
                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
              >
                <span
                  className={`size-2 rounded-full ${STATUS_DOT_COLORS[status]}`}
                  aria-hidden="true"
                />
                {STATUS_LABELS[status]}
                <span className="font-medium text-foreground">
                  {stats?.[status] ?? 0}
                </span>
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
            className="h-10 sm:h-9"
            onClick={() => void load()}
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
                  <Avatar className="size-9 shrink-0">
                    <AvatarFallback className="bg-rose-100 text-xs font-semibold text-rose-700">
                      {initialsOf(app.name)}
                    </AvatarFallback>
                  </Avatar>
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
                    className="h-10 shrink-0 sm:h-8"
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
        onSaved={() => void load()}
        onDeleted={() => void load()}
      />
    </div>
  );
}
