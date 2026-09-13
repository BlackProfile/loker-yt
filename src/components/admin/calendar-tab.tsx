"use client";

// Kalender tim mingguan — 7 kolom (Sen-Min) berisi sesi wawancara setiap hari:
// jam, nama kandidat, posisi, ikon platform, dan badge status.
// Fitur: navigasi minggu (+ Hari Ini), filter pewawancara, dan penanda KONFLIK
// (dua sesi dengan pewawancara sama yang rentang waktunya beriraman).
// Sumber data: GET /api/admin/interviews (read-only; pengelolaan di tab Wawancara).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  format,
  isToday,
  startOfWeek,
} from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Inbox,
  MapPin,
  Users,
  Video,
} from "lucide-react";
import type { Interview } from "@/lib/types";
import { INTERVIEW_PLATFORM_LABELS } from "@/lib/types";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { formatTime } from "./format";
import { cn } from "@/lib/utils";
import { InterviewStatusChip } from "./interview-session-dialog";

const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

// Status yang masih dihitung untuk deteksi bentrok (sesi batal tidak dihitung).
const CONFLICT_STATUSES = ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED", "COMPLETED"];

function dayKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** True bila rentang [startA, startA+durA) dan [startB, startB+durB) beriraman. */
function rangesOverlap(a: Interview, b: Interview): boolean {
  const startA = new Date(a.scheduledAt).getTime();
  const startB = new Date(b.scheduledAt).getTime();
  const endA = startA + (a.durationMin || 45) * 60_000;
  const endB = startB + (b.durationMin || 45) * 60_000;
  return startA < endB && startB < endA;
}

/** True bila dua sesi punya minimal satu pewawancara yang sama. */
function sharesInterviewer(a: Interview, b: Interview): boolean {
  return a.interviewers.some((n) => b.interviewers.includes(n));
}

export function CalendarTab() {
  const { reportError } = useAdminSession();
  // Otomatis membuka minggu yang memuat hari ini.
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [interviewerFilter, setInterviewerFilter] = useState("ALL");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await apiGet<Interview[]>("/api/admin/interviews");
        setInterviews(data);
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

  // Realtime: sesi berubah di tab lain / dialog detail pelamar -> refresh senyap.
  useLiveRefresh("interviews:changed", () => {
    void load(true);
  });
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });

  // Daftar pewawancara unik dari data (untuk Select filter).
  const interviewers = useMemo(() => {
    const set = new Set<string>();
    for (const i of interviews) {
      for (const n of i.interviewers) {
        if (n.trim()) set.add(n.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
  }, [interviews]);

  const filtered = useMemo(
    () =>
      interviewerFilter === "ALL"
        ? interviews
        : interviews.filter((i) => i.interviewers.includes(interviewerFilter)),
    [interviews, interviewerFilter]
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Sesi per hari (terurut jam) + penanda bentrok per sesi.
  const sessionsByDay = useMemo(() => {
    const map = new Map<string, Interview[]>();
    for (const day of days) map.set(dayKey(day), []);
    for (const i of filtered) {
      const d = new Date(i.scheduledAt);
      if (Number.isNaN(d.getTime())) continue;
      const list = map.get(dayKey(d));
      if (list) list.push(i);
    }
    const result = new Map<string, { interview: Interview; conflict: boolean }[]>();
    for (const [key, list] of map) {
      list.sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      );
      const active = list.filter((i) => CONFLICT_STATUSES.includes(i.status));
      result.set(
        key,
        list.map((i) => ({
          interview: i,
          conflict: CONFLICT_STATUSES.includes(i.status)
            ? active.some(
                (other) =>
                  other.id !== i.id && sharesInterviewer(i, other) && rangesOverlap(i, other)
              )
            : false,
        }))
      );
    }
    return result;
  }, [days, filtered]);

  const weekEnd = addDays(weekStart, 6);
  const weekSessionCount = sessionsByDay.size
    ? Array.from(sessionsByDay.values()).reduce((sum, list) => sum + list.length, 0)
    : 0;
  const conflictCount = Array.from(sessionsByDay.values()).reduce(
    (sum, list) => sum + list.filter((s) => s.conflict).length,
    0
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 rounded-2xl py-6">
        <CardHeader className="px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                <span className="capitalize">
                  {format(weekStart, "d MMM", { locale: localeId })} –{" "}
                  {format(weekEnd, "d MMM yyyy", { locale: localeId })}
                </span>
              </CardTitle>
              <CardDescription className="mt-1">
                {loading
                  ? "Memuat sesi..."
                  : `${weekSessionCount} sesi minggu ini${conflictCount > 0 ? ` · ${conflictCount} sesi bentrok` : ""}`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={interviewerFilter}
                onValueChange={setInterviewerFilter}
              >
                <SelectTrigger
                  className="h-11 w-full min-w-44 sm:h-9 sm:w-52"
                  aria-label="Filter pewawancara"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Semua pewawancara</SelectItem>
                  {interviewers.map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11 sm:size-9"
                  onClick={() => setWeekStart((prev) => addDays(prev, -7))}
                  aria-label="Minggu sebelumnya"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 sm:h-9"
                  onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                >
                  <CalendarDays className="size-4" aria-hidden="true" />
                  Hari Ini
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11 sm:size-9"
                  onClick={() => setWeekStart((prev) => addDays(prev, 7))}
                  aria-label="Minggu berikutnya"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6">
          {/* Scroll horizontal di layar kecil agar 7 kolom tetap terbaca. */}
          <div className="-mx-1 overflow-x-auto pb-1 nice-scrollbar">
            <div className="grid min-w-[770px] grid-cols-7 gap-1.5">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="pb-1 text-center text-[11px] font-semibold text-muted-foreground"
                  aria-hidden="true"
                >
                  {label}
                </div>
              ))}
              {days.map((day) => {
                const sessions = sessionsByDay.get(dayKey(day)) ?? [];
                const today = isToday(day);
                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      "flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5",
                      today ? "border-primary/60 bg-rose-50/50 dark:bg-rose-950/10" : "bg-muted/20"
                    )}
                  >
                    <p
                      className={cn(
                        "text-center text-xs font-semibold",
                        !today && "text-muted-foreground"
                      )}
                    >
                      {format(day, "d", { locale: localeId })}
                      {today ? (
                        <span className="ml-1 rounded-full bg-rose-600 px-1.5 py-0.5 text-[9px] font-medium text-white">
                          Hari ini
                        </span>
                      ) : null}
                    </p>
                    {loading && interviews.length === 0 ? (
                      <div className="flex flex-col gap-1.5">
                        <Skeleton className="h-12 w-full rounded-md" />
                        <Skeleton className="h-12 w-full rounded-md" />
                      </div>
                    ) : sessions.length === 0 ? (
                      <p className="py-3 text-center text-[11px] text-muted-foreground/60">—</p>
                    ) : (
                      <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto nice-scrollbar">
                        {sessions.map(({ interview: i, conflict }) => {
                          const isOnline = i.mode === "ONLINE";
                          return (
                            <div
                              key={i.id}
                              className={cn(
                                "rounded-md border bg-background p-1.5",
                                conflict
                                  ? "border-rose-600 ring-1 ring-rose-600/40"
                                  : "border-border"
                              )}
                              title={
                                conflict
                                  ? "Bentrok: pewawancara sama memiliki sesi lain pada jam yang beriraman"
                                  : undefined
                              }
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span className="text-[11px] font-bold tabular-nums text-rose-600 dark:text-rose-400">
                                  {formatTime(i.scheduledAt)}
                                </span>
                                {conflict ? (
                                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-rose-100 px-1 py-0.5 text-[9px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                                    <AlertTriangle className="size-2.5" aria-hidden="true" />
                                    Bentrok
                                  </span>
                                ) : null}
                              </div>
                              <p className="truncate text-[11px] font-semibold" title={i.applicationName ?? "-"}>
                                {i.applicationName ?? "-"}
                              </p>
                              <p
                                className="truncate text-[10px] text-muted-foreground"
                                title={`${i.positionTitle ?? "-"} · ${INTERVIEW_PLATFORM_LABELS[i.platform]}`}
                              >
                                {i.positionTitle ?? "-"}
                              </p>
                              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                                {isOnline ? (
                                  <Video className="size-3 shrink-0" aria-hidden="true" />
                                ) : (
                                  <MapPin className="size-3 shrink-0" aria-hidden="true" />
                                )}
                                <span className="truncate">
                                  {INTERVIEW_PLATFORM_LABELS[i.platform]}
                                </span>
                              </p>
                              {i.interviewers.length > 0 ? (
                                <p
                                  className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground"
                                  title={i.interviewers.join(", ")}
                                >
                                  <Users className="size-3 shrink-0" aria-hidden="true" />
                                  <span className="truncate">{i.interviewers.join(", ")}</span>
                                </p>
                              ) : null}
                              <InterviewStatusChip status={i.status} className="mt-1 text-[9px]" />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-rose-500" aria-hidden="true" />
              Hari ini
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="size-3 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Border merah = bentrok jadwal pewawancara
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              Data hanya-baca — kelola sesi di tab Wawancara
            </span>
          </div>
        </CardContent>
      </Card>

      {!loading && filtered.length === 0 && interviews.length > 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Tidak ada sesi untuk filter pewawancara &ldquo;{interviewerFilter}&rdquo;.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!loading && interviews.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <CalendarDays className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada sesi wawancara pada kalender tim. Jadwalkan dari tab Wawancara atau
              dialog detail pelamar.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            >
              Kembali ke minggu ini
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
