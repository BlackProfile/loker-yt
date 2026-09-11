// Helper murni untuk landing page: format tanggal, link share, parser deadline,
// pemetaan employmentType JSON-LD, dan util kecil lainnya.
import { parse } from "date-fns";
import { id as localeId } from "date-fns/locale";

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
