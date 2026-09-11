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
import {
  CalendarClock,
  CalendarCheck,
  CalendarX2,
  Inbox,
  MapPin,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { Interview, Position } from "@/lib/types";
import { apiGet, apiPatch } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { formatDateTime, formatTime } from "./format";
import { InterviewCalendar } from "./interview-calendar";
import { InterviewSessionDialog, InterviewStatusChip } from "./interview-session-dialog";

// Tab Wawancara: kalender bulanan sesi + banner permintaan ubah jadwal +
// panel daftar sesi tanggal terpilih. Sumber data: GET /api/admin/interviews.
export function InterviewTab() {
  const { canMutate, reportError } = useAdminSession();
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Interview | null>(null);

  // silent: refresh senyap (dipakai event realtime) — sesi lama tetap tampil
  // sampai data baru siap, tanpa skeleton ulang.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<Interview[]>("/api/admin/interviews");
      setInterviews(data);
    } catch (err) {
      reportError(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Daftar posisi untuk kriteria scorecard & template undangan per sesi.
  useEffect(() => {
    let cancelled = false;
    apiGet<Position[]>("/api/admin/positions")
      .then((rows) => {
        if (!cancelled) setPositions(rows);
      })
      .catch(() => {
        // Pelengkap; dialog tetap jalan dengan kriteria bawaan.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime: sesi bisa berubah dari dialog detail pelamar / tab lain.
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });
  useLiveRefresh("interviews:changed", () => {
    void load(true);
  });

  const monthInterviews = interviews.filter((i) => {
    const d = new Date(i.scheduledAt);
    return !Number.isNaN(d.getTime()) && isSameMonth(d, month);
  });

  const dayInterviews = selectedDay
    ? interviews
        .filter((i) => {
          const d = new Date(i.scheduledAt);
          return !Number.isNaN(d.getTime()) && isSameDay(d, selectedDay);
        })
        .sort(
          (a, b) =>
            new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
        )
    : [];

  const rescheduleRequests = interviews.filter(
    (i) => i.status === "RESCHEDULE_REQUESTED"
  );

  function positionFor(i: Interview | null): Position | null {
    if (!i) return null;
    const title = i.positionTitle;
    if (!title) return null;
    return positions.find((p) => p.title === title) ?? null;
  }

  function updateInterviewInList(updated: Interview) {
    setInterviews((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    setDetail((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  function removeInterviewFromList(id: string) {
    setInterviews((prev) => prev.filter((i) => i.id !== id));
    setDetail((prev) => (prev && prev.id === id ? null : prev));
  }

  async function handleReschedulePatch(
    session: Interview,
    body: Record<string, unknown>,
    successMessage: string
  ) {
    if (!canMutate) {
      toast.error("Anda tidak memiliki akses untuk aksi ini.");
      return;
    }
    try {
      const res = await apiPatch<{ interview: Interview }>(
        `/api/admin/interviews/${session.id}`,
        body
      );
      toast.success(successMessage);
      updateInterviewInList(res.interview);
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="rounded-2xl p-4 sm:p-6">
          <InterviewCalendar
            month={month}
            onMonthChange={setMonth}
            interviews={interviews}
            selectedDay={selectedDay}
            onSelectDay={setSelectedDay}
          />
          <div className="mt-3 flex items-center gap-4 border-t pt-3">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-rose-500" aria-hidden="true" />
              Ada sesi aktif
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full ring-1 ring-primary" aria-hidden="true" />
              Hari ini
            </span>
            <span className="ml-auto text-xs text-muted-foreground">
              {loading
                ? "Memuat..."
                : `${monthInterviews.length} sesi bulan ${format(month, "MMMM", { locale: localeId })}`}
            </span>
          </div>
        </Card>

        {/* Panel kanan: banner permintaan ubah jadwal + daftar sesi hari terpilih */}
        <div className="flex min-w-0 flex-col gap-4">
          {rescheduleRequests.length > 0 ? (
            <Card className="gap-0 rounded-2xl border-orange-200 bg-orange-50/60 py-6 dark:border-orange-900 dark:bg-orange-950/20">
              <CardHeader className="px-6">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarClock className="size-4 text-orange-600 dark:text-orange-400" aria-hidden="true" />
                  Permintaan Ubah Jadwal
                </CardTitle>
                <CardDescription className="mt-1">
                  {rescheduleRequests.length} usulan dari pelamar menunggu keputusan.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-6">
                <div className="flex max-h-72 flex-col gap-3 overflow-y-auto nice-scrollbar">
                  {rescheduleRequests.map((i) => (
                    <div
                      key={i.id}
                      className="flex flex-col gap-2 rounded-lg border bg-background p-3"
                    >
                      <p className="text-sm font-semibold">{i.applicationName ?? "-"}</p>
                      <p className="text-xs text-muted-foreground">
                        Jadwal sekarang: {formatDateTime(i.scheduledAt)}
                        {i.rescheduleProposedAt
                          ? ` · Usulan: ${formatDateTime(i.rescheduleProposedAt)}`
                          : ""}
                      </p>
                      {i.rescheduleReason ? (
                        <p className="text-xs text-muted-foreground italic">
                          &ldquo;{i.rescheduleReason}&rdquo;
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="h-11 active:scale-[0.99] sm:h-9"
                          disabled={!i.rescheduleProposedAt}
                          onClick={() =>
                            void handleReschedulePatch(
                              i,
                              { scheduledAt: i.rescheduleProposedAt },
                              "Jadwal diubah sesuai usulan pelamar"
                            )
                          }
                          aria-label={`Setujui usulan ubah jadwal ${i.applicationName ?? ""}`}
                        >
                          <CalendarCheck className="size-4" aria-hidden="true" />
                          Setujui (usulan pelamar)
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 sm:h-9"
                          onClick={() =>
                            void handleReschedulePatch(
                              i,
                              { dismissReschedule: true },
                              "Usulan ubah jadwal ditolak"
                            )
                          }
                          aria-label={`Tolak usulan ubah jadwal ${i.applicationName ?? ""}`}
                        >
                          <CalendarX2 className="size-4" aria-hidden="true" />
                          Tolak Usulan
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="gap-0 rounded-2xl py-6">
            <CardHeader className="px-6">
              <CardTitle className="text-base">
                {selectedDay
                  ? format(selectedDay, "d MMMM yyyy", { locale: localeId })
                  : "Pilih Tanggal"}
              </CardTitle>
              <CardDescription className="mt-1">
                {selectedDay
                  ? `${dayInterviews.length} sesi pada tanggal ini.`
                  : "Klik satu hari pada kalender untuk melihat sesinya."}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6">
              {/* Skeleton hanya saat pemuatan pertama; refresh senyap tidak mengganti
                  panel dengan skeleton. */}
              {loading && interviews.length === 0 ? (
                <div className="flex flex-col gap-3">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : dayInterviews.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <CalendarClock className="size-8 text-muted-foreground/50" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    {selectedDay
                      ? "Belum ada sesi pada tanggal ini."
                      : "Belum ada hari yang dipilih."}
                  </p>
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto nice-scrollbar">
                  {dayInterviews.map((i) => (
                    <div
                      key={i.id}
                      className="flex items-start gap-3 border-b py-3 last:border-b-0"
                    >
                      <span className="w-12 shrink-0 text-xs font-bold tabular-nums text-rose-600 dark:text-rose-400">
                        {formatTime(i.scheduledAt)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">{i.applicationName ?? "-"}</span>
                          <RoundBadge round={i.round} />
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          {i.mode === "ONLINE" ? (
                            <Video className="size-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="truncate">
                            {i.positionTitle ?? "-"} · {INTERVIEW_PLATFORM_SHORT[i.platform]}
                          </span>
                        </p>
                        <InterviewStatusChip status={i.status} className="mt-1.5" />
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 sm:h-8"
                          onClick={() => setDetail(i)}
                        >
                          Detail
                        </Button>
                        {i.mode === "ONLINE" && i.meetingLink ? (
                          <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
                            <a
                              href={i.meetingLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Gabung meeting ${i.applicationName ?? ""}`}
                            >
                              <Video className="size-4" aria-hidden="true" />
                              Gabung
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {interviews.length === 0 && !loading ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada sesi wawancara sama sekali. Jadwalkan dari panel Pelamar
              lewat dialog detail.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <InterviewSessionDialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        interview={detail}
        create={null}
        position={positionFor(detail)}
        onSaved={updateInterviewInList}
        onDeleted={removeInterviewFromList}
      />
    </div>
  );
}

// Label platform singkat untuk baris daftar (tanpa import besar).
const INTERVIEW_PLATFORM_SHORT: Record<Interview["platform"], string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "MS Teams",
  WHATSAPP: "WhatsApp Call",
  TELEPON: "Telepon",
  LAINNYA: "Lainnya",
};

// Badge ronde kecil (R1, R2, ...) inline.
function RoundBadge({ round }: { round: number }) {
  return (
    <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
      R{round}
    </span>
  );
}
