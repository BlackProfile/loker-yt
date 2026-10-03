"use client";

// Tipe & helper bersama untuk halaman Cek Status (#status).
// Dipindahkan verbatim dari status-page.tsx (NR-18-a) — tidak ada perubahan logika.

import type { InterviewPlatform, InterviewStatus, StageKey } from "@/lib/types";
import { fillTemplate } from "@/components/landing/landing-utils";
import type { Dict, Lang } from "@/components/landing/strings";

// Debounce recheck realtime — endpoint track punya throttle (min. ~0,4 detik).
export const LIVE_RECHECK_DEBOUNCE_MS = 1000;
// Jeda recheck setelah aksi sukses agar tidak menabrak throttle endpoint.
export const ACTION_RECHECK_DELAY_MS = 1100;

export const DAY_MS = 86_400_000;

// Batas ukuran unggah CV (PDF) — sama dengan validasi server /api/public/cv/update.
export const CV_MAX_BYTES = 10 * 1024 * 1024;
// Batas panjang teks pertanyaan pelamar — sama dengan /api/public/question.
export const QUESTION_MAX_LENGTH = 500;

/**
 * Peta "terakhir dilihat" lengkap dari localStorage — key sama dengan SEEN_KEY
 * di src/lib/status-session.ts (file lib tidak diubah, hanya nilainya dibaca).
 * Dipakai untuk header "x-lumina-seen" saat login track-auth: server menghitung
 * "Apa yang Berubah" per kode sejak epoch ms yang dikirim (kode tanpa nilai / 0
 * diabaikan server, jadi aman mengirim seluruh peta yang tersimpan).
 */
export const SEEN_STORAGE_KEY = "lumina.status.seen";
export function readAllSeen(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

// Format tanggal ringkas timeline (NR-15 idea 1): "12 Mei" / "12 May",
// versi berjam untuk kejadian dalam 24 jam terakhir.
const SHORT_DATE_FMT: Record<Lang, Intl.DateTimeFormat> = {
  id: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }),
  en: new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }),
};
const SHORT_DATETIME_FMT: Record<Lang, Intl.DateTimeFormat> = {
  id: new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
  en: new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

/** Tanggal ringkas; menyertakan jam bila kejadiannya dalam 24 jam terakhir. */
export function formatShortDate(iso: string, lang: Lang, nowMs: number): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const age = nowMs - ms;
  const fmt = age >= 0 && age < DAY_MS ? SHORT_DATETIME_FMT[lang] : SHORT_DATE_FMT[lang];
  return fmt.format(new Date(iso));
}

/** Tanggal panjang mengikuti bahasa aktif (kartu tanggal mulai & surat offer). */
export function formatLongDate(iso: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Waktu relatif ringkas untuk daftar "Apa yang Berubah". */
export function relativeTime(iso: string, nowMs: number, page: Dict["status"]["page"]): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Math.max(0, nowMs - ms);
  if (diff < 60_000) return page.relNow;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return fillTemplate(page.relMin, { n: minutes });
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return fillTemplate(page.relHour, { n: hours });
  return fillTemplate(page.relDay, { n: Math.floor(diff / DAY_MS) });
}

/** Palet confetti perayaan diterima (NR-15 idea 16) — tanpa biru/ungu, tanpa emoji. */
export const CONFETTI_COLORS = ["#f43f5e", "#fbbf24", "#10b981", "#18181b"];

export type StepView = { key: string; label: string; done: boolean; at: string | null };

// Label platform wawancara (nama proper — tidak diterjemahkan).
export const PLATFORM_LABELS: Record<InterviewPlatform, string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  WHATSAPP: "WhatsApp Call",
  TELEPON: "Telepon",
  LAINNYA: "Lainnya",
};

// Badge status sesi wawancara — gaya border+bg-50/950 seperti box existing.
export const INTERVIEW_BADGE_CLASS: Record<InterviewStatus, string> = {
  SCHEDULED:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  CONFIRMED:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  RESCHEDULE_REQUESTED:
    "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  COMPLETED:
    "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-300",
  NO_SHOW:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
  CANCELLED:
    "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-400",
};

/** Stempel UTC format Google Calendar: YYYYMMDDTHHMMSSZ. */
function toGcalStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * URL "Tambahkan ke Google Calendar" (action=TEMPLATE).
 * `dates` memakai UTC dari scheduledAt sampai +durationMin; semua parameter di-encode.
 */
export function buildGoogleCalendarUrl(opts: {
  title: string;
  startIso: string;
  durationMin: number;
  details: string;
  location: string;
}): string {
  const start = new Date(opts.startIso);
  if (Number.isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + opts.durationMin * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${toGcalStamp(start)}/${toGcalStamp(end)}`,
    details: opts.details,
    location: opts.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Tahap terminal bawaan (label tahap kustom bisa apa saja — tak dianggap final). */
export function isFinalStatus(status?: StageKey): boolean {
  return status === "ACCEPTED" || status === "REJECTED";
}
