"use client";

// NR60 (Task 2-b) — ekstraksi dari apply-wizard.tsx: seluruh renderer field
// Form Builder + pratinjau berkas lokal kini hidup di file tersendiri sehingga
// bisa dipakai ulang preview Form Builder di panel admin (agent 2-c).
// Perilaku identik dengan versi lama di apply-wizard.tsx — hanya dipindahkan,
// ditandai export, plus dua helper baru (CharCount NR60 A4, ImageThumb NR60 B2).

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  CloudUpload,
  Download,
  Eye,
  FileText,
  Info,
  Star,
  Upload,
  X,
} from "lucide-react";
import {
  FORM_LIMITS,
  formatAnswerValue,
  isAllowedFormFile,
  type FormField,
  type FormSection,
} from "@/lib/form-schema";
import type { DraftFileMeta } from "@/lib/types";
import type { Lang } from "@/components/landing/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/landing/lang-context";
import { fillTemplate, formatMb } from "@/components/landing/landing-utils";

/** Sentinel pilihan "Lainnya" (radio/dropdown/checkbox allowOther) — memakai
 * karakter kontrol sehingga tidak mungkin bentrok dengan opsi buatan admin. */
export const FORM_OTHER_VALUE = "\u0000__other__";

/** Nilai jawaban satu field form di sisi klien (berkas = File sebelum diunggah). */
export type FormAnswerInput = string | string[] | number | File;
export type FormAnswers = Record<string, FormAnswerInput>;

/** Label field terlokalisasi: EN bila labelEn terisi, selain itu fallback label ID. */
export function formFieldLabel(field: FormField, lang: Lang): string {
  return lang === "en" && field.labelEn ? field.labelEn : field.label;
}

/** Judul bagian skema terlokalisasi (titleEn bila ada, fallback judul ID). */
export function formSectionTitle(section: FormSection, lang: Lang): string {
  return lang === "en" && section.titleEn ? section.titleEn : section.title;
}

/** Jawaban satu field terformat satu baris untuk pratinjau (berkas = nama+ukuran). */
export function formAnswerDisplay(
  field: FormField,
  value: FormAnswerInput | undefined,
): string {
  if (field.type === "file") {
    return value instanceof File ? `${value.name} (${formatMb(value.size)})` : "";
  }
  // NR-32 — uang selalu ditampilkan "Rp 1.500.000" (jawaban disimpan angka mentah).
  if (field.type === "currency") {
    if (typeof value === "number" && Number.isFinite(value)) {
      return `Rp ${value.toLocaleString("id-ID")}`;
    }
    if (typeof value === "string" && value.trim() !== "") {
      const num = Number(value.replace(/\D/g, ""));
      return Number.isFinite(num) ? `Rp ${num.toLocaleString("id-ID")}` : value;
    }
    return "";
  }
  if (Array.isArray(value)) {
    return formatAnswerValue(value.filter((item) => item !== FORM_OTHER_VALUE));
  }
  if (typeof value === "string") {
    return value === FORM_OTHER_VALUE ? "" : value;
  }
  if (typeof value === "number") {
    return formatAnswerValue(value);
  }
  return "";
}

/** Status pilihan "Lainnya" pada nilai checkbox (sentinel atau teks bebas). */
function checkboxOtherOf(
  value: FormAnswerInput | undefined,
  options: string[],
): { checked: boolean; text: string } {
  const items = Array.isArray(value) ? value : [];
  const freeText = items.find(
    (item): item is string =>
      typeof item === "string" && item !== FORM_OTHER_VALUE && !options.includes(item),
  );
  return {
    checked: items.some(
      (item) => item === FORM_OTHER_VALUE || (typeof item === "string" && !options.includes(item)),
    ),
    text: freeText ?? "",
  };
}

/* ----------------------------- NR60 (A4) CharCount ----------------------------- */

/**
 * NR60 (A4) — penghitung karakter jujur di bawah textarea/input panjang.
 * Dengan `max`: tampil "452/500" — kuning (amber) saat ≥80%, rose saat ≥100%.
 * Tanpa `max` (server tidak menegakkan batas): hanya jumlah karakter netral.
 * Diekspor agar preview Form Builder panel admin (agent 2-c) bisa memakainya.
 */
export function CharCount({
  value,
  max,
  lang,
}: {
  value: string;
  /** Batas karakter yang ditegakkan server (bila ada) — tanpa ini hanya hitungan. */
  max?: number;
  lang: Lang;
}) {
  const len = value.length;
  // NR62 (F6) — tanpa isi tidak ada hitungan (mengurangi kebisingan visual);
  // begitu ada isi (atau mendekati batas) hitungan selalu tampil.
  if (len === 0) return null;
  if (max == null) {
    return (
      <p className="text-right text-xs tabular-nums text-muted-foreground">
        {len.toLocaleString(lang === "en" ? "en-US" : "id-ID")}{" "}
        {lang === "en" ? (len === 1 ? "character" : "characters") : "karakter"}
      </p>
    );
  }
  const ratio = max > 0 ? len / max : 0;
  const near = ratio >= 0.8;
  const over = len >= max;
  return (
    <p
      className={cn(
        "text-right text-xs tabular-nums text-muted-foreground",
        near && !over && "text-amber-600 dark:text-amber-400",
        over && "text-rose-600 dark:text-rose-400",
      )}
    >
      {len}/{max}
    </p>
  );
}

/* ----------------------------- NR60 (B2) ImageThumb ----------------------------- */

/**
 * NR60 (B2) — thumbnail 40x40 untuk berkas LOKAL berupa gambar (URL objek blob
 * dibuat via URL.createObjectURL dan dicabut saat berganti berkas/unmount).
 * Bukan gambar → tidak dirender apa pun (null) sehingga pemanggil bisa fallback
 * ke ikon lama. Klik thumbnail = pratinjau (sama dengan tombol "Lihat").
 */
export function ImageThumb({
  file,
  onView,
  viewLabel,
}: {
  file: File;
  /** Dipanggil saat thumbnail diklik — lewatkan aksi "Lihat" yang sudah ada. */
  onView: () => void;
  /** Label aksesibilitas tombol (mis. teks "Lihat"). */
  viewLabel: string;
}) {
  const isImage = file.type.startsWith("image/");
  // Pola sama dengan LocalFileViewerDialog: URL objek dibuat via useMemo dan
  // dicabut effect cleanup saat berganti berkas / unmount (tanpa setState —
  // thumbnail tersedia sejak render pertama).
  const objectUrl = useMemo(
    () => (isImage ? URL.createObjectURL(file) : null),
    [file, isImage],
  );

  useEffect(() => {
    if (!objectUrl) return;
    return () => URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  if (!isImage || !objectUrl) return null;
  return (
    <button
      type="button"
      onClick={onView}
      aria-label={viewLabel}
      title={file.name}
      className="shrink-0 overflow-hidden rounded-md border transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src={objectUrl}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 rounded object-cover"
      />
    </button>
  );
}

/**
 * Catatan kecil di bawah input berkas: chip "sudah ada di draft" (pemulihan
 * lintas perangkat) atau konfirmasi "tersimpan di draft" (unggahan baru).
 * Dipakai blok CV/intro/dokumen tambahan DAN field berkas Form Builder.
 * NR62 (F5) — teks dipindah ke strings.ts (t.apply.draft.*) dan paragraf
 * peringatan 2 baris dihapus (beforeunload guard sudah melindungi unggahan).
 */
export function DraftFileNote({
  meta,
  localName,
  uploading,
  progress = null,
}: {
  meta: DraftFileMeta | null;
  localName: string | null;
  uploading: boolean;
  /** NR58 (A3) — persen unggahan nyata (0-100) bila sedang berjalan. */
  progress?: number | null;
}) {
  const { t } = useLang();
  if (uploading) {
    const pct =
      typeof progress === "number"
        ? Math.min(100, Math.max(0, Math.round(progress)))
        : null;
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CloudUpload className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
          {t.apply.draft.saving}
          {pct != null ? ` — ${pct}%` : "…"}
        </p>
        {pct != null ? (
          <div
            className="h-1 w-full max-w-56 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-rose-600 transition-[width] duration-200"
              style={{ width: `${pct}%` }}
            />
          </div>
        ) : null}
      </div>
    );
  }
  if (!meta) return null;
  if (localName && meta.filename === localName) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CloudUpload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t.apply.draft.savedNote}
      </p>
    );
  }
  if (!localName) {
    return (
      <p className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2.5 py-1 text-xs text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CloudUpload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">
          {fillTemplate(t.apply.draft.existing, {
            name: meta.filename,
            size: formatMb(meta.size),
          })}
        </span>
      </p>
    );
  }
  return null;
}

export type FormFieldRendererProps = {
  field: FormField;
  value: FormAnswerInput | undefined;
  error: string | undefined;
  /** Set/hapus jawaban field (undefined = hapus); error field ikut dibersihkan. */
  onAnswer: (fieldId: string, value: FormAnswerInput | undefined) => void;
  /** Catat pesan error field (mis. berkas ditolak saat dipilih). */
  onAnswerError: (fieldId: string, message: string) => void;
  /** NR-41 J26 — meta file draft server untuk field berkas ini (bila ada). */
  draftFile?: DraftFileMeta | null;
  /** NR-41 J26 — true bila file field ini sedang diunggah ke draft. */
  draftUploading?: boolean;
  /** NR58 (A3) — persen unggahan field ini (bila sedang berjalan). */
  draftProgress?: number | null;
};

/** Jenis pratinjau yang mampu dirender browser untuk satu berkas. */
type LocalPreviewKind = "pdf" | "image" | "audio" | "video" | "text" | "unsupported";

/**
 * Tentukan cara pratinjau berkas lokal (sebelum dikirim) dari MIME type —
 * dengan fallback ekstensi nama karena beberapa berkas (mis. .docx) kosong
 * MIME-nya di sebagian browser.
 */
function localPreviewKind(file: File): LocalPreviewKind {
  const type = file.type || "";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("text/")) return "text";
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|gif|bmp|svg)$/.test(name)) return "image";
  if (/\.(mp3|wav|m4a|ogg|aac)$/.test(name)) return "audio";
  if (/\.(mp4|webm|mov|m4v)$/.test(name)) return "video";
  if (/\.(txt|md|csv)$/.test(name)) return "text";
  return "unsupported";
}

/**
 * Dialog pratinjau berkas lokal milik pelamar (NR-36) — berkas BARU dipilih di
 * wizard sebelum dikirim, jadi pratinjau memakai URL objek lokal (blob:) via
 * URL.createObjectURL; tidak ada permintaan jaringan & tidak ada isu izin.
 * Mendukung PDF (iframe), gambar, audio, video, dan teks; format lain (mis.
 * Word) memakai kotak fallback + tombol unduh salinan.
 */
export function LocalFileViewerDialog({
  file,
  open,
  onOpenChange,
}: {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLang();

  // URL objek lokal dibuat saat dialog terbuka (blob:) dan dicabut otomatis
  // oleh cleanup saat berganti berkas / ditutup / komponen unmount.
  const objectUrl = useMemo(() => {
    if (!open || !file) return null;
    return URL.createObjectURL(file);
  }, [file, open]);

  useEffect(() => {
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [objectUrl]);

  const kind: LocalPreviewKind = file ? localPreviewKind(file) : "unsupported";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-4 overflow-hidden rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Eye className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            {t.apply.viewer.title}
          </DialogTitle>
          <DialogDescription className="truncate">
            {file ? `${file.name} · ${formatMb(file.size)}` : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto nice-scrollbar">
          {!file || !objectUrl ? null : kind === "pdf" ? (
            <iframe
              src={objectUrl}
              title={`${file.name} — ${t.apply.viewer.title}`}
              className="h-[65vh] w-full rounded-lg border bg-background"
            />
          ) : kind === "image" ? (
            <img
              src={objectUrl}
              alt={file.name}
              className="mx-auto max-h-[65vh] w-auto max-w-full rounded-lg object-contain"
            />
          ) : kind === "audio" ? (
            <audio controls src={objectUrl} className="w-full" />
          ) : kind === "video" ? (
            <video
              controls
              src={objectUrl}
              className="mx-auto max-h-[65vh] w-full rounded-lg"
            />
          ) : kind === "text" ? (
            <iframe
              src={objectUrl}
              title={`${file.name} — ${t.apply.viewer.title}`}
              className="h-[65vh] w-full rounded-lg border bg-background"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-sm text-sm text-muted-foreground">
                {t.apply.viewer.unsupported}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          {file && objectUrl ? (
            <Button type="button" variant="outline" className="h-11 gap-2 sm:h-9" asChild>
              <a href={objectUrl} download={file.name}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t.apply.viewer.download}
              </a>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            className="h-11 sm:h-9"
            onClick={() => onOpenChange(false)}
          >
            {t.apply.viewer.close}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** NR60 (A3) — batas berkas field form dalam MB utk hint/error (dari FORM_LIMITS,
 * sinkron dengan MAX_UPLOAD_BYTES server — jangan hardcode angka di teks). */
export const FORM_FILE_MAX_MB = Math.round(FORM_LIMITS.fileMaxBytes / (1024 * 1024));

/**
 * Renderer satu pertanyaan Form Builder pada langkah dinamis wizard.
 * Mendukung semua tipe field: text, textarea, radio, checkbox, dropdown, date,
 * number, rating, file, dan url — plus opsi "Lainnya" (allowOther).
 */
export function FormFieldRenderer({
  field,
  value,
  error,
  onAnswer,
  onAnswerError,
  draftFile = null,
  draftUploading = false,
  draftProgress = null,
}: FormFieldRendererProps) {
  const { t, lang } = useLang();
  const anchorId = `apply-form-${field.id}`;
  const errorId = `${anchorId}-error`;
  const label = formFieldLabel(field, lang);
  const [fileDragging, setFileDragging] = useState(false);
  // NR-36 — pratinjau berkas field form langsung di aplikasi sebelum dikirim.
  const [viewOpen, setViewOpen] = useState(false);

  const textValue = typeof value === "string" ? value : "";
  const inputAria = {
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  } as const;

  const requiredMark = field.required ? (
    <span className="text-rose-600">*</span>
  ) : (
    <span className="text-xs font-normal text-muted-foreground">
      ({t.apply.uploads.optional})
    </span>
  );

  /** NR60 (A4) — batas karakter efektif field teks/textarea utk CharCount. */
  const charLimit =
    field.type === "text"
      ? Math.min(field.maxLen ?? FORM_LIMITS.textDefaultMax, FORM_LIMITS.textHardMax)
      : field.type === "textarea"
        ? Math.min(
            field.maxLen ?? FORM_LIMITS.textareaDefaultMax,
            FORM_LIMITS.textHardMax,
          )
        : null;

  /** Terima berkas field form: validasi tipe + ukuran sebelum disimpan.
   * NR62 (F7) — tanpa toast: pesan error tampil inline di bawah field. */
  function acceptFormFile(candidate: File | null) {
    if (!candidate) return;
    if (!isAllowedFormFile({ type: candidate.type, name: candidate.name })) {
      const msg = fillTemplate(t.apply.errors.formFileType, { label });
      onAnswerError(field.id, msg);
      return;
    }
    if (candidate.size > FORM_LIMITS.fileMaxBytes) {
      // NR60 (A3) — pesan menyebut ukuran dari FORM_LIMITS (bukan hardcode).
      const msg = fillTemplate(t.apply.errors.formFileSize, {
        label,
        max: `${FORM_FILE_MAX_MB} MB`,
      });
      onAnswerError(field.id, msg);
      return;
    }
    onAnswer(field.id, candidate);
  }

  let control: ReactNode = null;

  switch (field.type) {
    case "text":
      control = (
        <div className="flex flex-col gap-1">
          <Input
            id={`${anchorId}-input`}
            value={textValue}
            onChange={(event) => onAnswer(field.id, event.target.value)}
            maxLength={Math.min(field.maxLen ?? FORM_LIMITS.textDefaultMax, FORM_LIMITS.textHardMax)}
            placeholder={field.placeholder}
            autoComplete={field.autocomplete || undefined}
            className="h-11"
            {...inputAria}
          />
          {/* NR60 (A4) — penghitung karakter jujur di bawah input teks. */}
          <CharCount value={textValue} max={charLimit ?? undefined} lang={lang} />
        </div>
      );
      break;
    case "textarea":
      control = (
        <div className="flex flex-col gap-1">
          <Textarea
            id={`${anchorId}-input`}
            rows={3}
            value={textValue}
            onChange={(event) => onAnswer(field.id, event.target.value)}
            maxLength={Math.min(
              field.maxLen ?? FORM_LIMITS.textareaDefaultMax,
              FORM_LIMITS.textHardMax,
            )}
            placeholder={field.placeholder}
            {...inputAria}
          />
          {/* NR60 (A4) — penghitung karakter jujur di bawah textarea. */}
          <CharCount value={textValue} max={charLimit ?? undefined} lang={lang} />
        </div>
      );
      break;
    case "url":
      control = (
        <div className="flex flex-col gap-1">
          <Input
            id={`${anchorId}-input`}
            type="url"
            value={textValue}
            onChange={(event) => onAnswer(field.id, event.target.value)}
            placeholder={field.placeholder || "https://..."}
            autoComplete={field.autocomplete || undefined}
            className="h-11"
            {...inputAria}
          />
          <p className="text-xs text-muted-foreground">http(s)://…</p>
        </div>
      );
      break;
    case "date":
      control = (
        <Input
          id={`${anchorId}-input`}
          type="date"
          value={textValue}
          onChange={(event) => onAnswer(field.id, event.target.value)}
          autoComplete={field.autocomplete || undefined}
          className="h-11"
          {...inputAria}
        />
      );
      break;
    case "number":
      control = (
        <Input
          id={`${anchorId}-input`}
          type="number"
          inputMode="decimal"
          step="any"
          min={field.min}
          max={field.max}
          value={typeof value === "number" ? String(value) : textValue}
          onChange={(event) => onAnswer(field.id, event.target.value)}
          className="h-11"
          {...inputAria}
        />
      );
      break;
    case "currency": {
      // NR-32 — uang: jawaban disimpan angka MENTAH, tampilan diberi pemisah
      // ribuan Indonesia saat mengetik. Prefix "Rp" dekoratif (aria-hidden).
      const currencyDigits =
        typeof value === "number" && Number.isFinite(value)
          ? String(Math.trunc(value))
          : typeof value === "string"
            ? value.replace(/\D/g, "")
            : "";
      const currencyDisplay = currencyDigits
        ? Number(currencyDigits).toLocaleString("id-ID")
        : "";
      control = (
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
            aria-hidden="true"
          >
            Rp
          </span>
          <Input
            id={`${anchorId}-input`}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={currencyDisplay}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, 12);
              if (!digits) {
                onAnswer(field.id, undefined);
                return;
              }
              const num = Number(digits);
              if (Number.isFinite(num)) onAnswer(field.id, num);
            }}
            placeholder={field.placeholder}
            className="h-11 pl-9"
            {...inputAria}
          />
        </div>
      );
      break;
    }
    case "rating": {
      const ratingMax = field.max ?? FORM_LIMITS.ratingMaxDefault;
      const current = typeof value === "number" ? value : 0;
      control = (
        <div className="flex items-center gap-1" role="group" aria-label={label}>
          {Array.from({ length: ratingMax }, (_, index) => index + 1).map((star) => (
            <button
              key={star}
              type="button"
              aria-label={fillTemplate(t.apply.formSection.ratingAria, { n: star })}
              aria-pressed={current === star}
              onClick={() => onAnswer(field.id, current === star ? undefined : star)}
              className="rounded p-0.5 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={cn(
                  "size-7 transition-colors",
                  current >= star
                    ? "fill-amber-400 text-amber-500 dark:fill-amber-500 dark:text-amber-400"
                    : "text-muted-foreground/40 hover:text-amber-400",
                )}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      );
      break;
    }
    case "radio": {
      const options = field.options;
      const otherSelected =
        typeof value === "string" && value !== "" && !options.includes(value);
      const otherText =
        otherSelected && typeof value === "string" && value !== FORM_OTHER_VALUE ? value : "";
      control = (
        <div className="flex flex-col gap-2">
          <RadioGroup
            value={(otherSelected ? FORM_OTHER_VALUE : textValue) || ""}
            onValueChange={(next) =>
              onAnswer(field.id, next === FORM_OTHER_VALUE ? FORM_OTHER_VALUE : next)
            }
            className="gap-2.5"
            aria-label={label}
          >
            {options.map((option, index) => (
              <div key={option} className="flex items-center gap-2.5">
                <RadioGroupItem value={option} id={`${anchorId}-opt-${index}`} />
                <Label
                  htmlFor={`${anchorId}-opt-${index}`}
                  className="cursor-pointer font-normal"
                >
                  {option}
                </Label>
              </div>
            ))}
            {field.allowOther ? (
              <div className="flex items-center gap-2.5">
                <RadioGroupItem value={FORM_OTHER_VALUE} id={`${anchorId}-other`} />
                <Label htmlFor={`${anchorId}-other`} className="cursor-pointer font-normal">
                  {t.apply.formSection.otherLabel}
                </Label>
              </div>
            ) : null}
          </RadioGroup>
          {field.allowOther && otherSelected ? (
            <Input
              value={otherText}
              onChange={(event) => onAnswer(field.id, event.target.value)}
              placeholder={t.apply.formSection.otherPlaceholder}
              maxLength={FORM_LIMITS.optionMaxLen}
              className="ml-7 h-10"
              aria-label={t.apply.formSection.otherLabel}
            />
          ) : null}
        </div>
      );
      break;
    }
    case "dropdown": {
      const options = field.options;
      const otherSelected =
        typeof value === "string" && value !== "" && !options.includes(value);
      const otherText =
        otherSelected && typeof value === "string" && value !== FORM_OTHER_VALUE ? value : "";
      control = (
        <div className="flex flex-col gap-2">
          <Select
            value={(otherSelected ? FORM_OTHER_VALUE : textValue) || undefined}
            onValueChange={(next) =>
              onAnswer(field.id, next === FORM_OTHER_VALUE ? FORM_OTHER_VALUE : next)
            }
          >
            <SelectTrigger
              id={`${anchorId}-input`}
              className="h-11 w-full"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            >
              <SelectValue placeholder={t.apply.formSection.chooseOption} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
              {field.allowOther ? (
                <SelectItem value={FORM_OTHER_VALUE}>
                  {t.apply.formSection.otherLabel}
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          {field.allowOther && otherSelected ? (
            <Input
              value={otherText}
              onChange={(event) => onAnswer(field.id, event.target.value)}
              placeholder={t.apply.formSection.otherPlaceholder}
              maxLength={FORM_LIMITS.optionMaxLen}
              className="h-10"
              aria-label={t.apply.formSection.otherLabel}
            />
          ) : null}
        </div>
      );
      break;
    }
    case "checkbox": {
      const options = field.options;
      const selected = Array.isArray(value) ? value : [];
      const other = checkboxOtherOf(value, options);
      control = (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t.apply.formSection.chooseMulti}</p>
          <div className="flex flex-col gap-2.5" role="group" aria-label={label}>
            {options.map((option, index) => (
              <div key={option} className="flex items-center gap-2.5">
                <Checkbox
                  id={`${anchorId}-opt-${index}`}
                  checked={selected.includes(option)}
                  onCheckedChange={(checked) => {
                    const next =
                      checked === true
                        ? [...selected, option]
                        : selected.filter((item) => item !== option);
                    onAnswer(field.id, next);
                  }}
                />
                <Label
                  htmlFor={`${anchorId}-opt-${index}`}
                  className="cursor-pointer font-normal"
                >
                  {option}
                </Label>
              </div>
            ))}
            {field.allowOther ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    id={`${anchorId}-other`}
                    checked={other.checked}
                    onCheckedChange={(checked) => {
                      if (checked === true) {
                        onAnswer(field.id, [...selected, FORM_OTHER_VALUE]);
                      } else {
                        onAnswer(
                          field.id,
                          selected.filter((item) => options.includes(item)),
                        );
                      }
                    }}
                  />
                  <Label htmlFor={`${anchorId}-other`} className="cursor-pointer font-normal">
                    {t.apply.formSection.otherLabel}
                  </Label>
                </div>
                {other.checked ? (
                  <Input
                    value={other.text}
                    onChange={(event) => {
                      const kept = selected.filter((item) => options.includes(item));
                      const text = event.target.value;
                      onAnswer(
                        field.id,
                        text.trim() ? [...kept, text] : [...kept, FORM_OTHER_VALUE],
                      );
                    }}
                    placeholder={t.apply.formSection.otherPlaceholder}
                    maxLength={FORM_LIMITS.optionMaxLen}
                    className="ml-7 h-10"
                    aria-label={t.apply.formSection.otherLabel}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      );
      break;
    }
    case "file": {
      const file = value instanceof File ? value : null;
      control = (
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`${anchorId}-input`}
            onDragOver={(event) => {
              event.preventDefault();
              setFileDragging(true);
            }}
            onDragLeave={() => setFileDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setFileDragging(false);
              acceptFormFile(event.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-center transition-colors",
              fileDragging
                ? "border-primary bg-rose-50 dark:bg-rose-500/10"
                : "hover:bg-accent/50",
              error && "border-rose-400 dark:border-rose-500",
            )}
          >
            <Upload
              className="h-5 w-5 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
            <span className="text-xs text-muted-foreground">
              {t.apply.formSection.fileChoose} — {t.apply.uploads.dropHint}
            </span>
            <input
              id={`${anchorId}-input`}
              name={`formFile_${field.id}`}
              type="file"
              className="sr-only"
              onChange={(event) => {
                acceptFormFile(event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* NR60 (A3) — hint ukuran dari FORM_LIMITS (bukan hardcode). */}
            {fillTemplate(t.apply.formSection.fileHint, {
              max: `${FORM_FILE_MAX_MB} MB`,
            })}
          </p>
          {file ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                {/* NR60 (B2) — thumbnail 40x40 utk berkas gambar (klik = pratinjau). */}
                <ImageThumb
                  file={file}
                  onView={() => setViewOpen(true)}
                  viewLabel={t.apply.uploads.view}
                />
                {!file.type.startsWith("image/") ? (
                  <FileText
                    className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                ) : null}
                <span className="truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatMb(file.size)}
                </span>
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground"
                  onClick={() => setViewOpen(true)}
                >
                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  {t.apply.uploads.view}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-muted-foreground"
                  onClick={() => document.getElementById(`${anchorId}-input`)?.click()}
                >
                  {t.apply.formSection.fileChange}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  aria-label={t.apply.formSection.fileRemove}
                  onClick={() => onAnswer(field.id, undefined)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          ) : null}
          {/* NR-41 J26 — status file draft lintas perangkat utk field ini. */}
          <DraftFileNote
            meta={draftFile}
            localName={file?.name ?? null}
            uploading={draftUploading}
            progress={typeof draftProgress === "number" ? draftProgress : null}
          />
          {/* NR-36 — dialog pratinjau berkas lokal (blob:) untuk field form */}
          <LocalFileViewerDialog file={file} open={viewOpen} onOpenChange={setViewOpen} />
        </div>
      );
      break;
    }
    default:
      control = null;
  }

  return (
    <div id={anchorId} className="flex scroll-mt-24 flex-col gap-2">
      {field.type === "text" ||
      field.type === "textarea" ||
      field.type === "url" ||
      field.type === "date" ||
      field.type === "number" ||
      field.type === "currency" ||
      field.type === "dropdown" ? (
        <Label htmlFor={`${anchorId}-input`} className="gap-2">
          {label} {requiredMark}
        </Label>
      ) : (
        <p className="text-sm font-medium leading-none">
          {label} {requiredMark}
        </p>
      )}
      {field.helpText ? (
        <p className="text-xs text-muted-foreground">{field.helpText}</p>
      ) : null}
      {control}
      {error ? (
        <p id={errorId} className="text-sm text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
