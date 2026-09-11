"use client";

import { useCallback, useEffect, useState } from "react";
import {
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
} from "date-fns";
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
import { CalendarClock, Inbox } from "lucide-react";
import type { Application } from "@/lib/types";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { formatTime, initialsOf } from "./format";
import { InterviewCalendar } from "./interview-calendar";
import { ApplicationDetailDialog } from "./application-detail-dialog";

// Tab Wawancara: kalender bulanan + panel daftar jadwal tanggal terpilih.
export function InterviewTab() {
  const { reportError } = useAdminSession();
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Application | null>(null);

  // silent: refresh senyap (dipakai event realtime) — jadwal lama tetap tampil
  // sampai data baru siap, tanpa skeleton ulang.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<Application[]>(
        "/api/admin/applications?hasInterview=1"
      );
      setApps(data);
    } catch (err) {
      reportError(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportError]);

  // Muat ulang sekali per bulan tampil.
  useEffect(() => {
    void load();
  }, [load, month]);

  // Realtime: jadwal wawancara bisa berubah dari dialog detail pelamar.
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });

  const monthApps = apps.filter((app) => {
    if (!app.interviewAt) return false;
    const d = new Date(app.interviewAt);
    return !Number.isNaN(d.getTime()) && isSameMonth(d, month);
  });

  const dayApps = selectedDay
    ? apps
        .filter((app) => {
          if (!app.interviewAt) return false;
          const d = new Date(app.interviewAt);
          return !Number.isNaN(d.getTime()) && isSameDay(d, selectedDay);
        })
        .sort(
          (a, b) =>
            new Date(a.interviewAt ?? 0).getTime() -
            new Date(b.interviewAt ?? 0).getTime()
        )
    : [];

  function updateAppInList(updated: Application) {
    setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setDetail((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="rounded-2xl p-4 sm:p-6">
          <InterviewCalendar
            month={month}
            onMonthChange={setMonth}
            apps={apps}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
          <div className="mt-3 flex items-center gap-4 border-t pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-rose-500" aria-hidden="true" />
              Ada jadwal wawancara
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full ring-1 ring-primary" aria-hidden="true" />
              Hari ini
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {loading
                ? "Memuat..."
                : `${monthApps.length} jadwal bulan ${format(month, "MMMM", { locale: localeId })}`}
            </span>
          </div>
        </Card>

        <Card className="gap-0 rounded-2xl py-6">
          <CardHeader className="px-6">
            <CardTitle className="text-base">
              {selectedDay
                ? format(selectedDay, "d MMMM yyyy", { locale: localeId })
                : "Pilih Tanggal"}
            </CardTitle>
            <CardDescription className="mt-1">
              {selectedDay
                ? `${dayApps.length} jadwal pada tanggal ini.`
                : "Klik satu hari pada kalender untuk melihat jadwalnya."}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6">
            {/* Skeleton hanya saat pemuatan pertama; refresh senyap tidak mengganti
                panel dengan skeleton. */}
            {loading && apps.length === 0 ? (
              <div className="flex flex-col gap-3">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : dayApps.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CalendarClock className="size-8 text-muted-foreground/50" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  {selectedDay
                    ? "Belum ada jadwal pada tanggal ini."
                    : "Belum ada hari yang dipilih."}
                </p>
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto nice-scrollbar">
                {dayApps.map((app) => (
                  <div
                    key={app.id}
                    className="flex items-center gap-3 border-b py-3 last:border-b-0"
                  >
                    <span className="w-12 shrink-0 text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">
                      {formatTime(app.interviewAt)}
                    </span>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                      {initialsOf(app.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{app.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {app.positionTitle ?? "-"}
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
      </div>

      {apps.length === 0 && !loading ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada jadwal wawancara sama sekali. Atur jadwal dari dialog
              detail pelamar.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={updateAppInList}
        onDeleted={(id) => setApps((prev) => prev.filter((a) => a.id !== id))}
      />
    </div>
  );
}
