"use client";

import { useMemo } from "react";
import {
  addDays,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import type { Interview } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

// Status yang dianggap aktif untuk titik hari & daftar nama (batal/selesai/no-show tidak).
const ACTIVE_STATUSES = ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"];

// Kalender bulan custom (date-fns) untuk sesi wawancara.
// Titik hari muncul bila ada sesi AKTIF pada hari tersebut.
export function InterviewCalendar({
  month,
  onMonthChange,
  interviews,
  selectedDay,
  onSelectDay,
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  interviews: Interview[];
  selectedDay: Date | null;
  onSelectDay: (day: Date) => void;
}) {
  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);

  function sessionsOn(day: Date): Interview[] {
    return interviews.filter((i) => {
      const d = new Date(i.scheduledAt);
      return !Number.isNaN(d.getTime()) && isSameDay(d, day);
    });
  }

  function activeOn(day: Date): Interview[] {
    return sessionsOn(day).filter((i) => ACTIVE_STATUSES.includes(i.status));
  }

  const today = new Date();

  return (
    <div>
      {/* Header bulan */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold capitalize sm:text-base">
          {format(month, "MMMM yyyy", { locale: localeId })}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-11 sm:size-9"
            onClick={() =>
              onMonthChange(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
            aria-label="Bulan sebelumnya"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 sm:h-9"
            onClick={() => {
              const now = new Date();
              onMonthChange(new Date(now.getFullYear(), now.getMonth(), 1));
              onSelectDay(now);
            }}
          >
            <CalendarDays className="size-4" aria-hidden="true" />
            Hari Ini
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-11 sm:size-9"
            onClick={() =>
              onMonthChange(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
            aria-label="Bulan berikutnya"
          >
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Grid hari */}
      <div className="grid grid-cols-7 gap-1">
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
          const inMonth = isSameMonth(day, month);
          const isToday = isSameDay(day, today);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const daySessions = activeOn(day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(day)}
              aria-label={`Jadwal tanggal ${format(day, "d MMMM yyyy", { locale: localeId })}, ${daySessions.length} wawancara aktif`}
              aria-pressed={isSelected}
              className={cn(
                "flex min-h-16 flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring/50 hover:bg-accent active:scale-[0.97]",
                !inMonth && "text-muted-foreground/40",
                isSelected && "ring-2 ring-primary",
                !isSelected && isToday && "ring-1 ring-primary/60"
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className="text-xs font-medium">{format(day, "d")}</span>
                {daySessions.length > 0 ? (
                  <span
                    className="size-1.5 rounded-full bg-rose-500"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              {daySessions.slice(0, 2).map((i) => (
                <span
                  key={i.id}
                  className="w-full truncate rounded bg-rose-100 px-1 text-[10px] leading-tight text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                >
                  {i.applicationName ?? "Wawancara"}
                </span>
              ))}
              {daySessions.length > 2 ? (
                <span className="text-[10px] text-muted-foreground">
                  +{daySessions.length - 2} lainnya
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
