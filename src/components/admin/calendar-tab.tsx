"use client";

// Kalender tim mingguan — 7 kolom (Sen-Min) berisi sesi wawancara setiap hari:
// jam, nama kandidat, posisi, ikon platform, dan badge status.
// Fitur: navigasi minggu (+ Hari Ini), filter pewawancara, penanda KONFLIK
// (dua sesi dengan pewawancara sama yang rentang waktunya beriraman), dan
// I20 — drag-reschedule: seret chip sesi ke sel hari lain untuk membuka dialog
// perubahan jadwal (endpoint PATCH /api/admin/interviews/[id] yang sama dengan
// dialog pengelolaan sesi) + alternatif keyboard (spasi/panah) dan menu chip.
// Sumber data: GET /api/admin/interviews; pengelolaan penuh di tab Wawancara.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  addDays,
  format,
  isToday,
  startOfWeek,
} from "date-fns";
import { id as localeId } from "date-fns/locale";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type ScreenReaderInstructions,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  GripVertical,
  Inbox,
  Loader2,
  MapPin,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import type { Interview } from "@/lib/types";
import { INTERVIEW_PLATFORM_LABELS } from "@/lib/types";
import { apiGet, apiPatch } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { formatDateTime, formatTime, isoToLocalInput, localInputToIso } from "./format";
import { cn } from "@/lib/utils";
import { InterviewStatusChip } from "./interview-session-dialog";

const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/* ------------------- I20 — drag-reschedule & aksesibilitas ------------------- */

const DAY_DROPPABLE_PREFIX = "day-";

// Status sesi yang masih boleh dijadwalkan ulang. Sesi COMPLETED/CANCELLED/
// NO_SHOW adalah catatan historis — memindahkannya akan menghidupkan ulang
// status (PATCH scheduledAt mengembalikan status ke SCHEDULED).
const RESCHEDULABLE_STATUSES = ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"];

function reschedulable(interview: Interview): boolean {
  return RESCHEDULABLE_STATUSES.includes(interview.status);
}

// Redam pengumuman bawaan dnd-kit (teks Inggris) — pengumuman berbahasa
// Indonesia disalurkan lewat region aria-live milik komponen ini sendiri
// agar pembaca layar tidak mendengar pengumuman ganda.
const MUTED_ANNOUNCEMENTS: Announcements = {
  onDragStart: () => "",
  onDragMove: () => "",
  onDragOver: () => "",
  onDragEnd: () => "",
  onDragCancel: () => "",
};

// Instruksi kalender untuk pengguna keyboard (mengganti teks bawaan dnd-kit).
const CALENDAR_SR_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable:
    "Untuk mengangkat sesi, tekan spasi. Saat terangkat, gunakan tombol panah untuk memilih hari tujuan, tekan spasi lagi untuk melepas, atau tekan Escape untuk membatalkan.",
};

/**
 * Getter koordinat keyboard kalender: satu tekan panah berpindah satu sel hari.
 * Kandidat = sel hari pada arah panah; dipilih yang terdekat dari pusat elemen
 * terseret dengan penalti pada sumbu silang agar panah kanan/kiri berpindah
 * kolom pada baris minggu yang sama (bukan sel miring terjauh).
 */
const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const code = event.code;
  const isVertical = code === "ArrowDown" || code === "ArrowUp";
  const isHorizontal = code === "ArrowLeft" || code === "ArrowRight";
  if (!isVertical && !isHorizontal) return;

  event.preventDefault();
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect) return;

  const centerX = collisionRect.left + collisionRect.width / 2;
  const centerY = collisionRect.top + collisionRect.height / 2;
  let found = false;
  let bestScore = Infinity;
  let bestLeft = 0;
  let bestTop = 0;

  for (const entry of droppableContainers.getEnabled()) {
    const rect = droppableRects.get(entry.id);
    if (!rect) continue;
    if (code === "ArrowDown" && rect.top <= collisionRect.top) continue;
    if (code === "ArrowUp" && rect.top >= collisionRect.top) continue;
    if (code === "ArrowRight" && rect.left <= collisionRect.left) continue;
    if (code === "ArrowLeft" && rect.left >= collisionRect.left) continue;
    const dx = Math.abs(rect.left + rect.width / 2 - centerX);
    const dy = Math.abs(rect.top + rect.height / 2 - centerY);
    const score = isVertical ? dx * 1000 + dy : dy * 1000 + dx;
    if (!found || score < bestScore) {
      found = true;
      bestScore = score;
      bestLeft = rect.left;
      bestTop = rect.top;
    }
  }

  if (!found) return;
  return { x: bestLeft, y: bestTop };
};

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

/* ------------------- I20 — sel hari (droppable) & chip sesi (draggable) ------------------- */

/** Sel satu hari pada grid mingguan — target drop untuk drag-reschedule. */
function CalendarDayCell({
  day,
  today,
  children,
}: {
  day: Date;
  today: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${DAY_DROPPABLE_PREFIX}${dayKey(day)}`,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5",
        // Indikator drop target jelas: ring zinc + latar solid saat chip di atasnya.
        isOver
          ? "border-zinc-900 bg-background ring-2 ring-zinc-400 dark:border-zinc-100 dark:ring-zinc-500"
          : today
            ? "border-primary/60 bg-rose-50/50 dark:bg-rose-950/10"
            : "bg-muted/20"
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
      {children}
    </div>
  );
}

/** Chip sesi wawancara pada kalender — draggable + menu pindah jadwal (I20). */
function CalendarSessionChip({
  interview: i,
  conflict,
  movable,
  onOpenMoveDialog,
}: {
  interview: Interview;
  conflict: boolean;
  movable: boolean;
  onOpenMoveDialog: (interview: Interview) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: i.id,
    disabled: !movable,
  });
  const isOnline = i.mode === "ONLINE";

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        // Sensor keyboard dnd-kit (spasi mengangkat chip) dipanggil manual agar
        // tidak aktif saat fokus berada pada tombol menu di dalam chip.
        if (
          e.target === e.currentTarget &&
          listeners &&
          typeof listeners.onKeyDown === "function"
        ) {
          listeners.onKeyDown(e);
        }
      }}
      onContextMenu={(e) => {
        // Klik kanan pada chip sebagai akses alternatif yang aksesibel.
        if (!movable) return;
        e.preventDefault();
        onOpenMoveDialog(i);
      }}
      title={
        movable
          ? "Seret ke hari lain, klik kanan, atau buka menu untuk menjadwalkan ulang"
          : undefined
      }
      className={cn(
        "relative rounded-md border bg-background p-1.5",
        conflict ? "border-rose-600 ring-1 ring-rose-600/40" : "border-border",
        movable && "cursor-grab touch-none",
        isDragging && "z-10 opacity-50 shadow-md"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="text-[11px] font-bold tabular-nums text-rose-600 dark:text-rose-400">
          {formatTime(i.scheduledAt)}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {conflict ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-100 px-1 py-0.5 text-[9px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
              <AlertTriangle className="size-2.5" aria-hidden="true" />
              Bentrok
            </span>
          ) : null}
          {movable ? (
            <span
              className="flex"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* I20 — alternatif aksesibel drag: menu kecil pindah jadwal. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Pindahkan jadwal ${i.applicationName ?? "-"}`}
                    title="Pindahkan jadwal"
                    className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground/50 outline-none transition-colors hover:bg-zinc-100 hover:text-zinc-700 focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  >
                    <GripVertical className="size-3" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => onOpenMoveDialog(i)}>
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                    Pindahkan jadwal
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          ) : null}
        </span>
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
}

export function CalendarTab() {
  const { reportError, canMutate } = useAdminSession();
  // Otomatis membuka minggu yang memuat hari ini.
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);
  const [interviewerFilter, setInterviewerFilter] = useState("ALL");

  // I20 — sensor seret: pointer (perilaku lama tetap) + keyboard.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinates })
  );

  // I20 — pengumuman pembaca layar via region aria-live (teks Indonesia).
  const [announcement, setAnnouncement] = useState("");
  const announceCount = useRef(0);
  const lastOverIdRef = useRef<string | null>(null);
  const announce = useCallback((message: string) => {
    announceCount.current += 1;
    // Sisipkan karakter nol-lebar bergantian agar pesan yang sama persis
    // tetap dibacakan ulang oleh pembaca layar.
    const suffix = announceCount.current % 2 === 0 ? "\u200B" : "";
    setAnnouncement(`${message}${suffix}`);
  }, []);

  // I20 — dialog perubahan jadwal (hasil drop / menu chip / klik kanan).
  const [reschedule, setReschedule] = useState<{
    interview: Interview;
    defaultLocal: string;
  } | null>(null);
  const [rescheduleLocal, setRescheduleLocal] = useState("");
  const [savingReschedule, setSavingReschedule] = useState(false);

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

  // I20 — label hari (untuk pengumuman pembaca layar), kunci kunci = dayKey.
  const dayLabelByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const day of days) {
      map.set(dayKey(day), format(day, "EEEE, d MMM", { locale: localeId }));
    }
    return map;
  }, [days]);

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

  /* ------------------- I20 — drag-reschedule & dialog jadwal ------------------- */

  /** Buka dialog pindah jadwal; candidateDay = tanggal hasil drop (opsional). */
  function openReschedule(interview: Interview, candidateDay?: Date) {
    if (!canMutate) {
      toast.error("Anda tidak memiliki akses untuk aksi ini.");
      return;
    }
    if (!reschedulable(interview)) {
      toast.info(
        "Sesi yang selesai, dibatalkan, atau tidak hadir tidak bisa dijadwalkan ulang."
      );
      return;
    }
    const old = new Date(interview.scheduledAt);
    const candidate = candidateDay ? new Date(candidateDay) : new Date(old);
    if (candidateDay) candidate.setHours(old.getHours(), old.getMinutes(), 0, 0);
    const defaultLocal = isoToLocalInput(candidate.toISOString());
    setReschedule({ interview, defaultLocal });
    setRescheduleLocal(defaultLocal);
  }

  async function handleRescheduleSubmit() {
    if (!reschedule || savingReschedule) return;
    const iso = localInputToIso(rescheduleLocal);
    if (!iso) {
      toast.error("Tanggal dan jam tidak valid.");
      return;
    }
    if (iso === new Date(reschedule.interview.scheduledAt).toISOString()) {
      toast.info("Tanggal dan jam sama dengan jadwal sebelumnya.");
      return;
    }
    setSavingReschedule(true);
    try {
      const res = await apiPatch<{ interview: Interview }>(
        `/api/admin/interviews/${reschedule.interview.id}`,
        { scheduledAt: iso }
      );
      toast.success(
        `Jadwal ${reschedule.interview.applicationName ?? "-"} dipindah ke ${formatDateTime(iso)}`
      );
      // Perbarui daftar lokal; PATCH juga memancarkan event realtime
      // "interviews:changed" yang memicu refresh senyap (pola useLiveRefresh).
      setInterviews((prev) =>
        prev.map((x) => (x.id === res.interview.id ? { ...x, ...res.interview } : x))
      );
      setReschedule(null);
    } catch (err) {
      reportError(err);
    } finally {
      setSavingReschedule(false);
    }
  }

  function handleDragStart(event: DragStartEvent) {
    lastOverIdRef.current = null;
    const i = interviews.find((x) => x.id === String(event.active.id));
    announce(i ? `Menyeret jadwal ${i.applicationName ?? "-"}` : "Menyeret jadwal");
  }

  function handleDragOver(event: DragOverEvent) {
    if (!event.over) return;
    const overId = String(event.over.id);
    if (overId === lastOverIdRef.current) return;
    lastOverIdRef.current = overId;
    const label = dayLabelByKey.get(overId.slice(DAY_DROPPABLE_PREFIX.length));
    if (label) announce(`Di atas hari ${label}`);
  }

  function handleDragEnd(event: DragEndEvent) {
    lastOverIdRef.current = null;
    const interview = interviews.find((x) => x.id === String(event.active.id));
    if (!interview) return;
    const name = interview.applicationName ?? "-";
    const overId = event.over ? String(event.over.id) : null;
    const targetDayKey =
      overId && overId.startsWith(DAY_DROPPABLE_PREFIX)
        ? overId.slice(DAY_DROPPABLE_PREFIX.length)
        : null;
    const label = targetDayKey ? dayLabelByKey.get(targetDayKey) : undefined;

    if (!targetDayKey || !label) {
      announce(`Jadwal ${name} tidak dilepas di atas sel hari`);
      return;
    }

    const sourceDayKey = dayKey(new Date(interview.scheduledAt));
    if (targetDayKey === sourceDayKey) {
      announce(`Jadwal ${name} tetap pada hari yang sama`);
      return;
    }

    // Hari tujuan berbeda -> buka dialog konfirmasi berprefill tanggal tujuan +
    // jam lama (durasi tetap). Penyimpanan lewat endpoint PATCH yang sama.
    const targetDay = days.find((d) => dayKey(d) === targetDayKey);
    if (!targetDay) return;
    openReschedule(interview, targetDay);
    announce(
      `Jadwal ${name} dilepas di hari ${label} — konfirmasi perubahan di dialog`
    );
  }

  function handleDragCancel(event: DragCancelEvent) {
    lastOverIdRef.current = null;
    const i = interviews.find((x) => x.id === String(event.active.id));
    announce(
      i ? `Pemindahan jadwal ${i.applicationName ?? "-"} dibatalkan` : "Pemindahan jadwal dibatalkan"
    );
  }

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
      {/* I20 — pengumuman pembaca layar untuk peristiwa seret & lepas (sr-only,
          dibacakan otomatis oleh pembaca layar karena aria-live="polite"). */}
      <div aria-live="polite" role="status" className="sr-only">
        {announcement}
      </div>

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
              {/* Unduh seluruh jadwal wawancara sebagai berkas kalender (.ics). */}
              <Button variant="outline" asChild>
                <a href="/api/admin/interviews/ics" download aria-label="Unduh jadwal wawancara (.ics)">
                  <Download className="size-4" aria-hidden="true" />
                  Unduh .ics
                </a>
              </Button>
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
          {/* I20 — area mingguan dibungkus DndContext: chip sesi dapat diseret
              antar sel hari (pointer maupun keyboard); lepas di hari lain
              membuka dialog perubahan jadwal. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            accessibility={{
              announcements: MUTED_ANNOUNCEMENTS,
              screenReaderInstructions: CALENDAR_SR_INSTRUCTIONS,
            }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
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
                    <CalendarDayCell key={day.toISOString()} day={day} today={today}>
                      {loading && interviews.length === 0 ? (
                        <div className="flex flex-col gap-1.5">
                          <Skeleton className="h-12 w-full rounded-md" />
                          <Skeleton className="h-12 w-full rounded-md" />
                        </div>
                      ) : sessions.length === 0 ? (
                        <p className="py-3 text-center text-[11px] text-muted-foreground/60">—</p>
                      ) : (
                        <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto nice-scrollbar">
                          {sessions.map(({ interview: i, conflict }) => (
                            <CalendarSessionChip
                              key={i.id}
                              interview={i}
                              conflict={conflict}
                              movable={canMutate && reschedulable(i)}
                              onOpenMoveDialog={openReschedule}
                            />
                          ))}
                        </div>
                      )}
                    </CalendarDayCell>
                  );
                })}
              </div>
            </div>
          </DndContext>
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
              {canMutate
                ? "Seret sesi ke hari lain untuk menjadwalkan ulang — kelola sesi di tab Wawancara"
                : "Data hanya-baca — kelola sesi di tab Wawancara"}
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

      {/* I20 — dialog perubahan jadwal: prefilled tanggal tujuan + jam lama,
          durasi tetap. Disimpan lewat PATCH /api/admin/interviews/[id] yang sama
          dengan dialog pengelolaan sesi. */}
      <Dialog
        open={reschedule !== null}
        onOpenChange={(open) => {
          if (!open) setReschedule(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="size-5 text-rose-600" aria-hidden="true" />
              Pindahkan Jadwal Wawancara
            </DialogTitle>
            <DialogDescription>
              {reschedule
                ? `${reschedule.interview.applicationName ?? "Pelamar"} · ${reschedule.interview.positionTitle ?? "-"} — jadwal lama ${formatDateTime(reschedule.interview.scheduledAt)}. Durasi tetap ${reschedule.interview.durationMin} menit.`
                : "Atur tanggal dan jam baru untuk sesi wawancara ini."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="calendar-reschedule-when">Tanggal &amp; jam baru</Label>
            <Input
              id="calendar-reschedule-when"
              type="datetime-local"
              value={rescheduleLocal}
              onChange={(e) => setRescheduleLocal(e.target.value)}
              className="h-10"
              required
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setReschedule(null)}
              disabled={savingReschedule}
              className="h-11 sm:h-10"
            >
              Batal
            </Button>
            <Button
              onClick={() => void handleRescheduleSubmit()}
              disabled={savingReschedule}
              className="h-11 active:scale-[0.99] sm:h-10"
            >
              {savingReschedule ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <CalendarClock className="size-4" aria-hidden="true" />
              )}
              Simpan Jadwal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
