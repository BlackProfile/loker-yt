"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Calendar } from "lucide-react";
import { useLang } from "@/components/landing/lang-context";
import { parseDeadlineDate } from "@/components/landing/landing-utils";

const emptySubscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

type Remaining = { days: number; hours: number; minutes: number; seconds: number };

function diffParts(targetMs: number, nowMs: number): Remaining {
  const total = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function DeadlineCountdown({ deadline }: { deadline: string }) {
  const { t } = useLang();
  const mounted = useMounted();
  const target = useMemo(() => parseDeadlineDate(deadline), [deadline]);
  const targetMs = target?.getTime() ?? 0;
  const [now, setNow] = useState(() => Date.now());

  const isFuture = target !== null && targetMs > Date.now();

  // Tick tiap detik hanya bila deadline valid & di masa depan; bersih saat unmount.
  useEffect(() => {
    if (!isFuture) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isFuture, targetMs]);

  // Belum mount (hindari mismatch hidrasi), gagal parse, atau sudah lewat:
  // tampilkan baris teks deadline.
  if (!mounted || !target || targetMs <= now) {
    return (
      <p className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
        <Calendar className="h-4 w-4 text-rose-400" aria-hidden="true" />
        {t.hero.deadlinePrefix} {deadline}
      </p>
    );
  }

  const parts = diffParts(targetMs, now);
  const boxes = [
    { value: pad(parts.days), label: t.hero.countdown.days },
    { value: pad(parts.hours), label: t.hero.countdown.hours },
    { value: pad(parts.minutes), label: t.hero.countdown.minutes },
    { value: pad(parts.seconds), label: t.hero.countdown.seconds },
  ];

  return (
    <div className="mt-6">
      <p className="flex items-center gap-2 text-sm text-zinc-400">
        <Calendar className="h-4 w-4 text-rose-400" aria-hidden="true" />
        {t.hero.deadlinePrefix} {deadline}
      </p>
      <div
        role="timer"
        aria-label={t.hero.countdown.aria}
        className="mt-3 flex flex-wrap gap-2 sm:gap-3"
      >
        {boxes.map((box) => (
          <div
            key={box.label}
            className="min-w-16 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center backdrop-blur-sm sm:min-w-20 sm:px-4"
          >
            <p className="text-2xl font-bold tabular-nums text-zinc-50 sm:text-3xl">
              {box.value}
            </p>
            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-widest text-zinc-400 sm:text-xs">
              {box.label}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
