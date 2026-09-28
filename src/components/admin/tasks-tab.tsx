"use client";

// Pusat Tugas (Task 20-a): satu halaman yang mengelompokkan semua hal yang butuh
// tindakan admin, dengan hitungan per kategori dan aksi cepat "Buka Detail".
// Sumber data: GET /api/admin/action-items (termasuk field perluasan
// staleNewApplications & duplicateApplications) + daftar lamaran untuk membuka
// detail kandidat. Auto-refresh via useLiveRefresh (event realtime).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  CalendarClock,
  ClipboardCheck,
  Copy,
  Eye,
  Handshake,
  Inbox,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import type { ActionItemsResponse, Application } from "@/lib/types";
import { formatDate, formatShortDateTime } from "./format";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { ApplicationDetailDialog } from "./application-detail-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SimpleAppItem = {
  applicationId: string;
  name: string;
  positionTitle: string | null;
  createdAt: string;
};

// Respons action-items dengan perluasan Pusat Tugas (field opsional agar aman
// terhadap respons lama yang belum menyertakan field baru).
type ExtendedActionItems = ActionItemsResponse & {
  staleNewApplications?: SimpleAppItem[];
  duplicateApplications?: SimpleAppItem[];
};

function offerUrgency(deadline: string | null): { label: string; urgent: boolean } | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms < 0) return { label: "Lewat batas jawaban", urgent: true };
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 2) return { label: `Sisa ${days} hari`, urgent: true };
  return { label: `Batas ${formatDate(deadline)}`, urgent: false };
}

function TaskGroup({
  icon: Icon,
  title,
  description,
  count,
  tone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  count: number;
  tone: "rose" | "amber";
  children: React.ReactNode;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl",
              tone === "rose"
                ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
          {count > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                "rounded-full tabular-nums",
                tone === "rose"
                  ? "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
                  : "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
              )}
              aria-label={`${count} item ${title}`}
            >
              {count}
            </Badge>
          ) : (
            <Badge variant="secondary" className="rounded-full tabular-nums">
              0
            </Badge>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function TasksTab() {
  const { reportError } = useAdminSession();

  const [items, setItems] = useState<ExtendedActionItems | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Application | null>(null);

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [actionItems, apps] = await Promise.all([
          apiGet<ExtendedActionItems>("/api/admin/action-items"),
          apiGet<Application[]>("/api/admin/applications"),
        ]);
        setItems(actionItems);
        setApplications(apps);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Auto-refresh realtime senyap (anti-flicker) saat lamaran/wawancara berubah.
  useLiveRefresh("applications:changed", () => void loadAll(true));
  useLiveRefresh("interviews:changed", () => void loadAll(true));

  function openDetail(applicationId: string, name: string) {
    const app = applications.find((a) => a.id === applicationId);
    if (app) {
      setDetail(app);
    } else {
      toast.info(`Detail ${name} tidak tersedia — muat ulang halaman atau sesuaikan filter.`);
    }
  }

  const staleNew = items?.staleNewApplications ?? [];
  const duplicates = items?.duplicateApplications ?? [];
  const offers = items?.offersAwaiting ?? [];
  const reschedules = items?.rescheduleRequests ?? [];
  const unscored = items?.unscoredInterviews ?? [];

  const totalCount =
    staleNew.length + duplicates.length + offers.length + reschedules.length + unscored.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-bold sm:text-lg">
            Pusat Tugas
            {totalCount > 0 ? (
              <Badge className="rounded-full border-transparent bg-rose-600 text-white tabular-nums">
                {totalCount}
              </Badge>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            Semua hal yang menunggu keputusan atau tindakan admin, dikelompokkan per kategori.
          </p>
        </div>
        {loading ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Memuat...
          </span>
        ) : null}
      </div>

      {loading && !items ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      ) : totalCount === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm font-medium">Semua beres!</p>
            <p className="text-sm text-muted-foreground">
              Tidak ada tugas yang menunggu tindakan saat ini.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* Lamaran belum ditinjau > 3 hari */}
          <TaskGroup
            icon={AlertCircle}
            title="Lamaran Belum Ditinjau"
            description="Lamaran baru tanpa perubahan lebih dari 3 hari."
            count={staleNew.length}
            tone="rose"
          >
            {staleNew.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {staleNew.map((row) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"} &middot; masuk{" "}
                        {formatShortDateTime(row.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* Offer menunggu jawaban (mendekati / lewat deadline) */}
          <TaskGroup
            icon={Handshake}
            title="Penawaran Menunggu Jawaban"
            description="Offer PENDING — perhatikan yang mendekati atau lewat batas."
            count={offers.length}
            tone="amber"
          >
            {offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {offers.map((row) => {
                  const urgency = offerUrgency(row.deadline);
                  return (
                    <div
                      key={row.applicationId}
                      className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.positionTitle ?? "Tanpa posisi"}
                          {row.salary ? ` &middot; ${row.salary}` : ""}
                          {urgency ? (
                            <>
                              {" "}
                              &middot;{" "}
                              <span
                                className={cn(
                                  "font-medium",
                                  urgency.urgent
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground"
                                )}
                              >
                                {urgency.label}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => openDetail(row.applicationId, row.name)}
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                        Buka Detail
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </TaskGroup>

          {/* Permintaan ubah jadwal wawancara */}
          <TaskGroup
            icon={CalendarClock}
            title="Permintaan Ubah Jadwal"
            description="Wawancara RESCHEDULE_REQUESTED menunggu keputusan Anda."
            count={reschedules.length}
            tone="rose"
          >
            {reschedules.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {reschedules.map((row) => (
                  <div
                    key={row.interviewId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"} &middot; jadwal{" "}
                        {formatShortDateTime(row.scheduledAt)}
                        {row.reason ? ` &middot; alasan: ${row.reason}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* Wawancara selesai tanpa skor */}
          <TaskGroup
            icon={ClipboardCheck}
            title="Wawancara Belum Dinilai"
            description="Selesai lebih dari 3 hari tanpa scorecard."
            count={unscored.length}
            tone="amber"
          >
            {unscored.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {unscored.map((row) => (
                  <div
                    key={row.interviewId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"}
                        {row.completedAt
                          ? ` &middot; selesai ${formatShortDateTime(row.completedAt)}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* Lamaran duplikat perlu dicek */}
          <TaskGroup
            icon={Copy}
            title="Lamaran Duplikat"
            description="Kemungkinan lamaran ganda (email/telepon sama pada posisi yang sama)."
            count={duplicates.length}
            tone="amber"
          >
            {duplicates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {duplicates.map((row) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 p-2.5 dark:border-amber-900"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"} &middot; masuk{" "}
                        {formatShortDateTime(row.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>
        </div>
      )}

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={(updated) => {
          setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
          setDetail((prev) => (prev && prev.id === updated.id ? updated : prev));
        }}
        onDeleted={(id) => {
          setApplications((prev) => prev.filter((a) => a.id !== id));
          setDetail(null);
          void loadAll(true);
        }}
      />
    </div>
  );
}
