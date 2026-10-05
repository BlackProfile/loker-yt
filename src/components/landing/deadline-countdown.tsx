"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Calendar, Clock } from "lucide-react";
import { useLang } from "@/components/landing/lang-context";
import {
  formatDateTimeId,
  parseDeadlineDate,
} from "@/components/landing/landing-utils";

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

/**
 * Tingkat urgensi deadline (varian detail): makin dekat tanggal tutup, makin
 * hangat warnanya (zinc -> amber -> rose). Ambang: >=7 hari netral, 3-6 hari
 * siaga, <3 hari urgen — selaras dengan badge "Segera Ditutup" (SOON_DAYS).
 */
function urgencyLevel(daysLeft: number): "normal" | "warn" | "urgent" {
  if (daysLeft < 3) return "urgent";
  if (daysLeft < 7) return "warn";
  return "normal";
}

// Kelas warna per tingkat urgensi — dipakai kotak angka & garis progres.
const URGENCY_BOX: Record<
  "normal" | "warn" | "urgent",
  { border: string; value: string; bar: string }
> = {
  normal: {
    border: "border-border bg-muted/60",
    value: "text-foreground",
    bar: "bg-zinc-400 dark:bg-zinc-600",
  },
  warn: {
    border: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40",
    value: "text-amber-700 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  urgent: {
    border: "border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40",
    value: "text-rose-700 dark:text-rose-400",
    bar: "bg-rose-600",
  },
};

// Variant "hero" = latar gelap permanen (hero landing); "detail" = mengikuti
// tema halaman detail posisi (terang/gelap) + warna urgensi bertingkat.
// `publishedAt` opsional — bila diberikan, digambar garis progres tipis
// "waktu tersisa" dari tanggal publikasi ke tanggal tutup.
export function DeadlineCountdown({
  deadline,
  variant = "hero",
  publishedAt,
}: {
  deadline: string;
  variant?: "hero" | "detail";
  publishedAt?: string;
}) {
  const { t } = useLang();
  const mounted = useMounted();
  const reduce = useReducedMotion();
  const target = useMemo(() => parseDeadlineDate(deadline), [deadline]);
  const targetMs = target?.getTime() ?? 0;
  const [now, setNow] = useState(() => Date.now());

  // Tampilkan tanggal yang sudah diformat (mis. "2 Okt 2026, 11.15") bila
  // string deadline bisa diparse; kalau tidak, tampilkan apa adanya.
  const deadlineDisplay = useMemo(
    () => (target ? formatDateTimeId(target.toISOString()) : deadline),
    [target, deadline],
  );
  const isDetail = variant === "detail";

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
      <p
        className={`mt-4 flex items-center gap-2 text-sm ${
          isDetail ? "text-muted-foreground" : "text-zinc-400"
        }`}
      >
        <Calendar className="h-4 w-4 text-rose-400" aria-hidden="true" />
        {t.hero.deadlinePrefix} {deadlineDisplay}
      </p>
    );
  }

  const parts = diffParts(targetMs, now);
  const urgency = isDetail ? urgencyLevel(parts.days) : "normal";
  const boxTone = URGENCY_BOX[urgency];
  const boxes = [
    { value: pad(parts.days), label: t.hero.countdown.days, pulse: false },
    { value: pad(parts.hours), label: t.hero.countdown.hours, pulse: false },
    { value: pad(parts.minutes), label: t.hero.countdown.minutes, pulse: false },
    { value: pad(parts.seconds), label: t.hero.countdown.seconds, pulse: true },
  ];

  // Garis progres waktu: porsi waktu yang sudah berlalu sejak posisi
  // dipublikasikan sampai tutup (0-100%, di-clamp). Tanpa tanggal publikasi
  // yang valid, garis tidak digambar.
  const elapsedPct = useMemo(() => {
    if (!isDetail) return null;
    const startMs = publishedAt ? new Date(publishedAt).getTime() : NaN;
    if (!Number.isFinite(startMs) || startMs >= targetMs) return null;
    const pct = ((now - startMs) / (targetMs - startMs)) * 100;
    return Math.min(100, Math.max(0, pct));
  }, [isDetail, publishedAt, targetMs, now]);

  return (
    <div className="mt-6">
      <p
        className={`flex items-center gap-2 text-sm ${
          isDetail ? "text-muted-foreground" : "text-zinc-400"
        }`}
      >
        <Calendar className="h-4 w-4 text-rose-400" aria-hidden="true" />
        {t.hero.deadlinePrefix} {deadlineDisplay}
      </p>
      <div
        role="timer"
        aria-label={t.hero.countdown.aria}
        className="mt-3 flex flex-wrap gap-2 sm:gap-3"
      >
        {boxes.map((box) => (
          <div
            key={box.label}
            className={`min-w-16 rounded-xl border px-3 py-2.5 text-center transition-colors sm:min-w-20 sm:px-4 ${
              isDetail ? boxTone.border : "border-white/10 bg-white/5 backdrop-blur-sm"
            }`}
          >
            {box.pulse && !reduce ? (
              // Detak halus tiap pergantian detik: elemen di-remount via key agar
              // animasi initial terulang (scale turun ke 1, opacity naik ke 1).
              <motion.p
                key={box.value}
                initial={{ scale: 1.16, opacity: 0.55 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={`text-2xl font-bold tabular-nums sm:text-3xl ${
                  isDetail ? boxTone.value : "text-zinc-50"
                }`}
              >
                {box.value}
              </motion.p>
            ) : (
              <p
                className={`text-2xl font-bold tabular-nums sm:text-3xl ${
                  isDetail ? boxTone.value : "text-zinc-50"
                }`}
              >
                {box.value}
              </p>
            )}
            <p
              className={`mt-0.5 text-[10px] font-medium uppercase tracking-widest sm:text-xs ${
                isDetail ? "text-muted-foreground" : "text-zinc-400"
              }`}
            >
              {box.label}
            </p>
          </div>
        ))}
      </div>
      {elapsedPct !== null ? (
        // Garis tipis "waktu tersisa": bagian berwarna = waktu yang sudah lewat.
        // Hiasan statis (tanpa animasi) — aman untuk prefers-reduced-motion.
        <div
          aria-hidden="true"
          className="mt-3 h-1 w-full max-w-xs overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        >
          <div
            className={`h-full rounded-full ${boxTone.bar} transition-[width] duration-1000 ease-linear`}
            style={{ width: `${elapsedPct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Varian ringkas satu baris untuk kartu posisi: "Ditutup: 2 hari 14:03:22".
 * Render null bila belum mount, deadline tidak valid, atau sudah terlewat.
 */
export function DeadlineCountdownCompact({ deadline }: { deadline: string }) {
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

  if (!mounted || !target || targetMs <= now) return null;

  const parts = diffParts(targetMs, now);
  const clock = `${parts.days > 0 ? `${parts.days} ${t.hero.countdown.days.toLowerCase()} ` : ""}${pad(parts.hours)}:${pad(parts.minutes)}:${pad(parts.seconds)}`;

  return (
    <p
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="timer"
      aria-label={t.hero.countdown.aria}
    >
      <Clock
        className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden="true"
      />
      <span className="tabular-nums">
        {t.positions.closesPrefix}: {clock}
      </span>
    </p>
  );
}
