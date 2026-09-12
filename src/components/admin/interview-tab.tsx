"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CalendarClock,
  CalendarCheck,
  CalendarPlus,
  CalendarX2,
  Inbox,
  MapPin,
  Trash2,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  INTERVIEW_PLATFORM_LABELS,
  INTERVIEW_PLATFORMS,
  type Interview,
  type InterviewMode,
  type InterviewPlatform,
  type InterviewSlot,
  type Position,
} from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { formatDateTime, formatTime, isoToLocalInput, localInputToIso } from "./format";
import { InterviewCalendar } from "./interview-calendar";
import { InterviewSessionDialog, InterviewStatusChip } from "./interview-session-dialog";
import { cn } from "@/lib/utils";

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

      <SlotManagerPanel positions={positions} />

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

/* --------------------- Slot wawancara self-service (admin) --------------------- */

// Panel kelola slot jadwal yang bisa dipilih sendiri oleh pelamar dari halaman status.
// GET/POST /api/admin/slots + DELETE /api/admin/slots/[id] (hanya slot yang belum dibooking).
function SlotManagerPanel({ positions }: { positions: Position[] }) {
  const { canMutate, reportError } = useAdminSession();
  const [slots, setSlots] = useState<InterviewSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // Form buka slot baru
  const [positionId, setPositionId] = useState("");
  const [scheduledAtLocal, setScheduledAtLocal] = useState("");
  const [durationMin, setDurationMin] = useState("45");
  const [mode, setMode] = useState<InterviewMode>("ONLINE");
  const [platform, setPlatform] = useState<InterviewPlatform>("GOOGLE_MEET");
  const [meetingLink, setMeetingLink] = useState("");
  const [address, setAddress] = useState("");
  const [interviewersText, setInterviewersText] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InterviewSlot | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await apiGet<InterviewSlot[]>("/api/admin/slots");
        setSlots(data);
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

  // Slot berubah dari tab lain / booking pelamar -> refresh senyap.
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });
  useLiveRefresh("interviews:changed", () => {
    void load(true);
  });

  const activePositions = positions.filter((p) => p.isActive);
  const openCount = slots.filter(
    (s) => !s.bookedByApplicationId && new Date(s.scheduledAt).getTime() > Date.now()
  ).length;

  async function handleCreateSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating || !canMutate) {
      if (!canMutate) toast.error("Anda tidak memiliki akses untuk aksi ini.");
      return;
    }
    const iso = localInputToIso(scheduledAtLocal);
    if (!iso) {
      toast.error("Pilih tanggal dan jam slot terlebih dahulu.");
      return;
    }
    const duration = Number(durationMin);
    if (!Number.isInteger(duration) || duration < 10 || duration > 480) {
      toast.error("Durasi harus angka bulat 10-480 menit.");
      return;
    }
    if (!positionId) {
      toast.error("Pilih posisi untuk slot ini.");
      return;
    }
    if (mode === "ONLINE" && !/^https?:\/\//i.test(meetingLink.trim())) {
      toast.error("Link meeting harus diawali http:// atau https://.");
      return;
    }
    if (mode === "ONSITE" && !address.trim()) {
      toast.error("Alamat wajib diisi untuk slot onsite.");
      return;
    }
    const interviewers = interviewersText
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
      .slice(0, 6);
    setCreating(true);
    try {
      await apiPost<InterviewSlot>("/api/admin/slots", {
        positionId,
        scheduledAt: iso,
        durationMin: duration,
        mode,
        platform,
        meetingLink: mode === "ONLINE" ? meetingLink.trim() : undefined,
        address: mode === "ONSITE" ? address.trim() : undefined,
        interviewers,
      });
      toast.success("Slot wawancara dibuka untuk pelamar");
      setScheduledAtLocal("");
      setMeetingLink("");
      setAddress("");
      setInterviewersText("");
      await load(true);
    } catch (err) {
      reportError(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteSlot() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/slots/${deleteTarget.id}`);
      toast.success("Slot dihapus");
      setSlots((prev) => prev.filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
    }
  }

  function slotBadge(slot: InterviewSlot) {
    if (slot.bookedByApplicationId) {
      return (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
          Dipilih{slot.bookedByName ? `: ${slot.bookedByName}` : ""}
        </span>
      );
    }
    if (new Date(slot.scheduledAt).getTime() <= Date.now()) {
      return (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Terlewat
        </span>
      );
    }
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
        Terbuka
      </span>
    );
  }

  return (
    <Card className="gap-0 rounded-2xl py-6">
      <CardHeader className="px-6">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex w-full flex-wrap items-center justify-between gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarPlus className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Slot Wawancara Self-Service
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                {openCount} terbuka
              </span>
            </CardTitle>
            <CardDescription className="mt-1">
              Buka jadwal agar pelamar memilih sendiri dari halaman status lamaran.
            </CardDescription>
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            {open ? "Tutup" : "Kelola slot"}
          </span>
        </button>
      </CardHeader>

      {open ? (
        <CardContent className="flex flex-col gap-4 px-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Daftar slot */}
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-sm font-semibold">Daftar Slot</p>
              {loading && slots.length === 0 ? (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : slots.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Belum ada slot. Buat slot pertama lewat formulir di samping.
                </p>
              ) : (
                <div className="flex max-h-96 flex-col gap-2 overflow-y-auto nice-scrollbar">
                  {slots.map((slot) => (
                    <div
                      key={slot.id}
                      className="flex items-start gap-3 rounded-lg border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">
                            {formatDateTime(slot.scheduledAt)}
                          </span>
                          {slotBadge(slot)}
                        </div>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="truncate">{slot.positionTitle ?? "Tanpa posisi"}</span>
                          <span aria-hidden="true">·</span>
                          <span>{slot.durationMin} menit</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            {slot.mode === "ONLINE" ? (
                              <Video className="size-3.5" aria-hidden="true" />
                            ) : (
                              <MapPin className="size-3.5" aria-hidden="true" />
                            )}
                            {INTERVIEW_PLATFORM_LABELS[slot.platform]}
                          </span>
                        </p>
                        {slot.interviewers.length > 0 ? (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            Pewawancara: {slot.interviewers.join(", ")}
                          </p>
                        ) : null}
                      </div>
                      {canMutate && !slot.bookedByApplicationId ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 dark:text-rose-400 dark:hover:bg-rose-950"
                          onClick={() => setDeleteTarget(slot)}
                          aria-label={`Hapus slot ${formatDateTime(slot.scheduledAt)}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Form buka slot baru */}
            <div className="flex min-w-0 flex-col gap-3">
              <p className="text-sm font-semibold">Buka Slot Baru</p>
              {canMutate ? (
                <form onSubmit={handleCreateSlot} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="slot-position">Posisi</Label>
                    <Select value={positionId || "none-pos"} onValueChange={(v) => setPositionId(v === "none-pos" ? "" : v)}>
                      <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Posisi slot">
                        <SelectValue placeholder="Pilih posisi" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none-pos">-</SelectItem>
                        {activePositions.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="slot-scheduledAt">Tanggal &amp; Jam</Label>
                      <Input
                        id="slot-scheduledAt"
                        type="datetime-local"
                        value={scheduledAtLocal}
                        onChange={(e) => setScheduledAtLocal(e.target.value)}
                        className="h-11 sm:h-10"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="slot-duration">Durasi (menit)</Label>
                      <Input
                        id="slot-duration"
                        type="number"
                        min={10}
                        max={480}
                        step={5}
                        value={durationMin}
                        onChange={(e) => setDurationMin(e.target.value)}
                        className="h-11 sm:h-10"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>Mode</Label>
                      <Select value={mode} onValueChange={(v) => setMode(v as InterviewMode)}>
                        <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Mode slot">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVIEW_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {INTERVIEW_MODE_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Platform</Label>
                      <Select value={platform} onValueChange={(v) => setPlatform(v as InterviewPlatform)}>
                        <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Platform slot">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVIEW_PLATFORMS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {INTERVIEW_PLATFORM_LABELS[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {mode === "ONLINE" ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="slot-link">Link Meeting</Label>
                      <Input
                        id="slot-link"
                        type="url"
                        value={meetingLink}
                        onChange={(e) => setMeetingLink(e.target.value)}
                        placeholder="https://meet.google.com/xxx-xxxx-xxx"
                        className="h-11 sm:h-10"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="slot-address">Alamat Lokasi</Label>
                      <Input
                        id="slot-address"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="mis. Jl. Sudirman No. 10, Jakarta"
                        className="h-11 sm:h-10"
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="slot-interviewers">Pewawancara (pisahkan koma)</Label>
                    <Input
                      id="slot-interviewers"
                      value={interviewersText}
                      onChange={(e) => setInterviewersText(e.target.value)}
                      placeholder="mis. Rani, Bagus"
                      maxLength={200}
                      className="h-11 sm:h-10"
                    />
                  </div>
                  <Button
                    type="submit"
                    className="h-11 w-fit active:scale-[0.99] sm:h-10"
                    disabled={creating}
                  >
                    <CalendarPlus className="size-4" aria-hidden="true" />
                    {creating ? "Membuka..." : "Buka Slot"}
                  </Button>
                </form>
              ) : (
                <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                  Role Pengamat hanya dapat melihat slot.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      ) : null}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus slot ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Slot {deleteTarget ? formatDateTime(deleteTarget.scheduledAt) : ""} akan dihapus
              permanen dan tidak lagi tampil di halaman status pelamar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteSlot();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleting}
            >
              {deleting ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
