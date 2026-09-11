// Helper murni untuk landing page: format tanggal, link share, parser deadline,
// pemetaan employmentType JSON-LD, dan util kecil lainnya.
import { parse } from "date-fns";
import { id as localeId } from "date-fns/locale";
import type { Position } from "@/lib/types";

const DAY_MS = 86_400_000;

export const DATE_FMT = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const DATETIME_FMT = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateId(iso: string): string {
  try {
    return DATE_FMT.format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDateTimeId(iso: string): string {
  try {
    return DATETIME_FMT.format(new Date(iso));
  } catch {
    return iso;
  }
}

export function whatsappHref(number: string): string {
  return `https://wa.me/${number.replace(/[^\d]/g, "")}`;
}

export function instagramHref(handle: string): string {
  const trimmed = handle.trim();
  if (!trimmed) return "#";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://instagram.com/${trimmed.replace(/^@/, "")}`;
}

/** Link share WhatsApp (tanpa nomor tujuan = user pilih sendiri). */
export function waShareHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Link intent X/Twitter. */
export function twitterShareHref(text: string, url: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

/** Parse string deadline bebas dari admin menjadi Date, atau null bila gagal. */
export function parseDeadlineDate(raw: string): Date | null {
  const text = raw.trim();
  if (!text) return null;
  const patterns = ["d MMMM yyyy", "dd MMMM yyyy", "yyyy-MM-dd"];
  for (const pattern of patterns) {
    try {
      const parsed = parse(text, pattern, new Date(), { locale: localeId });
      if (!Number.isNaN(parsed.getTime())) return parsed;
    } catch {
      // coba pola berikutnya
    }
  }
  const fallback = new Date(text);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Ukuran file dalam MB dengan 1 desimal. */
export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Inisial nama untuk avatar (maks 2 huruf). */
export function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "Full-time": "FULL_TIME",
  "Part-time": "PART_TIME",
  Freelance: "CONTRACTOR",
  Kontrak: "CONTRACT",
};

/** Pemetaan type posisi -> nilai schema.org employmentType. */
export function employmentTypeOf(type: string): string {
  return EMPLOYMENT_TYPE_MAP[type] ?? "OTHER";
}

/**
 * Deep-link URL posisi: `{origin}/?posisi={slug}` (fallback `/#posisi` bila slug kosong).
 * `source` opsional menambahkan UTM kampanye share:
 * `utm_source={source}&utm_medium=share&utm_campaign={slug}`.
 * Aman SSR — mengembalikan string kosong bila dipanggil di server.
 */
export function buildPositionUrl(
  position: Pick<Position, "slug">,
  source?: string,
): string {
  if (typeof window === "undefined") return "";
  if (!position.slug) return `${window.location.origin}/#posisi`;
  const slug = encodeURIComponent(position.slug);
  let url = `${window.location.origin}/?posisi=${slug}`;
  if (source) {
    url += `&utm_source=${encodeURIComponent(source)}&utm_medium=share&utm_campaign=${slug}`;
  }
  return url;
}

/**
 * ID video YouTube dari berbagai bentuk URL (watch?v=, youtu.be, shorts, embed, live, v),
 * atau null bila bukan YouTube/URL tidak valid.
 */
export function youtubeEmbedId(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (host === "youtu.be") {
      return url.pathname.slice(1).split("/")[0] || null;
    }
    if (!/(^|\.)youtube(-nocookie)?\.com$/.test(host)) return null;
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const match = url.pathname.match(/^\/(shorts|embed|live|v)\/([^/?#]+)/);
    return match ? (match[2] ?? null) : null;
  } catch {
    return null;
  }
}

/** URL eksternal yang aman dirender (hanya protokol http/https), atau null. */
export function safeExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** true bila tanggal ISO berada dalam `days` hari TERAKHIR (untuk badge "Baru"). */
export function isWithinDaysBack(iso: string, days: number): boolean {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  const diff = Date.now() - time;
  return diff >= 0 && diff < days * DAY_MS;
}

/** true bila tanggal ISO datang dalam `days` hari ke depan (untuk badge "Segera Ditutup"). */
export function isWithinDaysAhead(iso: string, days: number): boolean {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  const diff = time - Date.now();
  return diff >= 0 && diff < days * DAY_MS;
}

/** true bila tanggal ISO sudah terlewat (posisi tertutup). */
export function isPastIso(iso: string): boolean {
  const time = new Date(iso).getTime();
  return !Number.isNaN(time) && time < Date.now();
}

/** Isi placeholder `{kunci}` pada template kamus dengan nilai. */
export function fillTemplate(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
    template,
  );
}
