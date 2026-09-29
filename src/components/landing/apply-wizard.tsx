"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Info,
  Loader2,
  MessageSquareText,
  Mic,
  PauseCircle,
  PencilLine,
  ShieldCheck,
  Star,
  Upload,
  X,
} from "lucide-react";
import {
  APPLICATION_SOURCES,
  CV_MAX_BYTES,
  INTRO_MAX_BYTES,
  type ApplySuccessResponse,
  type Position,
} from "@/lib/types";
import {
  FORM_LIMITS,
  formatAnswerValue,
  isAllowedFormFile,
  type FormField,
  type FormSection,
} from "@/lib/form-schema";
import type { Lang } from "@/components/landing/strings";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/landing/lang-context";
import { fillTemplate, formatMb, safeExternalUrl } from "@/components/landing/landing-utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DRAFT_KEY = "lumina-draft";
const AUTOSAVE_DELAY_MS = 500;
const MIN_TEXT_LENGTH = 10;
const SCREENING_MAX = 500; // batas karakter tiap jawaban screening (sinkron dengan server)
const SCREENING_KEY_PREFIX = "screening:";

// Form Builder per posisi (mode skema aktif).
const FORM_KEY_PREFIX = "form:"; // kunci error jawaban: "form:"+fieldId
// Sentinel pilihan "Lainnya" (radio/dropdown/checkbox allowOther) — memakai
// karakter kontrol sehingga tidak mungkin bentrok dengan opsi buatan admin.
const FORM_OTHER_VALUE = "\u0000__other__";
const FORM_URL_RE = /^https?:\/\//i;
const FORM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Dokumen wajib tambahan (customDocs posisi) — sinkron dengan server.
const EXTRA_DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB per dokumen
const ALLOWED_EXTRA_DOC_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const ALLOWED_EXTRA_DOC_EXTS = [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"];

/** Tipe dokumen tambahan diterima: PDF, gambar, atau dokumen Word. */
function isAllowedExtraDoc(file: File): boolean {
  if (ALLOWED_EXTRA_DOC_MIMES.includes(file.type)) return true;
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return ALLOWED_EXTRA_DOC_EXTS.includes(ext);
}

/* ------------------- Form Builder per posisi (skema aktif) ------------------- */

/** Nilai jawaban satu field form di sisi klien (berkas = File sebelum diunggah). */
type FormAnswerInput = string | string[] | number | File;
type FormAnswers = Record<string, FormAnswerInput>;

/** Label field terlokalisasi: EN bila labelEn terisi, selain itu fallback label ID. */
function formFieldLabel(field: FormField, lang: Lang): string {
  return lang === "en" && field.labelEn ? field.labelEn : field.label;
}

/** Judul bagian skema terlokalisasi (titleEn bila ada, fallback judul ID). */
function formSectionTitle(section: FormSection, lang: Lang): string {
  return lang === "en" && section.titleEn ? section.titleEn : section.title;
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

type FormFieldRendererProps = {
  field: FormField;
  value: FormAnswerInput | undefined;
  error: string | undefined;
  /** Set/hapus jawaban field (undefined = hapus); error field ikut dibersihkan. */
  onAnswer: (fieldId: string, value: FormAnswerInput | undefined) => void;
  /** Catat pesan error field (mis. berkas ditolak saat dipilih). */
  onAnswerError: (fieldId: string, message: string) => void;
};

/**
 * Renderer satu pertanyaan Form Builder pada langkah dinamis wizard.
 * Mendukung semua tipe field: text, textarea, radio, checkbox, dropdown, date,
 * number, rating, file, dan url — plus opsi "Lainnya" (allowOther).
 */
function FormFieldRenderer({
  field,
  value,
  error,
  onAnswer,
  onAnswerError,
}: FormFieldRendererProps) {
  const { t, lang } = useLang();
  const anchorId = `apply-form-${field.id}`;
  const errorId = `${anchorId}-error`;
  const label = formFieldLabel(field, lang);
  const [fileDragging, setFileDragging] = useState(false);

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

  /** Terima berkas field form: validasi tipe + ukuran sebelum disimpan. */
  function acceptFormFile(candidate: File | null) {
    if (!candidate) return;
    if (!isAllowedFormFile({ type: candidate.type, name: candidate.name })) {
      const msg = fillTemplate(t.apply.errors.formFileType, { label });
      onAnswerError(field.id, msg);
      toast.error(msg);
      return;
    }
    if (candidate.size > FORM_LIMITS.fileMaxBytes) {
      const msg = fillTemplate(t.apply.errors.formFileSize, { label });
      onAnswerError(field.id, msg);
      toast.error(msg);
      return;
    }
    onAnswer(field.id, candidate);
  }

  let control: ReactNode = null;

  switch (field.type) {
    case "text":
      control = (
        <Input
          id={`${anchorId}-input`}
          value={textValue}
          onChange={(event) => onAnswer(field.id, event.target.value)}
          maxLength={Math.min(field.maxLen ?? FORM_LIMITS.textDefaultMax, FORM_LIMITS.textHardMax)}
          placeholder={field.placeholder}
          className="h-11"
          {...inputAria}
        />
      );
      break;
    case "textarea":
      control = (
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
            value={(otherSelected ? FORM_OTHER_VALUE : textValue) || undefined}
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
            {t.apply.formSection.fileHint}
          </p>
          {file ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <FileText
                  className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
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

/* ------------------------- Komponen pratinjau lamaran ------------------------- */

function PreviewRow({
  label,
  value,
  fallback,
}: {
  label: string;
  value: string;
  fallback: string;
}) {
  const empty = value.trim().length === 0;
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:w-40">
        {label}
      </dt>
      <dd
        className={cn(
          "whitespace-pre-line break-words text-sm",
          empty ? "italic text-muted-foreground/70" : "font-medium",
        )}
      >
        {empty ? fallback : value}
      </dd>
    </div>
  );
}

function PreviewSection({
  title,
  editLabel,
  onEdit,
  children,
}: {
  title: string;
  editLabel: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">{title}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={onEdit}
        >
          <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
          {editLabel}
        </Button>
      </div>
      <dl className="mt-3 flex flex-col gap-3">{children}</dl>
    </div>
  );
}

type FormValues = {
  name: string;
  email: string;
  phone: string;
  portfolioUrl: string;
  socialLinks: string;
  experience: string;
  motivation: string;
};

type FieldKey = keyof FormValues | "positionId" | `screening:${string}`;
type FormErrors = Partial<Record<FieldKey, string>>;

const INITIAL_VALUES: FormValues = {
  name: "",
  email: "",
  phone: "",
  portfolioUrl: "",
  socialLinks: "",
  experience: "",
  motivation: "",
};

const VALUE_KEYS: (keyof FormValues)[] = [
  "name",
  "email",
  "phone",
  "portfolioUrl",
  "socialLinks",
  "experience",
  "motivation",
];

type StoredDraft = {
  values?: Partial<Record<keyof FormValues, unknown>>;
  positionId?: unknown;
  formAnswers?: Record<string, unknown>;
  savedAt?: unknown;
};

type ApplyWizardProps = {
  positions: Position[];
  positionId: string;
  onPositionIdChange: (positionId: string) => void;
  /**
   * true = posisi terkunci (dipakai halaman detail per lowongan): pemilih posisi
   * di langkah 1 disembunyikan dan positionId dianggap selalu valid.
   */
  lockPosition?: boolean;
};

export function ApplyWizard({
  positions,
  positionId,
  onPositionIdChange,
  lockPosition = false,
}: ApplyWizardProps) {
  const { t, lang } = useLang();
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Pratinjau & konfirmasi sebelum pengiriman (tidak ada kirim otomatis).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // Persetujuan pemrosesan data pribadi (Task 27) — wajib dicentang sebelum kirim.
  const [consented, setConsented] = useState(false);
  const [direction, setDirection] = useState(1);
  const [success, setSuccess] = useState<{
    name: string;
    trackingCode: string;
    autoReply: string | null;
    assignment: ApplySuccessResponse["assignment"];
  } | null>(null);

  // Jawaban pertanyaan screening posisi: {questionId: jawaban}
  const [screeningAnswers, setScreeningAnswers] = useState<Record<string, string>>({});
  // Dokumen wajib tambahan per posisi: {index urutan customDocs: file}
  const [extraFiles, setExtraFiles] = useState<Record<number, File>>({});
  const [extraErrors, setExtraErrors] = useState<Record<number, string | undefined>>({});
  // Jawaban Form Builder per posisi (skema aktif): {fieldId: nilai} — berkas
  // disimpan sebagai File hingga dikirim sebagai part formFile_<fieldId>.
  const [formAnswers, setFormAnswers] = useState<FormAnswers>({});
  // Error jawaban Form Builder: {"form:"+fieldId: pesan}
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  // Sumber pelamar ("dari mana tahu lowongan ini") — opsional.
  const [source, setSource] = useState("");
  // Mode tutup rekrutmen (Setting "site" via /api/public/site) — saat aktif,
  // tombol kirim di langkah akhir dinonaktifkan dan pengiriman diblokir.
  const [recruitmentClosed, setRecruitmentClosed] = useState(false);
  const [recruitmentClosedMessage, setRecruitmentClosedMessage] = useState("");
  // UTM dibaca SEKALI saat mount via useState initializer (aman SSR; tidak dirender).
  const [utm] = useState(() => {
    if (typeof window === "undefined") {
      return { source: "", medium: "", campaign: "" };
    }
    const params = new URLSearchParams(window.location.search);
    const pick = (key: string) => (params.get(key) ?? "").trim().slice(0, 60);
    return {
      source: pick("utm_source"),
      medium: pick("utm_medium"),
      campaign: pick("utm_campaign"),
    };
  });

  const selectedPosition = positions.find((p) => p.id === positionId);
  const screeningQuestions = selectedPosition?.screeningQuestions ?? [];
  const customDocs = selectedPosition?.customDocs ?? [];

  // Form Builder per posisi: skema aktif = formSchema terisi dengan minimal satu
  // field. null/kosong = mode klasik — seluruh jalur lama tetap berjalan.
  const rawSchema = selectedPosition?.formSchema ?? null;
  const schema = rawSchema && rawSchema.fields.length > 0 ? rawSchema : null;
  // Satu langkah wizard per bagian skema (section tanpa field dilewati),
  // ditempatkan antara langkah Pengalaman (1) dan Berkas.
  const sectionSteps: { section: FormSection; fields: FormField[]; stepIndex: number }[] = [];
  if (schema) {
    let nextStepIndex = 2;
    for (const section of schema.sections) {
      const fields = schema.fields.filter((field) => field.sectionId === section.id);
      if (fields.length === 0) continue;
      sectionSteps.push({ section, fields, stepIndex: nextStepIndex });
      nextStepIndex += 1;
    }
  }
  const filesStep = schema ? 2 + sectionSteps.length : 2;
  const previewStep = filesStep + 1;

  // Status rekrutmen dibaca sekali saat mount; gagal dianggap terbuka.
  useEffect(() => {
    let alive = true;
    fetch("/api/public/site", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (!alive || !data || typeof data !== "object") return;
        const obj = data as Record<string, unknown>;
        setRecruitmentClosed(obj.recruitmentClosed === true);
        setRecruitmentClosedMessage(
          typeof obj.message === "string" ? obj.message : "",
        );
      })
      .catch(() => {
        // biarkan default (terbuka)
      });
    return () => {
      alive = false;
    };
  }, []);

  // Reset jawaban screening & dokumen tambahan saat posisi berubah (termasuk perubahan dari luar
  // wizard lewat dialog posisi) — pola "adjust state during render", tanpa effect.
  const [lastPositionId, setLastPositionId] = useState(positionId);
  if (lastPositionId !== positionId) {
    setLastPositionId(positionId);
    setScreeningAnswers({});
    setExtraFiles({});
    setExtraErrors({});
    // Posisi berbeda = skema formulir berbeda — jawaban & error form direset.
    setFormAnswers({});
    setFormErrors({});
  }

  // File unggahan (tidak masuk draft).
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [introFile, setIntroFile] = useState<File | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const [introError, setIntroError] = useState<string | null>(null);
  const [cvDragging, setCvDragging] = useState(false);
  const [introDragging, setIntroDragging] = useState(false);
  const [extraDraggingIdx, setExtraDraggingIdx] = useState<number | null>(null);

  // Draft autosave.
  const [draft, setDraft] = useState<StoredDraft | null>(null);
  const submittedRef = useRef(false);
  const draftDismissedRef = useRef(false);
  // Anti-spam (Task 27): waktu formulir dibuka (time-trap) + ref honeypot.
  const formStartedAtRef = useRef<number>(Date.now());
  const websiteRef = useRef<HTMLInputElement | null>(null);
  // Ref posisi terkini untuk pelacakan langkah (dipakai effect mount).
  const positionIdRef = useRef(positionId);
  positionIdRef.current = positionId;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredDraft;
      if (parsed && typeof parsed === "object" && parsed.values) setDraft(parsed);
    } catch {
      // draft rusak -> abaikan
    }
  }, []);

  useEffect(() => {
    if (submittedRef.current || draftDismissedRef.current) return;
    const hasContent =
      VALUE_KEYS.some((key) => values[key].trim().length > 0) || positionId;
    if (!hasContent) return;
    // Jawaban form ikut disimpan — kecuali berkas (File tidak bisa diserialisasi).
    const serializableAnswers: Record<string, string | string[] | number> = {};
    for (const [key, value] of Object.entries(formAnswers)) {
      if (value === undefined || value instanceof File) continue;
      serializableAnswers[key] = value;
    }
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            values,
            positionId,
            formAnswers: serializableAnswers,
            savedAt: Date.now(),
          }),
        );
      } catch {
        // penyimpanan penuh / tidak tersedia
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [values, positionId, formAnswers]);

  // Pelacakan drop-off langkah wizard (Task 27): fire-and-forget ke
  // /api/public/track-step — seluruh kegagalan diabaikan agar tidak mengganggu UI.
  const trackStep = useCallback(
    (event: "enter" | "advance" | "submit", step: number) => {
      try {
        const payload: Record<string, unknown> = { step, event };
        if (positionIdRef.current) payload.positionId = positionIdRef.current;
        void fetch("/api/public/track-step", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => {
          // diabaikan — pelacakan tidak boleh melempar error
        });
      } catch {
        // diabaikan
      }
    },
    [],
  );

  // Event "enter" langkah 1 dikirim sekali saat wizard dibuka.
  useEffect(() => {
    trackStep("enter", 1);
  }, [trackStep]);

  const setField = (key: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /** Simpan jawaban screening (dipotong 500 karakter) + hapus error saat diketik. */
  const setAnswer = (questionId: string, value: string) => {
    const clipped = value.slice(0, SCREENING_MAX);
    setScreeningAnswers((prev) => ({ ...prev, [questionId]: clipped }));
    const key = `${SCREENING_KEY_PREFIX}${questionId}` as FieldKey;
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  /** Set/hapus jawaban field form skema + bersihkan error field itu saat diubah. */
  const handleFormAnswer = (fieldId: string, value: FormAnswerInput | undefined) => {
    setFormAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    const errorKey = `${FORM_KEY_PREFIX}${fieldId}`;
    setFormErrors((prev) => {
      if (!prev[errorKey]) return prev;
      const next = { ...prev };
      delete next[errorKey];
      return next;
    });
  };

  /** Catat pesan error jawaban form (mis. berkas ditolak saat dipilih). */
  const handleFormAnswerError = (fieldId: string, message: string) => {
    setFormErrors((prev) => ({ ...prev, [`${FORM_KEY_PREFIX}${fieldId}`]: message }));
  };

  const clearPositionError = () => {
    setErrors((prev) =>
      prev.positionId ? { ...prev, positionId: undefined } : prev,
    );
  };

  function validateStep1(): FormErrors {
    const next: FormErrors = {};
    if (!values.name.trim()) next.name = t.apply.errors.name;
    if (!values.email.trim()) next.email = t.apply.errors.emailRequired;
    else if (!EMAIL_RE.test(values.email.trim())) next.email = t.apply.errors.emailInvalid;
    if (!values.phone.trim()) next.phone = t.apply.errors.phoneRequired;
    else if (values.phone.replace(/\D/g, "").length < 8)
      next.phone = t.apply.errors.phoneMin;
    // Saat lockPosition, posisi tetap dari halaman detail — dianggap valid,
    // error "pilih posisi" tidak perlu ditampilkan.
    if (!lockPosition && positions.length > 0 && !positionId)
      next.positionId = t.apply.errors.position;
    // Formulir per posisi: posisi yang formulirnya ditutup admin tidak bisa dilamar.
    if (positionId && selectedPosition?.applyOpen === false)
      next.positionId = t.apply.errors.positionClosed;
    return next;
  }

  function validateStep2(): FormErrors {
    const next: FormErrors = {};
    if (values.experience.trim().length < MIN_TEXT_LENGTH)
      next.experience = t.apply.errors.experience;
    if (values.motivation.trim().length < MIN_TEXT_LENGTH)
      next.motivation = t.apply.errors.motivation;
    // Pertanyaan screening wajib milik posisi terpilih — mode klasik saja
    // (skema aktif menggantikan screening dengan langkah dinamis).
    if (!schema) {
      for (const question of screeningQuestions) {
        if (question.required && !(screeningAnswers[question.id] ?? "").trim()) {
          next[`${SCREENING_KEY_PREFIX}${question.id}`] = fillTemplate(
            t.apply.errors.screeningRequired,
            { label: question.label },
          );
        }
      }
    }
    // Posisi tertentu mewajibkan portofolio ATAU link sosial media.
    if (
      selectedPosition?.requirePortfolio &&
      !values.portfolioUrl.trim() &&
      !values.socialLinks.trim()
    ) {
      next.portfolioUrl = t.apply.errors.portfolioRequired;
    }
    return next;
  }

  function scrollToScreening(questionId: string) {
    document
      .getElementById(`apply-screening-${questionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** Error screening pertama dari peta error (untuk scroll + toast). */
  function firstScreeningErrorOf(next: FormErrors): { id: string; message: string } | null {
    for (const [key, message] of Object.entries(next)) {
      if (key.startsWith(SCREENING_KEY_PREFIX) && message) {
        return { id: key.slice(SCREENING_KEY_PREFIX.length), message };
      }
    }
    return null;
  }

  /** Gulir ke field form skema bermasalah (id jangkar "apply-form-{fieldId}"). */
  function scrollToFormField(fieldId: string) {
    document
      .getElementById(`apply-form-${fieldId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /** Error jawaban form pertama dari peta {"form:"+fieldId: pesan}. */
  function firstFormErrorOf(map: Record<string, string>): { id: string; message: string } | null {
    for (const [key, message] of Object.entries(map)) {
      if (key.startsWith(FORM_KEY_PREFIX) && message) {
        return { id: key.slice(FORM_KEY_PREFIX.length), message };
      }
    }
    return null;
  }

  /**
   * Validasi satu jawaban form di sisi klien — cermin validateFormAnswers server.
   * Mengembalikan pesan error terlokalisasi, atau null bila sah.
   */
  function validateFormField(field: FormField, value: FormAnswerInput | undefined): string | null {
    const label = formFieldLabel(field, lang);
    const requiredMsg = fillTemplate(t.apply.errors.formRequired, { label });
    // Field berkas tidak ikut formAnswers — wajib berarti File sudah dipilih.
    if (field.type === "file") {
      return field.required && !(value instanceof File) ? requiredMsg : null;
    }
    const empty =
      value === undefined ||
      (typeof value === "string" && (value.trim() === "" || value === FORM_OTHER_VALUE)) ||
      (Array.isArray(value) &&
        !value.some(
          (item) => typeof item === "string" && item.trim() !== "" && item !== FORM_OTHER_VALUE,
        ));
    if (empty) return field.required ? requiredMsg : null;

    switch (field.type) {
      case "text":
      case "textarea":
        return typeof value === "string" ? null : requiredMsg;
      case "url":
        return typeof value === "string" && FORM_URL_RE.test(value.trim())
          ? null
          : fillTemplate(t.apply.errors.formUrl, { label });
      case "number": {
        const num =
          typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number(value.trim())
              : NaN;
        if (!Number.isFinite(num)) return fillTemplate(t.apply.errors.formNumber, { label });
        if (field.min != null && num < field.min) {
          return fillTemplate(t.apply.errors.formNumberMin, { label, min: field.min });
        }
        if (field.max != null && num > field.max) {
          return fillTemplate(t.apply.errors.formNumberMax, { label, max: field.max });
        }
        return null;
      }
      case "rating": {
        const num = typeof value === "number" ? value : NaN;
        const ratingMax = field.max ?? FORM_LIMITS.ratingMaxDefault;
        if (!Number.isInteger(num) || num < 1 || num > ratingMax) {
          return fillTemplate(t.apply.errors.formRating, { label, max: ratingMax });
        }
        return null;
      }
      case "date":
        return typeof value === "string" && FORM_DATE_RE.test(value.trim())
          ? null
          : fillTemplate(t.apply.errors.formDate, { label });
      case "radio":
      case "dropdown": {
        if (typeof value !== "string") return fillTemplate(t.apply.errors.formOption, { label });
        // Sentinel "Lainnya" tanpa teks = dianggap belum dijawab.
        if (value === FORM_OTHER_VALUE) return field.required ? requiredMsg : null;
        if (!field.allowOther && !field.options.includes(value)) {
          return fillTemplate(t.apply.errors.formOption, { label });
        }
        return null;
      }
      case "checkbox": {
        if (!Array.isArray(value)) return fillTemplate(t.apply.errors.formOption, { label });
        if (
          !field.allowOther &&
          value.some((item) => typeof item === "string" && !field.options.includes(item))
        ) {
          return fillTemplate(t.apply.errors.formOption, { label });
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** Validasi seluruh field milik satu section skema → peta {"form:"+fieldId: pesan}. */
  function validateSectionFields(fields: FormField[]): Record<string, string> {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const message = validateFormField(field, formAnswers[field.id]);
      if (message) next[`${FORM_KEY_PREFIX}${field.id}`] = message;
    }
    return next;
  }

  function goToStep(next: number) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function goNext() {
    let next: FormErrors = {};
    let formNext: Record<string, string> = {};
    if (step === 0) {
      next = validateStep1();
    } else if (step === 1) {
      next = validateStep2();
    } else {
      // Langkah section Form Builder: validasi field milik section ini saja.
      const current = sectionSteps.find((entry) => entry.stepIndex === step);
      if (current) formNext = validateSectionFields(current.fields);
    }
    setErrors((prev) => ({ ...prev, ...next }));
    setFormErrors((prev) => ({ ...prev, ...formNext }));
    if (Object.values(next).some(Boolean) || Object.values(formNext).some(Boolean)) {
      if (step === 1) {
        // Screening wajib kosong: sorot + scroll + toast (pola error wizard).
        const screeningError = firstScreeningErrorOf(next);
        if (screeningError) {
          scrollToScreening(screeningError.id);
          toast.error(screeningError.message);
        }
      }
      // Jawaban form bermasalah: sorot + scroll + toast ke field pertama.
      const formError = firstFormErrorOf(formNext);
      if (formError) {
        scrollToFormField(formError.id);
        toast.error(formError.message);
      }
      return;
    }
    goToStep(step + 1);
    trackStep("advance", step + 1);
  }

  function goBack() {
    goToStep(Math.max(0, step - 1));
  }

  /** Validasi seluruh formulir; bila ada galat, lompat ke langkah pertama yang bermasalah. */
  function validateAllAndJump(): boolean {
    const e1 = validateStep1();
    const e2 = validateStep2();
    // Langkah section Form Builder ikut divalidasi (mode skema aktif).
    const formByStep = sectionSteps.map((entry) => ({
      stepIndex: entry.stepIndex,
      errors: validateSectionFields(entry.fields),
    }));
    const allFormErrors: Record<string, string> = {};
    for (const entry of formByStep) Object.assign(allFormErrors, entry.errors);
    setErrors((prev) => ({ ...prev, ...e1, ...e2 }));
    setFormErrors((prev) => ({ ...prev, ...allFormErrors }));
    if (e1.name || e1.email || e1.phone || e1.positionId) {
      goToStep(0);
      return false;
    }
    if (Object.values({ ...e1, ...e2 }).some(Boolean)) {
      goToStep(1);
      // Konten langkah 1 baru muncul setelah transisi AnimatePresence selesai —
      // scroll ke pertanyaan screening bermasalah dengan sedikit jeda.
      const screeningError = firstScreeningErrorOf(e2);
      if (screeningError) {
        window.setTimeout(() => scrollToScreening(screeningError.id), 400);
        toast.error(screeningError.message);
      }
      return false;
    }
    const badSection = formByStep.find((entry) => Object.values(entry.errors).some(Boolean));
    if (badSection) {
      goToStep(badSection.stepIndex);
      const formError = firstFormErrorOf(badSection.errors);
      if (formError) {
        window.setTimeout(() => scrollToFormField(formError.id), 400);
        toast.error(formError.message);
      }
      return false;
    }
    return true;
  }

  /** Berkas wajib per posisi (CV/audio intro + dokumen tambahan) — dipakai sebelum masuk pratinjau. */
  function validateRequiredFiles(): boolean {
    if (selectedPosition?.requireCv && !cvFile) {
      setCvError(t.apply.errors.cvRequired);
      toast.error(t.apply.errors.cvRequired);
      return false;
    }
    if (selectedPosition?.requireIntro && !introFile) {
      setIntroError(t.apply.errors.introRequired);
      toast.error(t.apply.errors.introRequired);
      return false;
    }
    // customDocs hanya mode klasik — skema aktif memakai field file milik skema.
    if (!schema) {
      for (let i = 0; i < customDocs.length; i++) {
        if (!extraFiles[i]) {
          const msg = fillTemplate(t.apply.uploads.extraDocRequired, {
            label: customDocs[i],
          });
          setExtraErrors((prev) => ({ ...prev, [i]: msg }));
          toast.error(msg);
          return false;
        }
      }
    }
    return true;
  }

  function acceptCv(file: File | null) {
    if (!file) return;
    if (file.type !== "application/pdf") {
      setCvError(t.apply.errors.cvType);
      toast.error(t.apply.errors.cvType);
      return;
    }
    if (file.size > CV_MAX_BYTES) {
      setCvError(t.apply.errors.cvSize);
      toast.error(t.apply.errors.cvSize);
      return;
    }
    setCvFile(file);
    setCvError(null);
  }

  function acceptIntro(file: File | null) {
    if (!file) return;
    const typeOk =
      file.type.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(file.name);
    if (!typeOk) {
      setIntroError(t.apply.errors.introType);
      toast.error(t.apply.errors.introType);
      return;
    }
    if (file.size > INTRO_MAX_BYTES) {
      setIntroError(t.apply.errors.introSize);
      toast.error(t.apply.errors.introSize);
      return;
    }
    setIntroFile(file);
    setIntroError(null);
  }

  function onCvInput(event: ChangeEvent<HTMLInputElement>) {
    acceptCv(event.target.files?.[0] ?? null);
    event.target.value = "";
  }

  function onIntroInput(event: ChangeEvent<HTMLInputElement>) {
    acceptIntro(event.target.files?.[0] ?? null);
    event.target.value = "";
  }

  function acceptExtra(index: number, file: File | null) {
    if (!file) return;
    const label = customDocs[index] ?? "dokumen";
    if (!isAllowedExtraDoc(file)) {
      const msg = fillTemplate(t.apply.uploads.extraDocType, { label });
      setExtraErrors((prev) => ({ ...prev, [index]: msg }));
      toast.error(msg);
      return;
    }
    if (file.size > EXTRA_DOC_MAX_BYTES) {
      const msg = fillTemplate(t.apply.uploads.extraDocSize, { label });
      setExtraErrors((prev) => ({ ...prev, [index]: msg }));
      toast.error(msg);
      return;
    }
    setExtraFiles((prev) => ({ ...prev, [index]: file }));
    setExtraErrors((prev) => ({ ...prev, [index]: undefined }));
  }

  function onExtraInput(index: number) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      acceptExtra(index, event.target.files?.[0] ?? null);
      event.target.value = "";
    };
  }

  function onDropFactory(
    acceptor: (file: File | null) => void,
    setDragging: (value: boolean) => void,
  ) {
    return (event: DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragging(false);
      acceptor(event.dataTransfer.files?.[0] ?? null);
    };
  }

  /**
   * Pengiriman sesungguhnya. Hanya dipanggil setelah pengguna melihat pratinjau
   * dan menekan konfirmasi pada dialog — tidak pernah kirim otomatis.
   */
  async function doSubmit() {
    if (recruitmentClosed) {
      // Pengaman ekstra: jangan kirim bila rekrutmen ditutup di tengah alur.
      toast.error(
        recruitmentClosedMessage.trim() ||
          "Rekrutmen sedang ditutup. Lamaran tidak dapat dikirim saat ini.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("name", values.name.trim());
      fd.append("email", values.email.trim());
      fd.append("phone", values.phone.trim());
      if (positionId) fd.append("positionId", positionId);
      if (values.portfolioUrl.trim())
        fd.append("portfolioUrl", values.portfolioUrl.trim());
      if (values.socialLinks.trim())
        fd.append("socialLinks", values.socialLinks.trim());
      fd.append("experience", values.experience.trim());
      fd.append("motivation", values.motivation.trim());
      // Anti-spam (Task 27): honeypot + waktu buka formulir — diverifikasi server.
      fd.append("website", websiteRef.current?.value ?? "");
      fd.append("formStartedAt", String(formStartedAtRef.current));
      // Persetujuan pemrosesan data pribadi (Task 27).
      fd.append("consent", consented ? "1" : "0");
      // Jawaban screening posisi (JSON {questionId: jawaban}) — hanya yang terisi.
      // Mode skema aktif: screening klasik DIABAIKAN (diganti formAnswers).
      if (!schema && screeningQuestions.length > 0) {
        const record: Record<string, string> = {};
        for (const question of screeningQuestions) {
          const answer = (screeningAnswers[question.id] ?? "").trim();
          if (answer) record[question.id] = answer.slice(0, SCREENING_MAX);
        }
        fd.append("screeningAnswers", JSON.stringify(record));
      }
      // Sumber pelamar + UTM dari URL saat halaman dibuka.
      if (source) fd.append("source", source);
      if (utm.source) fd.append("utmSource", utm.source);
      if (utm.medium) fd.append("utmMedium", utm.medium);
      if (utm.campaign) fd.append("utmCampaign", utm.campaign);
      if (cvFile) fd.append("cvFile", cvFile);
      if (introFile) fd.append("introFile", introFile);
      if (schema) {
        // Form Builder: jawaban non-berkas sebagai JSON {fieldId: nilai}; nilai
        // "Lainnya" dikirim sebagai teks bebas (server menerima bila allowOther).
        const record: Record<string, string | string[] | number> = {};
        for (const field of schema.fields) {
          if (field.type === "file") continue;
          const value = formAnswers[field.id];
          if (value === undefined || value instanceof File) continue;
          if (typeof value === "string") {
            const text = value.trim();
            if (!text || text === FORM_OTHER_VALUE) continue;
            record[field.id] = text;
            continue;
          }
          if (Array.isArray(value)) {
            const items = value
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.trim())
              .filter((item) => item !== "" && item !== FORM_OTHER_VALUE);
            if (items.length > 0) record[field.id] = items;
            continue;
          }
          if (typeof value === "number" && Number.isFinite(value)) {
            record[field.id] = value;
          }
        }
        fd.append("formAnswers", JSON.stringify(record));
        // Tiap berkas field dikirim sebagai part formFile_<fieldId>.
        for (const field of schema.fields) {
          if (field.type !== "file") continue;
          const file = formAnswers[field.id];
          if (file instanceof File) fd.append(`formFile_${field.id}`, file);
        }
      } else {
        // Dokumen wajib tambahan (mode klasik) — urutan pengiriman dipasangkan
        // dengan urutan customDocs posisi di server (extraDoc_0, extraDoc_1, ...).
        for (let i = 0; i < customDocs.length; i++) {
          const file = extraFiles[i];
          if (file) fd.append(`extraDoc_${i}`, file);
        }
      }

      const res = await fetch("/api/applications", { method: "POST", body: fd });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        // Termasuk 409 kuota penuh — pesan spesifik dari server ditampilkan apa adanya.
        const serverError =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : null;
        toast.error(serverError || t.apply.errors.submitFailed);
        return;
      }
      const successData: ApplySuccessResponse | null =
        typeof data === "object" &&
        data !== null &&
        "ok" in data &&
        (data as { ok: unknown }).ok === true
          ? (data as ApplySuccessResponse)
          : null;
      const trackingCode = successData?.trackingCode ?? "";

      submittedRef.current = true;
      // Pelacakan (Task 27): lamaran terkirim — event "submit" pada langkah terakhir.
      trackStep("submit", previewStep + 1);
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // abaikan
      }
      setSuccess({
        name: values.name.trim(),
        trackingCode,
        autoReply: successData?.autoReply ?? null,
        assignment: successData?.assignment ?? null,
      });
      toast.success(t.apply.success.title);
    } catch {
      toast.error(t.apply.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // Langkah sebelum Berkas (0-1 + langkah section skema): validasi lalu maju.
    if (step < filesStep) {
      goNext();
      return;
    }

    // Langkah Berkas: validasi semuanya (termasuk berkas wajib), lalu pratinjau.
    if (step === filesStep) {
      if (!validateAllAndJump()) return;
      if (!validateRequiredFiles()) return;
      goToStep(previewStep);
      trackStep("advance", previewStep);
      return;
    }

    // Langkah Pratinjau: wajib pernyataan kebenaran data sebelum konfirmasi.
    if (!agreed) {
      toast.error(t.apply.preview.agreeRequired);
      return;
    }
    if (!consented) {
      toast.error(t.apply.preview.consentRequired);
      return;
    }
    if (recruitmentClosed) {
      toast.error(
        recruitmentClosedMessage.trim() ||
          "Rekrutmen sedang ditutup. Lamaran tidak dapat dikirim saat ini.",
      );
      return;
    }
    setConfirmOpen(true);
  }

  function resetForm() {
    submittedRef.current = false;
    draftDismissedRef.current = false;
    setValues(INITIAL_VALUES);
    setErrors({});
    setStep(0);
    setSuccess(null);
    setCvFile(null);
    setIntroFile(null);
    setCvError(null);
    setIntroError(null);
    setAgreed(false);
    setConsented(false);
    setConfirmOpen(false);
    setDirection(1);
    setSource("");
    setScreeningAnswers({});
    setFormAnswers({});
    setFormErrors({});
    // Saat lockPosition, posisi milik halaman detail — jangan direset.
    if (!lockPosition) onPositionIdChange("");
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // abaikan
    }
  }

  function restoreDraft() {
    if (!draft) return;
    const restored: FormValues = { ...INITIAL_VALUES };
    for (const key of VALUE_KEYS) {
      const raw = draft.values?.[key];
      if (typeof raw === "string") restored[key] = raw;
    }
    setValues(restored);
    draftDismissedRef.current = false;
    // Jawaban form (Form Builder) hanya dipulihkan bila draf milik posisi yang
    // sama — posisi berbeda berarti skema formulir berbeda.
    if (
      draft.formAnswers &&
      typeof draft.positionId === "string" &&
      draft.positionId === positionId
    ) {
      const restoredAnswers: Record<string, string | string[] | number> = {};
      for (const [key, value] of Object.entries(draft.formAnswers)) {
        if (typeof value === "string" || typeof value === "number") {
          restoredAnswers[key] = value;
          continue;
        }
        if (Array.isArray(value)) {
          const items = value.filter((item): item is string => typeof item === "string");
          if (items.length > 0) restoredAnswers[key] = items;
        }
      }
      setFormAnswers(restoredAnswers);
    }
    // Saat lockPosition, posisi tetap milik halaman detail (draft bisa dari
    // posisi lain — jangan menimpa posisi terkunci).
    if (
      !lockPosition &&
      typeof draft.positionId === "string" &&
      positions.some((p) => p.id === draft.positionId)
    ) {
      onPositionIdChange(draft.positionId);
    }
    setDraft(null);
    toast.success(t.apply.draft.title);
  }

  function discardDraft() {
    draftDismissedRef.current = true;
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      // abaikan
    }
    setDraft(null);
  }

  async function copyTrackingCode() {
    if (!success?.trackingCode) return;
    try {
      await navigator.clipboard.writeText(success.trackingCode);
      toast.success(t.apply.success.copied);
    } catch {
      toast.error(t.apply.errors.submitFailed);
    }
  }

  function goToStatus() {
    document.getElementById("status")?.scrollIntoView({ behavior: "smooth" });
  }

  if (success) {
    const briefUrl = safeExternalUrl(success.assignment?.url ?? "");
    return (
      <motion.div
        role="status"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex flex-col items-center justify-center gap-4 py-8 text-center"
      >
        <motion.div
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
          className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15"
        >
          <CheckCircle2
            className="h-12 w-12 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        </motion.div>
        <h3 className="text-2xl font-bold">{t.apply.success.title}</h3>
        <p className="text-sm font-medium">
          {t.apply.success.thanksTo} {success.name}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">{t.apply.success.body}</p>

        <div className="mt-2 flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border bg-muted/40 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t.apply.success.trackingLabel}
          </p>
          <div className="flex w-full items-center justify-center gap-3">
            <code className="rounded-lg bg-background px-4 py-2 font-mono text-xl tracking-widest sm:text-2xl">
              {success.trackingCode || "-"}
            </code>
            <Button
              variant="outline"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label={t.apply.success.copy}
              onClick={() => void copyTrackingCode()}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t.apply.success.saveNote}</p>
        </div>

        {/* Pesan balasan otomatis dari template posisi (bila diatur admin) */}
        {success.autoReply && success.autoReply.trim() ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.15, ease: "easeOut" }}
            className="w-full max-w-md rounded-2xl border border-rose-200 bg-rose-50/70 p-5 text-left dark:border-rose-500/30 dark:bg-rose-500/10"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-rose-800 dark:text-rose-300">
              <MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.apply.success.autoReplyTitle}
            </p>
            <blockquote className="mt-2 border-l-2 border-rose-400/60 pl-3 text-sm leading-relaxed text-rose-900 dark:border-rose-400/40 dark:text-rose-200">
              {success.autoReply}
            </blockquote>
          </motion.div>
        ) : null}

        {/* Info tes/brief dari posisi (bila diatur admin) */}
        {success.assignment &&
        (success.assignment.title || success.assignment.note || success.assignment.url) ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.25, ease: "easeOut" }}
            className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-left dark:border-amber-500/30 dark:bg-amber-500/10"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
              <ClipboardList className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t.apply.success.nextStepsTitle}
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {success.assignment.title || t.apply.success.assignmentFallback}
            </p>
            {success.assignment.note ? (
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-amber-800/90 dark:text-amber-200/80">
                {success.assignment.note}
              </p>
            ) : null}
            {briefUrl ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-11 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 sm:h-9 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
                asChild
              >
                <a href={briefUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                  {t.apply.success.openBrief}
                </a>
              </Button>
            ) : null}
          </motion.div>
        ) : null}

        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Button onClick={goToStatus}>{t.apply.success.checkStatus}</Button>
          <Button variant="outline" onClick={resetForm}>
            {t.apply.success.another}
          </Button>
        </div>
      </motion.div>
    );
  }

  // Stepper dinamis: judul section skema disisipkan antara Pengalaman & Berkas
  // (mode klasik tetap 4 langkah).
  const stepLabels: string[] = schema
    ? [
        t.apply.steps[0],
        t.apply.steps[1],
        ...sectionSteps.map((entry) => formSectionTitle(entry.section, lang)),
        t.apply.steps[2],
        t.apply.steps[3],
      ]
    : t.apply.steps;

  return (
    <div className="@container flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold">{t.apply.formTitle}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.apply.requiredBefore} <span className="text-rose-600">*</span>{" "}
          {t.apply.requiredAfter}
        </p>
      </div>

      {draft ? (
        <Card className="flex-row items-center justify-between gap-3 rounded-xl border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t.apply.draft.title}</p>
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {t.apply.draft.body}
              {typeof draft.savedAt === "number"
                ? ` (${t.apply.draft.savedPrefix} ${new Date(draft.savedAt).toLocaleString("id-ID")})`
                : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" onClick={discardDraft}>
              {t.apply.draft.discard}
            </Button>
            <Button size="sm" onClick={restoreDraft}>
              {t.apply.draft.restore}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Stepper — label langkah hanya tampil bila lebar KARTU cukup
          (@container, bukan viewport): di kolom kanan desktop yang sempit
          hanya lingkaran + garis, tanpa label agar tidak meluber keluar kartu. */}
      <ol className="flex items-center gap-2" aria-label={t.apply.stepOf}>
        {stepLabels.map((label, index) => {
          const isDone = index < step;
          const isActive = index === step;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-current={isActive ? "step" : undefined}
                  title={label}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                    isDone &&
                      "border-emerald-500 bg-emerald-500 text-white dark:border-emerald-400 dark:bg-emerald-400 dark:text-emerald-950",
                    isActive && "border-primary ring-primary ring-offset-background ring-2",
                    !isDone && !isActive && "border-border text-muted-foreground",
                  )}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={cn(
                    "hidden min-w-0 truncate text-xs font-medium @xl:block",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              </div>
              {index < stepLabels.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px flex-1",
                    index < step ? "bg-emerald-500 dark:bg-emerald-400" : "bg-border",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {/* Anti-spam honeypot (Task 27): tersembunyi dari manusia — bot pengisi
            otomatis mendapat respons sukses palsu dari server. */}
        <div className="hidden" aria-hidden="true">
          <Label htmlFor="apply-website">Website</Label>
          <Input
            ref={websiteRef}
            id="apply-website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            className="hidden"
          />
        </div>
        {/* Time-trap (Task 27): waktu formulir dibuka — diverifikasi server. */}
        <input
          type="hidden"
          name="formStartedAt"
          value={String(formStartedAtRef.current)}
        />
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={{
              enter: (dir: number) => ({ opacity: 0, x: 36 * dir }),
              center: { opacity: 1, x: 0 },
              exit: (dir: number) => ({ opacity: 0, x: -36 * dir }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="flex flex-col gap-5"
          >
        {/* LANGKAH 1: Data Diri */}
        {step === 0 && (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="apply-name">
                  {t.apply.fields.name} <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="apply-name"
                  name="name"
                  value={values.name}
                  onChange={(e) => setField("name", e.target.value)}
                  placeholder={t.apply.fields.namePh}
                  autoComplete="name"
                  className="h-11"
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? "apply-name-error" : undefined}
                />
                {errors.name ? (
                  <p id="apply-name-error" className="text-sm text-rose-600">
                    {errors.name}
                  </p>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="apply-email">
                  {t.apply.fields.email} <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="apply-email"
                  name="email"
                  type="email"
                  value={values.email}
                  onChange={(e) => setField("email", e.target.value)}
                  placeholder={t.apply.fields.emailPh}
                  autoComplete="email"
                  className="h-11"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={errors.email ? "apply-email-error" : undefined}
                />
                {errors.email ? (
                  <p id="apply-email-error" className="text-sm text-rose-600">
                    {errors.email}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="apply-phone">
                  {t.apply.fields.phone} <span className="text-rose-600">*</span>
                </Label>
                <Input
                  id="apply-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  value={values.phone}
                  onChange={(e) => setField("phone", e.target.value)}
                  placeholder={t.apply.fields.phonePh}
                  autoComplete="tel"
                  className="h-11"
                  aria-invalid={errors.phone ? true : undefined}
                  aria-describedby={errors.phone ? "apply-phone-error" : undefined}
                />
                {errors.phone ? (
                  <p id="apply-phone-error" className="text-sm text-rose-600">
                    {errors.phone}
                  </p>
                ) : null}
              </div>

              {/* Pemilih posisi disembunyikan saat lockPosition — posisi tetap
                  dari halaman detail (positionId sudah ditentukan di atas). */}
              {!lockPosition ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="apply-position">
                    {t.apply.fields.position} <span className="text-rose-600">*</span>
                  </Label>
                  <Select
                    value={positionId || undefined}
                    onValueChange={(value) => {
                      onPositionIdChange(value);
                      clearPositionError();
                    }}
                    disabled={positions.length === 0}
                  >
                    <SelectTrigger
                      id="apply-position"
                      className="h-11 w-full"
                      aria-invalid={errors.positionId ? true : undefined}
                      aria-describedby={
                        errors.positionId ? "apply-position-error" : undefined
                      }
                    >
                      <SelectValue
                        placeholder={
                          positions.length === 0
                            ? t.apply.fields.positionEmpty
                            : t.apply.fields.positionPh
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {positions.map((position) => (
                        <SelectItem key={position.id} value={position.id}>
                          {position.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.positionId ? (
                    <p id="apply-position-error" className="text-sm text-rose-600">
                      {errors.positionId}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Sumber pelamar (opsional) — membantu pemilik melacak kanal rekrutmen */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-source">{t.apply.fields.source}</Label>
              <Select
                value={source || undefined}
                onValueChange={(value) => setSource(value)}
              >
                <SelectTrigger id="apply-source" className="h-11 w-full">
                  <SelectValue placeholder={t.apply.fields.sourcePh} />
                </SelectTrigger>
                <SelectContent>
                  {APPLICATION_SOURCES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* LANGKAH 2: Pengalaman */}
        {step === 1 && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-experience">
                {t.apply.fields.experience} <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                id="apply-experience"
                name="experience"
                rows={4}
                value={values.experience}
                onChange={(e) => setField("experience", e.target.value)}
                placeholder={t.apply.fields.experiencePh}
                aria-invalid={errors.experience ? true : undefined}
                aria-describedby={
                  errors.experience ? "apply-experience-error" : undefined
                }
              />
              {errors.experience ? (
                <p id="apply-experience-error" className="text-sm text-rose-600">
                  {errors.experience}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-motivation">
                {t.apply.fields.motivation} <span className="text-rose-600">*</span>
              </Label>
              <Textarea
                id="apply-motivation"
                name="motivation"
                rows={4}
                value={values.motivation}
                onChange={(e) => setField("motivation", e.target.value)}
                placeholder={t.apply.fields.motivationPh}
                aria-invalid={errors.motivation ? true : undefined}
                aria-describedby={
                  errors.motivation ? "apply-motivation-error" : undefined
                }
              />
              {errors.motivation ? (
                <p id="apply-motivation-error" className="text-sm text-rose-600">
                  {errors.motivation}
                </p>
              ) : null}
            </div>

            {/* Pertanyaan screening khusus posisi terpilih (v3) — hanya mode
                klasik; skema aktif menggantikannya dengan langkah dinamis */}
            {!schema && screeningQuestions.length > 0 ? (
              <div className="flex flex-col gap-4 rounded-xl border bg-muted/40 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <ClipboardList
                    className="h-4 w-4 text-rose-600 dark:text-rose-400"
                    aria-hidden="true"
                  />
                  {t.apply.screening.sectionTitle}
                </p>
                {screeningQuestions.map((question, index) => {
                  const errorKey =
                    `${SCREENING_KEY_PREFIX}${question.id}` as FieldKey;
                  const error = errors[errorKey];
                  return (
                    <div
                      key={question.id}
                      id={`apply-screening-${question.id}`}
                      className="flex scroll-mt-24 flex-col gap-2"
                    >
                      <Label htmlFor={`apply-screening-${question.id}-input`}>
                        {index + 1}. {question.label}{" "}
                        {question.required ? (
                          <span className="font-normal text-rose-600">
                            {t.apply.screening.requiredMark}
                          </span>
                        ) : (
                          <span className="text-xs font-normal text-muted-foreground">
                            ({t.apply.uploads.optional})
                          </span>
                        )}
                      </Label>
                      <Textarea
                        id={`apply-screening-${question.id}-input`}
                        rows={2}
                        value={screeningAnswers[question.id] ?? ""}
                        onChange={(e) => setAnswer(question.id, e.target.value)}
                        maxLength={SCREENING_MAX}
                        placeholder={t.apply.screening.answerPh}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={
                          error ? `apply-screening-${question.id}-error` : undefined
                        }
                        className={cn(
                          error &&
                            "border-rose-400 focus-visible:ring-rose-400/40 dark:border-rose-500",
                        )}
                      />
                      {error ? (
                        <p
                          id={`apply-screening-${question.id}-error`}
                          className="text-sm text-rose-600"
                        >
                          {error}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="apply-portfolio">{t.apply.fields.portfolio}</Label>
                <Input
                  id="apply-portfolio"
                  name="portfolioUrl"
                  type="url"
                  value={values.portfolioUrl}
                  onChange={(e) => setField("portfolioUrl", e.target.value)}
                  placeholder="https://..."
                  className="h-11"
                  aria-invalid={errors.portfolioUrl ? true : undefined}
                  aria-describedby={
                    errors.portfolioUrl ? "apply-portfolio-error" : undefined
                  }
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="apply-social">{t.apply.fields.social}</Label>
                <Input
                  id="apply-social"
                  name="socialLinks"
                  type="url"
                  value={values.socialLinks}
                  onChange={(e) => setField("socialLinks", e.target.value)}
                  placeholder="https://instagram.com/..."
                  className="h-11"
                />
              </div>

              {/* Posisi tertentu mewajibkan salah satu diisi */}
              {errors.portfolioUrl ? (
                <p
                  id="apply-portfolio-error"
                  className="text-sm text-rose-600 sm:col-span-2"
                >
                  {errors.portfolioUrl}
                </p>
              ) : null}
            </div>
          </div>
        )}

        {/* LANGKAH DINAMIS: satu langkah per bagian Form Builder (mode skema
            aktif) — section tanpa field dilewati dan tidak menjadi langkah. */}
        {sectionSteps.map((entry) =>
          step === entry.stepIndex ? (
            <div key={entry.section.id} className="flex flex-col gap-5">
              <div className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold">
                  {formSectionTitle(entry.section, lang)}
                </p>
                {entry.section.description ? (
                  <p className="text-xs text-muted-foreground">
                    {entry.section.description}
                  </p>
                ) : null}
              </div>
              {entry.fields.map((field) => (
                <FormFieldRenderer
                  key={field.id}
                  field={field}
                  value={formAnswers[field.id]}
                  error={formErrors[`${FORM_KEY_PREFIX}${field.id}`]}
                  onAnswer={handleFormAnswer}
                  onAnswerError={handleFormAnswerError}
                />
              ))}
            </div>
          ) : null,
        )}

        {/* LANGKAH BERKAS: CV & audio perkenalan (mode klasik: langkah ke-3;
            mode skema: setelah semua langkah section) */}
        {step === filesStep && (
          <div className="flex flex-col gap-5">

            {/* Dropzone CV */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-cv" className="gap-2">
                {t.apply.uploads.cvLabel}
                <span
                  className={cn(
                    "text-xs font-normal",
                    selectedPosition?.requireCv
                      ? "text-rose-600"
                      : "text-muted-foreground",
                  )}
                >
                  ({selectedPosition?.requireCv ? t.apply.uploads.required : t.apply.uploads.optional})
                </span>
              </Label>
              {selectedPosition?.requireCv ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t.apply.uploads.cvRequiredHint}
                </p>
              ) : null}
              <label
                htmlFor="apply-cv"
                onDragOver={(e) => {
                  e.preventDefault();
                  setCvDragging(true);
                }}
                onDragLeave={() => setCvDragging(false)}
                onDrop={onDropFactory(acceptCv, setCvDragging)}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center transition-colors",
                  cvDragging
                    ? "border-primary bg-rose-50 dark:bg-rose-500/10"
                    : "hover:bg-accent/50",
                  cvError && "border-rose-400 dark:border-rose-500",
                )}
              >
                <Upload className="h-6 w-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">
                  {t.apply.uploads.dropHint}
                </span>
                <input
                  id="apply-cv"
                  name="cvFile"
                  type="file"
                  accept=".pdf,application/pdf"
                  className="sr-only"
                  onChange={onCvInput}
                />
              </label>
              {cvFile ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText
                      className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                    <span className="truncate">{cvFile.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatMb(cvFile.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={t.apply.uploads.remove}
                    onClick={() => setCvFile(null)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
              {cvError ? <p className="text-sm text-rose-600">{cvError}</p> : null}
            </div>

            {/* Dropzone Intro Audio */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-intro" className="gap-2">
                {t.apply.uploads.introLabel}
                <span
                  className={cn(
                    "text-xs font-normal",
                    selectedPosition?.requireIntro
                      ? "text-rose-600"
                      : "text-muted-foreground",
                  )}
                >
                  ({selectedPosition?.requireIntro ? t.apply.uploads.required : t.apply.uploads.optional})
                </span>
              </Label>
              {selectedPosition?.requireIntro ? (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {t.apply.uploads.introRequiredHint}
                </p>
              ) : null}
              <label
                htmlFor="apply-intro"
                onDragOver={(e) => {
                  e.preventDefault();
                  setIntroDragging(true);
                }}
                onDragLeave={() => setIntroDragging(false)}
                onDrop={onDropFactory(acceptIntro, setIntroDragging)}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-6 text-center transition-colors",
                  introDragging
                    ? "border-primary bg-rose-50 dark:bg-rose-500/10"
                    : "hover:bg-accent/50",
                  introError && "border-rose-400 dark:border-rose-500",
                )}
              >
                <Mic className="h-6 w-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                <span className="text-sm text-muted-foreground">
                  {t.apply.uploads.dropHint}
                </span>
                <input
                  id="apply-intro"
                  name="introFile"
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a"
                  className="sr-only"
                  onChange={onIntroInput}
                />
              </label>
              {introFile ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <Mic
                      className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                    <span className="truncate">{introFile.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatMb(introFile.size)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={t.apply.uploads.remove}
                    onClick={() => setIntroFile(null)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : null}
              {introError ? (
                <p className="text-sm text-rose-600">{introError}</p>
              ) : null}
            </div>

            {/* Dokumen wajib tambahan milik posisi (customDocs) — hanya mode
                klasik; skema aktif memakai field file milik skema */}
            {!schema && customDocs.length > 0 ? (
              <div className="flex flex-col gap-3 rounded-2xl border bg-zinc-50/60 p-4 dark:bg-zinc-900/40">
                <div>
                  <p className="text-sm font-semibold">
                    {t.apply.uploads.extraDocsTitle}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t.apply.uploads.extraDocsDesc}
                  </p>
                </div>
                {customDocs.map((label, index) => {
                  const file = extraFiles[index];
                  const error = extraErrors[index];
                  const dragging = extraDraggingIdx === index;
                  return (
                    <div key={`${label}-${index}`} className="flex flex-col gap-2">
                      <Label htmlFor={`apply-extra-${index}`} className="gap-2">
                        {label}
                        <span className="text-xs font-normal text-rose-600">
                          ({t.apply.uploads.required})
                        </span>
                      </Label>
                      <label
                        htmlFor={`apply-extra-${index}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setExtraDraggingIdx(index);
                        }}
                        onDragLeave={() =>
                          setExtraDraggingIdx((prev) => (prev === index ? null : prev))
                        }
                        onDrop={(e) => {
                          e.preventDefault();
                          setExtraDraggingIdx(null);
                          acceptExtra(index, e.dataTransfer.files?.[0] ?? null);
                        }}
                        className={cn(
                          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-center transition-colors",
                          dragging
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
                          {t.apply.uploads.dropHint}
                        </span>
                        <input
                          id={`apply-extra-${index}`}
                          name={`extraDoc_${index}`}
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/*"
                          className="sr-only"
                          onChange={onExtraInput(index)}
                        />
                      </label>
                      {file ? (
                        <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2 text-sm">
                            <FileText
                              className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                              aria-hidden="true"
                            />
                            <span className="truncate">{file.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatMb(file.size)}
                            </span>
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            aria-label={t.apply.uploads.remove}
                            onClick={() =>
                              setExtraFiles((prev) => {
                                const next = { ...prev };
                                delete next[index];
                                return next;
                              })
                            }
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </div>
                      ) : null}
                      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {t.apply.trust[0]}
            </p>
          </div>
        )}

        {/* LANGKAH PRATINJAU: Pratinjau & Konfirmasi — lamaran tidak terkirim otomatis */}
        {step === previewStep && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-primary/30 bg-rose-50/70 p-4 dark:border-primary/40 dark:bg-primary/10">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Eye
                  className="h-4 w-4 text-rose-600 dark:text-rose-400"
                  aria-hidden="true"
                />
                {t.apply.preview.title}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t.apply.preview.desc}
              </p>
            </div>

            <PreviewSection
              title={t.apply.preview.sectionPersonal}
              editLabel={t.apply.preview.edit}
              onEdit={() => goToStep(0)}
            >
              <PreviewRow
                label={t.apply.summary.name}
                value={values.name}
                fallback={t.apply.preview.notFilled}
              />
              <PreviewRow
                label={t.apply.summary.email}
                value={values.email}
                fallback={t.apply.preview.notFilled}
              />
              <PreviewRow
                label={t.apply.summary.phone}
                value={values.phone}
                fallback={t.apply.preview.notFilled}
              />
              <PreviewRow
                label={t.apply.summary.position}
                value={selectedPosition?.title ?? ""}
                fallback={t.apply.summary.notChosen}
              />
              {/* Sumber pelamar — tampil hanya bila diisi */}
              {source ? (
                <PreviewRow
                  label={t.apply.fields.source}
                  value={source}
                  fallback={t.apply.preview.notFilled}
                />
              ) : null}
            </PreviewSection>

            <PreviewSection
              title={t.apply.preview.sectionAnswers}
              editLabel={t.apply.preview.edit}
              onEdit={() => goToStep(1)}
            >
              <PreviewRow
                label={t.apply.fields.experience}
                value={values.experience}
                fallback={t.apply.preview.notFilled}
              />
              <PreviewRow
                label={t.apply.fields.motivation}
                value={values.motivation}
                fallback={t.apply.preview.notFilled}
              />
              <PreviewRow
                label={t.apply.fields.portfolio}
                value={values.portfolioUrl}
                fallback={t.apply.preview.notFilled}
              />
              <PreviewRow
                label={t.apply.fields.social}
                value={values.socialLinks}
                fallback={t.apply.preview.notFilled}
              />
            </PreviewSection>

            {/* Jawaban Form Builder — satu kartu per bagian skema, tombol Ubah
                menuju langkah section terkait (mode skema aktif) */}
            {schema
              ? sectionSteps.map((entry) => (
                  <PreviewSection
                    key={entry.section.id}
                    title={formSectionTitle(entry.section, lang)}
                    editLabel={t.apply.preview.edit}
                    onEdit={() => goToStep(entry.stepIndex)}
                  >
                    {entry.fields.map((field) => {
                      const value = formAnswers[field.id];
                      let display = "";
                      if (field.type === "file") {
                        display =
                          value instanceof File
                            ? `${value.name} (${formatMb(value.size)})`
                            : "";
                      } else if (Array.isArray(value)) {
                        display = formatAnswerValue(
                          value.filter((item) => item !== FORM_OTHER_VALUE),
                        );
                      } else if (typeof value === "string") {
                        display = value === FORM_OTHER_VALUE ? "" : value;
                      } else if (typeof value === "number") {
                        display = formatAnswerValue(value);
                      }
                      return (
                        <PreviewRow
                          key={field.id}
                          label={formFieldLabel(field, lang)}
                          value={display}
                          fallback={
                            field.type === "file"
                              ? t.apply.preview.noFile
                              : t.apply.preview.notAnswered
                          }
                        />
                      );
                    })}
                  </PreviewSection>
                ))
              : null}

            {/* Jawaban screening posisi — hanya bila posisi punya pertanyaan (mode klasik) */}
            {!schema && screeningQuestions.length > 0 ? (
              <PreviewSection
                title={t.apply.preview.sectionScreening}
                editLabel={t.apply.preview.edit}
                onEdit={() => goToStep(1)}
              >
                {screeningQuestions.map((question) => (
                  <PreviewRow
                    key={question.id}
                    label={question.label}
                    value={screeningAnswers[question.id] ?? ""}
                    fallback={t.apply.preview.notAnswered}
                  />
                ))}
              </PreviewSection>
            ) : null}

            <PreviewSection
              title={t.apply.preview.sectionFiles}
              editLabel={t.apply.preview.edit}
              onEdit={() => goToStep(2)}
            >
              <div className="flex items-center gap-2.5 text-sm">
                <FileText
                  className={cn(
                    "h-4 w-4 shrink-0",
                    cvFile
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground/50",
                  )}
                  aria-hidden="true"
                />
                {cvFile ? (
                  <span className="min-w-0 truncate font-medium">
                    {cvFile.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatMb(cvFile.size)})
                    </span>
                  </span>
                ) : (
                  <span className="italic text-muted-foreground/70">
                    {t.apply.preview.noFile}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  ({selectedPosition?.requireCv ? t.apply.uploads.required : t.apply.uploads.optional})
                </span>
              </div>
              <div className="flex items-center gap-2.5 text-sm">
                <Mic
                  className={cn(
                    "h-4 w-4 shrink-0",
                    introFile
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-muted-foreground/50",
                  )}
                  aria-hidden="true"
                />
                {introFile ? (
                  <span className="min-w-0 truncate font-medium">
                    {introFile.name}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({formatMb(introFile.size)})
                    </span>
                  </span>
                ) : (
                  <span className="italic text-muted-foreground/70">
                    {t.apply.preview.noFile}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  ({selectedPosition?.requireIntro ? t.apply.uploads.required : t.apply.uploads.optional})
                </span>
              </div>
              {/* Dokumen wajib tambahan — pratinjau berkas terunggah per label
                  (hanya mode klasik; skema aktif diringkas di kartu section) */}
              {!schema
                ? customDocs.map((label, index) => {
                const file = extraFiles[index];
                return (
                  <div key={`${label}-${index}`} className="flex items-center gap-2.5 text-sm">
                    <FileText
                      className={cn(
                        "h-4 w-4 shrink-0",
                        file
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {label}
                      {file ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {file.name} ({formatMb(file.size)})
                        </span>
                      ) : (
                        <span className="ml-2 text-xs italic text-muted-foreground/70">
                          {t.apply.preview.notFilled}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      ({t.apply.uploads.required})
                    </span>
                  </div>
                );
                })
              : null}
            </PreviewSection>

            {/* Pernyataan kebenaran data — wajib dicentang sebelum konfirmasi */}
            <div
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 transition-colors",
                agreed
                  ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                  : "border-border",
              )}
            >
              <Checkbox
                id="apply-agree"
                checked={agreed}
                onCheckedChange={(checked) => setAgreed(checked === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="apply-agree"
                className="cursor-pointer text-sm font-normal leading-relaxed"
              >
                {t.apply.preview.agreeLabel}
              </Label>
            </div>

            {/* Persetujuan pemrosesan data pribadi (Task 27) — wajib sebelum kirim */}
            <div
              className={cn(
                "flex flex-col gap-1 rounded-xl border p-4 transition-colors",
                consented
                  ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/40 dark:bg-emerald-500/10"
                  : "border-border",
              )}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  id="apply-consent"
                  checked={consented}
                  onCheckedChange={(checked) => setConsented(checked === true)}
                  className="mt-0.5"
                />
                <Label
                  htmlFor="apply-consent"
                  className="cursor-pointer text-sm font-normal leading-relaxed"
                >
                  {t.apply.preview.consentLabel}
                </Label>
              </div>
              <p className="pl-7 text-xs text-muted-foreground">
                {t.apply.preview.consentNote}
              </p>
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              {t.apply.preview.privacyNote}
            </p>
          </div>
        )}
          </motion.div>
        </AnimatePresence>

        {/* Notifikasi rekrutmen ditutup — langkah akhir (pratinjau) */}
        {step === previewStep && recruitmentClosed ? (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <PauseCircle
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
              aria-hidden="true"
            />
            <span>
              {recruitmentClosedMessage.trim() ||
                "Rekrutmen sedang ditutup. Pengiriman lamaran dinonaktifkan sementara."}
            </span>
          </div>
        ) : null}

        {/* Navigasi langkah */}
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={goBack}
            disabled={step === 0 || submitting}
          >
            {t.apply.buttons.back}
          </Button>

          {step < filesStep ? (
            <Button type="submit" className="h-11 min-w-32">
              {t.apply.buttons.next}
            </Button>
          ) : step === filesStep ? (
            <Button type="submit" className="h-11 min-w-40">
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t.apply.buttons.review}
            </Button>
          ) : (
            <Button
              type="submit"
              className="h-11 min-w-40"
              disabled={submitting || recruitmentClosed}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  {t.apply.buttons.submitting}
                </>
              ) : (
                t.apply.buttons.submit
              )}
            </Button>
          )}
        </div>

        {/* Dialog konfirmasi akhir — lamaran hanya terkirim setelah tombol ini ditekan */}
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            if (!submitting) setConfirmOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.apply.preview.confirmTitle}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.apply.preview.confirmDesc}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>
                {t.apply.preview.confirmCancel}
              </AlertDialogCancel>
              <AlertDialogAction
                disabled={submitting}
                onClick={(event) => {
                  event.preventDefault();
                  void doSubmit().finally(() => setConfirmOpen(false));
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {t.apply.buttons.submitting}
                  </>
                ) : (
                  t.apply.preview.confirmYes
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </form>
    </div>
  );
}
