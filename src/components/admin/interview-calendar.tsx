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
import type { Application } from "@/lib/types";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

// Kalender bulan custom (date-fns) untuk jadwal wawancara.
export function InterviewCalendar({
  month,
  onMonthChange,
  apps,
  selectedDay,
  onSelectDay,
}: {
  month: Date;
  onMonthChange: (next: Date) => void;
  apps: Application[];
  selectedDay: Date | null;
  onSelectDay: (day: Date) => void;
}) {
  const days = useMemo(() => {
    const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);

  function appsOn(day: Date): Application[] {
    return apps.filter((app) => {
      if (!app.interviewAt) return false;
      const d = new Date(app.interviewAt);
      return !Number.isNaN(d.getTime()) && isSameDay(d, day);
    });
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
            className="size-9"
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
            className="h-9"
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
            className="size-9"
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
          const dayApps = appsOn(day);
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDay(day)}
              aria-label={`Jadwal tanggal ${format(day, "d MMMM yyyy", { locale: localeId })}, ${dayApps.length} wawancara`}
              aria-pressed={isSelected}
              className={cn(
                "flex min-h-16 flex-col items-start gap-1 rounded-lg border p-1.5 text-left transition outline-none focus-visible:ring-2 focus-visible:ring-ring/50 hover:bg-accent",
                !inMonth && "text-muted-foreground/40",
                isSelected && "ring-2 ring-primary",
                !isSelected && isToday && "ring-1 ring-primary/60"
              )}
            >
              <span className="flex w-full items-center justify-between">
                <span className="text-xs font-medium">{format(day, "d")}</span>
                {dayApps.length > 0 ? (
                  <span
                    className="size-1.5 rounded-full bg-rose-500"
                    aria-hidden="true"
                  />
                ) : null}
              </span>
              {dayApps.slice(0, 2).map((app) => (
                <span
                  key={app.id}
                  className="w-full truncate rounded bg-rose-100 px-1 text-[10px] leading-tight text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                >
                  {app.name}
                </span>
              ))}
              {dayApps.length > 2 ? (
                <span className="text-[10px] text-muted-foreground">
                  +{dayApps.length - 2} lainnya
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
