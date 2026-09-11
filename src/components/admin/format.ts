"use client";

// Helper format tanggal, label, dan teks kecil untuk panel admin.

import { cn } from "@/lib/utils";

const dateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const timeFmt = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return dateTimeFmt.format(d);
}

// Waktu singkat utk timeline: "12 Mar, 14.30"
export function formatShortDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return shortDateTimeFmt.format(d);
}

// Jam saja: "14.30"
export function formatTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return timeFmt.format(d);
}

// Tanggal relatif berbahasa Indonesia, mis. "3 jam lalu", "2 hari lalu".
export function formatRelative(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  const diffMs = d.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("id-ID", { numeric: "auto" });
  if (abs < 60_000) return "baru saja";
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  if (abs < 2_592_000_000) return rtf.format(Math.round(diffMs / 86_400_000), "day");
  return rtf.format(Math.round(diffMs / 2_592_000_000), "month");
}

// Konversi ISO -> nilai valid untuk <input type="datetime-local"> (zona lokal).
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Konversi nilai datetime-local -> ISO, atau null bila kosong/tidak valid.
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const chars = parts.slice(0, 2).map((p) => p.charAt(0).toUpperCase());
  return chars.join("");
}

export function waHref(phone: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  return `https://wa.me/${digits}`;
}

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "#";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

// Salin teks ke clipboard; true bila berhasil.
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Label aksi log aktivitas (dipakai timeline detail & tab Log).
export const ACTION_LABELS: Record<string, string> = {
  STATUS_CHANGE: "Ubah Status",
  NOTE: "Catatan",
  AI_SCREENING: "Analisis AI",
  TRANSCRIPTION: "Transkripsi",
  WEBHOOK: "Notifikasi",
  APPLICATION_SUBMITTED: "Lamaran Masuk",
  INTERVIEW_SCHEDULED: "Jadwal Wawancara",
  RATING: "Rating",
  TAGS: "Tags",
  TALENT_POOL: "Talent Pool",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// Warna badge aktor log: Sistem=zinc, AI=amber, admin=rose.
export function actorBadgeClass(actor: string): string {
  if (actor === "Sistem") {
    return "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
  }
  if (actor === "AI") {
    return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900";
  }
  return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900";
}

// Warna badge role admin: OWNER=rose, HR=amber, VIEWER=zinc.
export function roleBadgeClass(role: string): string {
  switch (role) {
    case "OWNER":
      return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900";
    case "HR":
      return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
  }
}

export function cnIf(...classes: Array<string | false | null | undefined>): string {
  return cn(...classes);
}
