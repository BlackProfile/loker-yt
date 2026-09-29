"use client";

// Form Builder per Posisi — halaman penuh 3 tab (ala Google Forms, bahasa desain
// Lumina): Pertanyaan (penyusun skema), Jawaban (statistik + ekspor CSV), dan
// Setelan (buka/tutup, berkas wajib, kuota, tanggal).
// Skema disimpan via PUT /api/admin/positions/{id}/form; jawaban dibaca dari
// /api/admin/positions/{id}/form-responses (JSON/CSV). Halaman ini tidak pernah
// memakai popup untuk navigasi utama — Kembali berupa full-page (onBack).
// Kontrak skema ada di src/lib/form-schema.ts (client-safe).

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Briefcase,
  ClipboardList,
  Copy,
  Eye,
  FileDown,
  FileText,
  Inbox,
  ListChecks,
  Loader2,
  Lock,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  FORM_FIELD_TYPES,
  FORM_FIELD_TYPE_LABELS,
  FORM_LIMITS,
  isChoiceType,
  newFormId,
  type FormAnswerValue,
  type FormField,
  type FormFieldType,
  type FormSchema,
  type FormSection,
} from "@/lib/form-schema";
import { STATUS_LABELS, type ApplicationStatus, type Position } from "@/lib/types";
import { ApiError, apiGet, apiPatch, apiPost, apiPut } from "./api";
import { formatDateTime, isoToLocalInput, localInputToIso } from "./format";
import { useAdminSession } from "./admin-context";
import { Reveal } from "./motion-primitives";
import { RatingStars } from "./rating-stars";
import { cn } from "@/lib/utils";

type BuilderTab = "pertanyaan" | "jawaban" | "setelan";

/* ------------------------- Kontrak form-responses ------------------------- */

type ChoiceStat = {
  fieldId: string;
  kind: "choices";
  filled: number;
  counts: Record<string, number>;
  otherCount: number;
};
type RatingStat = {
  fieldId: string;
  kind: "rating";
  filled: number;
  counts: number[];
  avg: number | null;
};
type FilesStat = {
  fieldId: string;
  kind: "files";
  filled: number;
  files: { filename: string; fileId: string; name: string }[];
};
type TextStat = {
  fieldId: string;
  kind: "text";
  filled: number;
  samples: { name: string; value: string; trackingCode: string | null }[];
};
type FieldStat = ChoiceStat | RatingStat | FilesStat | TextStat;

type FormResponsesData = {
  total: number;
  fields: FieldStat[];
  retired: { id: string; label: string }[];
  recent: {
    id: string;
    trackingCode: string | null;
    name: string;
    email: string;
    status: string;
    createdAt: string;
    answers: Record<string, FormAnswerValue>;
  }[];
};

type FormPutResponse = { schema: FormSchema | null; position: Position };
type AiQuestionsResponse = { questions: { id?: string; label: string; required?: boolean }[] };

/* -------------------------------- Utilitas -------------------------------- */

/** Skema kosong untuk posisi tanpa konten klasik: satu bagian siap isi. */
function emptySchema(): FormSchema {
  return {
    version: 1,
    sections: [{ id: newFormId("sec"), title: "Bagian 1" }],
    fields: [],
    retiredFields: [],
  };
}

/** Bagian & pertanyaan saja — dasar perbandingan "dirty" (retired diurus server). */
function editableFingerprint(schema: FormSchema | null): string {
  return JSON.stringify({ sections: schema?.sections ?? [], fields: schema?.fields ?? [] });
}

/** ISO (bisa null) -> yyyy-mm-dd untuk <input type="date"> (zona lokal). */
function dateInputFromIso(iso: string | null | undefined): string {
  return isoToLocalInput(iso).slice(0, 10);
}

/** yyyy-mm-dd -> ISO. publishAt mulai hari, closesAt akhir hari (23:59:59 lokal). */
function isoFromDateInput(value: string, endOfDay: boolean): string | null {
  if (!value) return null;
  return localInputToIso(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
}

function labelForStatus(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
}

/** Bar proporsi pola drop-off analytics: CSS murni, lebar %, minimum terlihat. */
function barWidth(count: number, total: number): string {
  if (total <= 0 || count <= 0) return "0%";
  return `${Math.min(100, Math.max(Math.round((count / total) * 100), 2))}%`;
}

/* --------------------------------- Ikon kecil --------------------------------- */

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Kartu blok statis (Data Diri / Pengalaman / Berkas) yang tidak bisa diedit. */
function StaticBlockCard({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof User;
  title: string;
  hint: string;
}) {
  return (
    <Card className="gap-1.5 rounded-2xl border-dashed p-4 md:p-5">
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <p className="text-sm font-semibold">{title}</p>
        <Lock className="ml-auto size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

/* ------------------------------- Kartu field ------------------------------- */

function FieldEditorCard({
  field,
  canMoveUp,
  canMoveDown,
  canMutate,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: FormField;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canMutate: boolean;
  onChange: (patch: Partial<FormField>) => void;
  onMove: (dir: 1 | -1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const labelInvalid =
    field.label.trim().length > 0 && field.label.trim().length < FORM_LIMITS.labelMin;

  function setOption(index: number, value: string) {
    const options = [...field.options];
    options[index] = value;
    onChange({ options });
  }
  function addOption() {
    if (field.options.length >= FORM_LIMITS.maxOptions) return;
    onChange({ options: [...field.options, ""] });
  }
  function removeOption(index: number) {
    onChange({ options: field.options.filter((_, i) => i !== index) });
  }
  function moveOption(index: number, dir: 1 | -1) {
    const target = index + dir;
    if (target < 0 || target >= field.options.length) return;
    const options = [...field.options];
    [options[index], options[target]] = [options[target], options[index]];
    onChange({ options });
  }

  /** Angka opsional dari Input: kosong = undefined, bukan angka = abaikan. */
  function handleOptionalNumber(key: "maxLen" | "min" | "max", raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "") {
      if (key === "maxLen") onChange({ maxLen: undefined });
      else if (key === "min") onChange({ min: undefined });
      else onChange({ max: undefined });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    if (key === "maxLen") onChange({ maxLen: parsed });
    else if (key === "min") onChange({ min: parsed });
    else onChange({ max: parsed });
  }

  function handleTypeChange(next: FormFieldType) {
    if (isChoiceType(next)) {
      const options =
        isChoiceType(field.type) && field.options.length > 0
          ? field.options
          : ["Opsi 1", "Opsi 2", "Opsi 3"];
      onChange({ type: next, options });
      return;
    }
    if (next === "rating") {
      const current =
        field.max != null && field.max >= 2 && field.max <= FORM_LIMITS.ratingMaxLimit
          ? field.max
          : FORM_LIMITS.ratingMaxDefault;
      onChange({ type: next, options: [], allowOther: false, max: current });
      return;
    }
    onChange({ type: next, options: [], allowOther: false });
  }

  const numericPlaceholder =
    field.type === "textarea" ? String(FORM_LIMITS.textareaDefaultMax) : String(FORM_LIMITS.textDefaultMax);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-3.5 shadow-xs">
      {/* Baris utama: label + tipe */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <Label className="sr-only" htmlFor={`label-${field.id}`}>
            Label pertanyaan
          </Label>
          <Input
            id={`label-${field.id}`}
            value={field.label}
            onChange={(e) => onChange({ label: e.target.value })}
            maxLength={FORM_LIMITS.labelMax}
            placeholder="Tulis pertanyaan di sini"
            aria-invalid={labelInvalid}
            className={cn("h-10", labelInvalid && "border-destructive focus-visible:ring-destructive/30")}
            disabled={!canMutate}
          />
          {labelInvalid ? (
            <p className="mt-1 text-xs text-destructive">
              Label minimal {FORM_LIMITS.labelMin} karakter.
            </p>
          ) : null}
        </div>
        <Select
          value={field.type}
          onValueChange={(v) => handleTypeChange(v as FormFieldType)}
          disabled={!canMutate}
        >
          <SelectTrigger className="h-10 w-full sm:w-48" aria-label={`Tipe pertanyaan ${field.label || "baru"}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORM_FIELD_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {FORM_FIELD_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Editor khusus per tipe */}
      {isChoiceType(field.type) ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">
              Opsi jawaban (maks. {FORM_LIMITS.maxOptions})
            </p>
            <span className="text-xs tabular-nums text-muted-foreground">
              {field.options.length}/{FORM_LIMITS.maxOptions}
            </span>
          </div>
          {field.options.map((option, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <Input
                value={option}
                onChange={(e) => setOption(index, e.target.value)}
                maxLength={FORM_LIMITS.optionMaxLen}
                placeholder={`Opsi ${index + 1}`}
                aria-label={`Opsi ${index + 1}`}
                className="h-9"
                disabled={!canMutate}
              />
              <IconButton
                icon={ArrowUp}
                label="Naikkan opsi"
                onClick={() => moveOption(index, -1)}
                disabled={!canMutate || index === 0}
              />
              <IconButton
                icon={ArrowDown}
                label="Turunkan opsi"
                onClick={() => moveOption(index, 1)}
                disabled={!canMutate || index === field.options.length - 1}
              />
              <IconButton
                icon={X}
                label="Hapus opsi"
                onClick={() => removeOption(index)}
                disabled={!canMutate}
              />
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-0.5 h-9 w-fit"
            onClick={addOption}
            disabled={!canMutate || field.options.length >= FORM_LIMITS.maxOptions}
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah Opsi
          </Button>
          <div className="mt-1 flex items-center gap-2">
            <Switch
              checked={field.allowOther}
              onCheckedChange={(checked) => onChange({ allowOther: checked })}
              disabled={!canMutate}
              aria-label="Sediakan opsi Lainnya"
            />
            <Label className="text-sm font-normal">Sediakan opsi &quot;Lainnya&quot;</Label>
          </div>
        </div>
      ) : null}

      {field.type === "text" || field.type === "textarea" || field.type === "url" ? (
        <div className="grid gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`maxlen-${field.id}`} className="text-xs text-muted-foreground">
              Batas karakter (opsional)
            </Label>
            <Input
              id={`maxlen-${field.id}`}
              type="number"
              min={1}
              max={FORM_LIMITS.textHardMax}
              value={field.maxLen != null ? String(field.maxLen) : ""}
              onChange={(e) => handleOptionalNumber("maxLen", e.target.value)}
              placeholder={numericPlaceholder}
              className="h-9"
              disabled={!canMutate}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`ph-${field.id}`} className="text-xs text-muted-foreground">
              Placeholder (opsional)
            </Label>
            <Input
              id={`ph-${field.id}`}
              value={field.placeholder ?? ""}
              onChange={(e) => onChange({ placeholder: e.target.value || undefined })}
              maxLength={FORM_LIMITS.placeholderMax}
              placeholder="Teks samaran di kolom jawaban"
              className="h-9"
              disabled={!canMutate}
            />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor={`help-${field.id}`} className="text-xs text-muted-foreground">
              Teks bantuan (opsional)
            </Label>
            <Input
              id={`help-${field.id}`}
              value={field.helpText ?? ""}
              onChange={(e) => onChange({ helpText: e.target.value || undefined })}
              maxLength={FORM_LIMITS.helpMax}
              placeholder="Petunjuk kecil di bawah pertanyaan"
              className="h-9"
              disabled={!canMutate}
            />
          </div>
        </div>
      ) : null}

      {field.type === "number" ? (
        <div className="grid gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`min-${field.id}`} className="text-xs text-muted-foreground">
              Nilai minimum (opsional)
            </Label>
            <Input
              id={`min-${field.id}`}
              type="number"
              value={field.min != null ? String(field.min) : ""}
              onChange={(e) => handleOptionalNumber("min", e.target.value)}
              className="h-9"
              disabled={!canMutate}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`maxnum-${field.id}`} className="text-xs text-muted-foreground">
              Nilai maksimum (opsional)
            </Label>
            <Input
              id={`maxnum-${field.id}`}
              type="number"
              value={field.max != null ? String(field.max) : ""}
              onChange={(e) => handleOptionalNumber("max", e.target.value)}
              className="h-9"
              disabled={!canMutate}
            />
          </div>
        </div>
      ) : null}

      {field.type === "rating" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <Label htmlFor={`scale-${field.id}`} className="text-xs text-muted-foreground">
            Skala bintang
          </Label>
          <Select
            value={String(field.max ?? FORM_LIMITS.ratingMaxDefault)}
            onValueChange={(v) => onChange({ max: Number(v) })}
            disabled={!canMutate}
          >
            <SelectTrigger id={`scale-${field.id}`} className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: FORM_LIMITS.ratingMaxLimit - 1 }, (_, i) => i + 2).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  1 - {n} bintang
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {field.type === "date" ? (
        <p className="rounded-lg border bg-zinc-50/60 px-3 py-2 text-xs text-muted-foreground dark:bg-zinc-900/40">
          Pelamar memilih tanggal lewat pemilih tanggal bawaan peramban.
        </p>
      ) : null}

      {field.type === "file" ? (
        <p className="rounded-lg border bg-zinc-50/60 px-3 py-2 text-xs text-muted-foreground dark:bg-zinc-900/40">
          PDF, gambar, Word, audio, video — maks. 20 MB.
        </p>
      ) : null}

      {/* Baris aksi field */}
      <div className="flex items-center justify-between gap-1.5 border-t pt-2">
        <div className="flex items-center gap-1.5">
          <IconButton
            icon={ArrowUp}
            label="Naikkan pertanyaan"
            onClick={() => onMove(-1)}
            disabled={!canMutate || !canMoveUp}
          />
          <IconButton
            icon={ArrowDown}
            label="Turunkan pertanyaan"
            onClick={() => onMove(1)}
            disabled={!canMutate || !canMoveDown}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="mr-1 flex items-center gap-2">
            <Switch
              checked={field.required}
              onCheckedChange={(checked) => onChange({ required: checked })}
              disabled={!canMutate}
              className="data-[state=checked]:bg-rose-600"
              aria-label="Wajib diisi"
            />
            <Label className="text-xs font-normal text-muted-foreground">Wajib diisi</Label>
          </div>
          <IconButton
            icon={Copy}
            label="Duplikat pertanyaan"
            onClick={onDuplicate}
            disabled={!canMutate}
          />
          <IconButton
            icon={Trash2}
            label="Hapus pertanyaan"
            onClick={onRemove}
            disabled={!canMutate}
          />
        </div>
      </div>
    </div>
  );
}

/* =============================== Halaman utama =============================== */

export function FormBuilderPage({
  position,
  onBack,
  onUpdated,
  onOpenApplication,
}: {
  position: Position;
  onBack: () => void;
  onUpdated: (position: Position) => void;
  /** Opsional: buka detail lamaran dari tab Jawaban (halaman lain, bukan dialog di sini). */
  onOpenApplication?: (applicationId: string) => void;
}) {
  const { canMutate, reportError } = useAdminSession();

  /* ------------------------------ Skema (draft) ------------------------------ */

  const [loading, setLoading] = useState(true);
  const [savedSchema, setSavedSchema] = useState<FormSchema | null>(null);
  const [derivedAvailable, setDerivedAvailable] = useState(false);
  const [draft, setDraft] = useState<FormSchema>(() => emptySchema());
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ schema: FormSchema | null; derived: FormSchema | null }>(
      `/api/admin/positions/${position.id}/form`,
    )
      .then((data) => {
        if (cancelled) return;
        const saved = data.schema ?? null;
        const derived = data.derived ?? null;
        setSavedSchema(saved);
        setDerivedAvailable(!saved && derived != null);
        setDraft(saved ?? derived ?? emptySchema());
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportError(err);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [position.id, reportError]);

  const dirty = useMemo(
    () => editableFingerprint(draft) !== editableFingerprint(savedSchema),
    [draft, savedSchema],
  );

  /* -------------------------------- Mutasi draft -------------------------------- */

  function updateSection(sectionId: string, patch: Partial<Pick<FormSection, "title" | "description">>) {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    }));
  }

  function moveSection(sectionId: string, dir: 1 | -1) {
    setDraft((prev) => {
      const index = prev.sections.findIndex((s) => s.id === sectionId);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= prev.sections.length) return prev;
      const sections = [...prev.sections];
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...prev, sections };
    });
  }

  function addSection() {
    setDraft((prev) => {
      if (prev.sections.length >= FORM_LIMITS.maxSections) return prev;
      return {
        ...prev,
        sections: [
          ...prev.sections,
          { id: newFormId("sec"), title: `Bagian ${prev.sections.length + 1}` },
        ],
      };
    });
  }

  function removeSection(sectionId: string) {
    if (draft.fields.some((f) => f.sectionId === sectionId)) {
      toast.error("Bagian masih berisi pertanyaan. Hapus atau pindahkan pertanyaannya dulu.");
      return;
    }
    setDraft((prev) => ({ ...prev, sections: prev.sections.filter((s) => s.id !== sectionId) }));
  }

  function updateField(fieldId: string, patch: Partial<FormField>) {
    setDraft((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)),
    }));
  }

  function addField(sectionId: string) {
    setDraft((prev) => {
      if (prev.fields.length >= FORM_LIMITS.maxFields) return prev;
      return {
        ...prev,
        fields: [
          ...prev.fields,
          {
            id: newFormId("fld"),
            sectionId,
            type: "text",
            label: "",
            required: false,
            options: [],
            allowOther: false,
          },
        ],
      };
    });
  }

  function moveField(fieldId: string, dir: 1 | -1) {
    setDraft((prev) => {
      const field = prev.fields.find((f) => f.id === fieldId);
      if (!field) return prev;
      const sectionIndices = prev.fields
        .map((f, i) => (f.sectionId === field.sectionId ? i : -1))
        .filter((i) => i >= 0);
      const pos = sectionIndices.findIndex((i) => prev.fields[i].id === fieldId);
      const targetPos = pos + dir;
      if (pos < 0 || targetPos < 0 || targetPos >= sectionIndices.length) return prev;
      const fields = [...prev.fields];
      const a = sectionIndices[pos];
      const b = sectionIndices[targetPos];
      [fields[a], fields[b]] = [fields[b], fields[a]];
      return { ...prev, fields };
    });
  }

  function duplicateField(fieldId: string) {
    setDraft((prev) => {
      const index = prev.fields.findIndex((f) => f.id === fieldId);
      if (index < 0 || prev.fields.length >= FORM_LIMITS.maxFields) return prev;
      const original = prev.fields[index];
      const clone: FormField = {
        ...original,
        id: newFormId("fld"),
        label: `${original.label} (salinan)`.slice(0, FORM_LIMITS.labelMax),
        options: [...original.options],
      };
      const fields = [...prev.fields];
      fields.splice(index + 1, 0, clone);
      return { ...prev, fields };
    });
  }

  function removeField(fieldId: string) {
    setDraft((prev) => ({ ...prev, fields: prev.fields.filter((f) => f.id !== fieldId) }));
  }

  /* ---------------------------------- Simpan ---------------------------------- */

  /** Validasi klien — cermin aturan server; kembalikan pesan error pertama. */
  function validateDraft(): string | null {
    for (let i = 0; i < draft.sections.length; i++) {
      const section = draft.sections[i];
      const title = section.title.trim();
      if (title.length < 1 || title.length > FORM_LIMITS.sectionTitleMax) {
        return `Judul bagian #${i + 1} harus 1-${FORM_LIMITS.sectionTitleMax} karakter.`;
      }
      if ((section.description ?? "").trim().length > FORM_LIMITS.sectionDescMax) {
        return `Deskripsi bagian "${title}" maksimal ${FORM_LIMITS.sectionDescMax} karakter.`;
      }
    }
    for (let i = 0; i < draft.fields.length; i++) {
      const field = draft.fields[i];
      const label = field.label.trim();
      if (label.length < FORM_LIMITS.labelMin || label.length > FORM_LIMITS.labelMax) {
        return `Label pertanyaan #${i + 1} harus ${FORM_LIMITS.labelMin}-${FORM_LIMITS.labelMax} karakter.`;
      }
      if (isChoiceType(field.type)) {
        const options = field.options.map((o) => o.trim()).filter(Boolean);
        if (options.length === 0) {
          return `Pertanyaan "${label}" butuh minimal 1 opsi.`;
        }
        if (options.length > FORM_LIMITS.maxOptions) {
          return `Pertanyaan "${label}" maksimal ${FORM_LIMITS.maxOptions} opsi.`;
        }
        for (const option of options) {
          if (option.length > FORM_LIMITS.optionMaxLen) {
            return `Opsi pertanyaan "${label}" maksimal ${FORM_LIMITS.optionMaxLen} karakter.`;
          }
        }
        const lower = options.map((o) => o.toLowerCase());
        if (new Set(lower).size !== lower.length) {
          return `Opsi pertanyaan "${label}" tidak boleh duplikat.`;
        }
      }
      if (field.type === "text" || field.type === "textarea" || field.type === "url") {
        if (field.maxLen != null && (!Number.isInteger(field.maxLen) || field.maxLen < 1 || field.maxLen > FORM_LIMITS.textHardMax)) {
          return `Batas karakter "${label}" harus 1-${FORM_LIMITS.textHardMax}.`;
        }
      }
      if (field.type === "number" && field.min != null && field.max != null && field.min > field.max) {
        return `Minimum tidak boleh lebih besar dari maksimum pada "${label}".`;
      }
      if (
        field.type === "rating" &&
        field.max != null &&
        (field.max < 2 || field.max > FORM_LIMITS.ratingMaxLimit)
      ) {
        return `Skala "${label}" harus 2-${FORM_LIMITS.ratingMaxLimit}.`;
      }
    }
    return null;
  }

  async function handleSave() {
    const error = validateDraft();
    if (error) {
      toast.error(error);
      return;
    }
    setSaving(true);
    try {
      const res = await apiPut<FormPutResponse>(`/api/admin/positions/${position.id}/form`, {
        schema: draft,
      });
      if (res.schema) {
        setDraft(res.schema);
        setSavedSchema(res.schema);
      }
      if (res.position) onUpdated(res.position);
      // Jawaban bergantung pada skema tersimpan — paksa tab Jawaban memuat ulang
      // saat dibuka berikutnya (sebelumnya bisa 400/klise lama).
      setResponsesLoaded(false);
      setResponses(null);
      setResponsesState("idle");
      toast.success("Formulir diterapkan");
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  /* ------------------------------ Generate AI ------------------------------ */

  async function handleGenerate() {
    setAiLoading(true);
    try {
      const res = await apiPost<AiQuestionsResponse>("/api/admin/ai/screening-questions", {
        positionId: position.id,
      });
      const questions = Array.isArray(res.questions) ? res.questions : [];
      const existingLabels = new Set(
        draft.fields.map((f) => f.label.trim().toLowerCase()),
      );
      const newFields: FormField[] = [];
      for (const question of questions) {
        if (draft.fields.length + newFields.length >= FORM_LIMITS.maxFields) break;
        const label = (typeof question?.label === "string" ? question.label : "")
          .trim()
          .slice(0, FORM_LIMITS.labelMax);
        if (label.length < FORM_LIMITS.labelMin) continue;
        const key = label.toLowerCase();
        if (existingLabels.has(key)) continue;
        existingLabels.add(key);
        newFields.push({
          id: newFormId("fld"),
          sectionId: "__target__",
          type: "text",
          label,
          required: question.required === true,
          options: [],
          allowOther: false,
          maxLen: FORM_LIMITS.textDefaultMax,
        });
      }
      if (newFields.length === 0) {
        toast.info("Tidak ada pertanyaan baru dari AI (sudah ada semua atau batas tercapai).");
        return;
      }
      setDraft((prev) => {
        let sections = prev.sections;
        if (sections.length === 0) {
          sections = [{ id: newFormId("sec"), title: "Pertanyaan Screening" }];
        }
        const targetSectionId = sections[sections.length - 1].id;
        return {
          ...prev,
          sections,
          fields: [
            ...prev.fields,
            ...newFields.map((f) => ({ ...f, sectionId: targetSectionId })),
          ],
        };
      });
      toast.success(`${newFields.length} pertanyaan dari AI ditambahkan ke bagian terakhir.`);
    } catch (err) {
      reportError(err);
    } finally {
      setAiLoading(false);
    }
  }

  /* ------------------------------- Tab Jawaban ------------------------------- */

  const [responses, setResponses] = useState<FormResponsesData | null>(null);
  const [responsesState, setResponsesState] = useState<
    "idle" | "loading" | "ready" | "not-builder" | "error"
  >("idle");
  const [responsesLoaded, setResponsesLoaded] = useState(false);

  async function loadResponses() {
    setResponsesState("loading");
    try {
      const data = await apiGet<FormResponsesData>(
        `/api/admin/positions/${position.id}/form-responses`,
      );
      setResponses(data);
      setResponsesState("ready");
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setResponsesState("not-builder");
      } else {
        setResponsesState("error");
      }
    }
  }

  const statFieldMeta = useMemo(() => {
    const source = savedSchema ?? draft;
    const map = new Map<string, { label: string; type: FormFieldType }>();
    for (const field of source.fields) {
      map.set(field.id, { label: field.label, type: field.type });
    }
    return map;
  }, [draft, savedSchema]);

  /* -------------------------------- Tab Setelan -------------------------------- */

  type SettingsState = {
    applyOpen: boolean;
    requireCv: boolean;
    requireIntro: boolean;
    requirePortfolio: boolean;
    maxApplicants: string;
    publishAt: string;
    closesAt: string;
  };

  function settingsFromPosition(p: Position): SettingsState {
    return {
      applyOpen: p.applyOpen,
      requireCv: p.requireCv,
      requireIntro: p.requireIntro,
      requirePortfolio: p.requirePortfolio,
      maxApplicants: p.maxApplicants != null ? String(p.maxApplicants) : "",
      publishAt: dateInputFromIso(p.publishAt),
      closesAt: dateInputFromIso(p.closesAt),
    };
  }

  const [settings, setSettings] = useState<SettingsState>(() => settingsFromPosition(position));
  const [savingSettings, setSavingSettings] = useState(false);

  const settingsDirty = useMemo(() => {
    const initial = settingsFromPosition(position);
    return JSON.stringify(settings) !== JSON.stringify(initial);
  }, [position, settings]);

  async function handleSaveSettings() {
    const initial = settingsFromPosition(position);
    const payload: Record<string, unknown> = {};
    if (settings.applyOpen !== initial.applyOpen) payload.applyOpen = settings.applyOpen;
    if (settings.requireCv !== initial.requireCv) payload.requireCv = settings.requireCv;
    if (settings.requireIntro !== initial.requireIntro) payload.requireIntro = settings.requireIntro;
    if (settings.requirePortfolio !== initial.requirePortfolio) {
      payload.requirePortfolio = settings.requirePortfolio;
    }
    if (settings.maxApplicants !== initial.maxApplicants) {
      const trimmed = settings.maxApplicants.trim();
      if (!trimmed) {
        payload.maxApplicants = null;
      } else {
        const parsed = Number(trimmed);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
          toast.error("Kuota pelamar harus angka bulat 1-10000, atau dikosongkan untuk tanpa kuota.");
          return;
        }
        payload.maxApplicants = parsed;
      }
    }
    if (settings.publishAt !== initial.publishAt) {
      payload.publishAt = isoFromDateInput(settings.publishAt, false);
    }
    if (settings.closesAt !== initial.closesAt) {
      payload.closesAt = isoFromDateInput(settings.closesAt, true);
    }
    if (Object.keys(payload).length === 0) {
      toast.info("Tidak ada perubahan setelan yang dikirim.");
      return;
    }
    setSavingSettings(true);
    try {
      const updated = await apiPatch<Position>(`/api/admin/positions/${position.id}`, payload);
      onUpdated(updated);
      toast.success("Setelan formulir disimpan");
    } catch (err) {
      reportError(err);
    } finally {
      setSavingSettings(false);
    }
  }

  /* --------------------------------- Navigasi --------------------------------- */

  function handleBackClick() {
    if (dirty) setDiscardOpen(true);
    else onBack();
  }

  function handleTabChange(value: string) {
    if (value !== "pertanyaan" && value !== "jawaban" && value !== "setelan") return;
    if (value === "jawaban" && !responsesLoaded) {
      setResponsesLoaded(true);
      void loadResponses();
    }
  }

  const csvUrl = `/api/admin/positions/${position.id}/form-responses?format=csv`;
  const totalFields = draft.fields.length;
  const hasLegacySchema =
    savedSchema != null &&
    (position.screeningQuestions.length > 0 || position.customDocs.length > 0);

  /* ---------------------------------- Render ---------------------------------- */

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <Reveal className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-11 gap-2 sm:h-9"
            onClick={handleBackClick}
            aria-label="Kembali ke halaman kelola posisi"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Kelola Posisi
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold leading-tight">Formulir Lamaran</h2>
              {loading ? null : savedSchema ? (
                <BadgeSaved />
              ) : derivedAvailable ? (
                <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                  Draf migrasi otomatis
                </Badge>
              ) : (
                <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                  Belum tersimpan
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {position.title}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() =>
                window.open(
                  position.slug
                    ? `/?posisi=${encodeURIComponent(position.slug)}&preview=1`
                    : "/?preview=1",
                  "_blank",
                  "noopener,noreferrer",
                )
              }
            >
              <Eye className="size-4" aria-hidden="true" />
              Pratinjau
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => void handleGenerate()}
              disabled={!canMutate || aiLoading}
            >
              {aiLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="size-4" aria-hidden="true" />
              )}
              Generate dengan AI
            </Button>
            <Button
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => void handleSave()}
              disabled={!canMutate || !dirty || saving || loading}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ListChecks className="size-4" aria-hidden="true" />
              )}
              Simpan &amp; Terapkan
            </Button>
          </div>
        </div>
      </Reveal>

      <Tabs defaultValue="pertanyaan" onValueChange={handleTabChange} className="gap-4">
        <TabsList className="h-11 w-full justify-start overflow-x-auto sm:h-9">
          <TabsTrigger value="pertanyaan">
            <ListChecks className="size-4" aria-hidden="true" />
            Pertanyaan
          </TabsTrigger>
          <TabsTrigger value="jawaban">
            <ClipboardList className="size-4" aria-hidden="true" />
            Jawaban
          </TabsTrigger>
          <TabsTrigger value="setelan">
            <Settings2 className="size-4" aria-hidden="true" />
            Setelan
          </TabsTrigger>
        </TabsList>

        {/* ================================ PERTANYAAN ================================ */}
        <TabsContent value="pertanyaan" className="flex flex-col gap-4">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-28 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
              ))}
            </div>
          ) : (
            <>
              <StaticBlockCard
                icon={User}
                title="Data Diri (bawaan)"
                hint="Nama, Email, No. WhatsApp — selalu ada, tidak bisa dihapus."
              />

              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>Urutan wizard publik:</span>
                <span className="font-medium text-foreground">Data Diri</span>
                <span aria-hidden="true">→</span>
                <span className="font-medium text-foreground">Pengalaman</span>
                <span aria-hidden="true">→</span>
                <span className="font-medium text-foreground">bagian di bawah ini</span>
                <span aria-hidden="true">→</span>
                <span className="font-medium text-foreground">Berkas</span>
                <span aria-hidden="true">→</span>
                <span className="font-medium text-foreground">Pratinjau</span>
                <Badge variant="secondary" className="ml-1">
                  {totalFields}/{FORM_LIMITS.maxFields} pertanyaan
                </Badge>
              </p>

              {draft.sections.map((section, sectionIndex) => {
                const sectionFields = draft.fields.filter((f) => f.sectionId === section.id);
                return (
                  <Reveal key={section.id} delay={Math.min(sectionIndex * 0.04, 0.2)}>
                    <Card className="gap-4 rounded-2xl p-5 md:p-6">
                      {/* Kepala bagian */}
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <Label
                            className="sr-only"
                            htmlFor={`section-title-${section.id}`}
                          >
                            Judul bagian
                          </Label>
                          <Input
                            id={`section-title-${section.id}`}
                            value={section.title}
                            onChange={(e) => updateSection(section.id, { title: e.target.value })}
                            maxLength={FORM_LIMITS.sectionTitleMax}
                            placeholder="Judul bagian"
                            className="h-10 border-transparent bg-zinc-50/60 text-base font-semibold dark:bg-zinc-900/40"
                            disabled={!canMutate}
                          />
                          <Label
                            className="sr-only"
                            htmlFor={`section-desc-${section.id}`}
                          >
                            Deskripsi bagian
                          </Label>
                          <Input
                            id={`section-desc-${section.id}`}
                            value={section.description ?? ""}
                            onChange={(e) =>
                              updateSection(section.id, {
                                description: e.target.value || undefined,
                              })
                            }
                            maxLength={FORM_LIMITS.sectionDescMax}
                            placeholder="Deskripsi opsional untuk bagian ini"
                            className="mt-1.5 h-9 border-transparent bg-zinc-50/60 text-sm text-muted-foreground dark:bg-zinc-900/40"
                            disabled={!canMutate}
                          />
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <IconButton
                            icon={ArrowUp}
                            label="Naikkan bagian"
                            onClick={() => moveSection(section.id, -1)}
                            disabled={!canMutate || sectionIndex === 0}
                          />
                          <IconButton
                            icon={ArrowDown}
                            label="Turunkan bagian"
                            onClick={() => moveSection(section.id, 1)}
                            disabled={
                              !canMutate || sectionIndex === draft.sections.length - 1
                            }
                          />
                          <IconButton
                            icon={Trash2}
                            label="Hapus bagian"
                            onClick={() => removeSection(section.id)}
                            disabled={!canMutate}
                          />
                        </div>
                      </div>

                      {/* Daftar pertanyaan */}
                      {sectionFields.length === 0 ? (
                        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          Belum ada pertanyaan di bagian ini.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {sectionFields.map((field, fieldIndex) => (
                            <FieldEditorCard
                              key={field.id}
                              field={field}
                              canMoveUp={fieldIndex > 0}
                              canMoveDown={fieldIndex < sectionFields.length - 1}
                              canMutate={canMutate}
                              onChange={(patch) => updateField(field.id, patch)}
                              onMove={(dir) => moveField(field.id, dir)}
                              onDuplicate={() => duplicateField(field.id)}
                              onRemove={() => removeField(field.id)}
                            />
                          ))}
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 w-fit"
                        onClick={() => addField(section.id)}
                        disabled={!canMutate || totalFields >= FORM_LIMITS.maxFields}
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        Tambah pertanyaan
                      </Button>
                    </Card>
                  </Reveal>
                );
              })}

              <Button
                type="button"
                variant="outline"
                className="h-11 w-fit sm:h-10"
                onClick={addSection}
                disabled={!canMutate || draft.sections.length >= FORM_LIMITS.maxSections}
              >
                <Plus className="size-4" aria-hidden="true" />
                Tambah Bagian
                <span className="text-xs text-muted-foreground">
                  ({draft.sections.length}/{FORM_LIMITS.maxSections})
                </span>
              </Button>

              <StaticBlockCard
                icon={Briefcase}
                title="Pengalaman (bawaan)"
                hint="Pengalaman & alasan bergabung — selalu ada, tidak bisa dihapus."
              />
              <StaticBlockCard
                icon={FileText}
                title="Berkas (bawaan)"
                hint="Pengaturan CV/Intro/Portofolio ada di tab Setelan."
              />
            </>
          )}
        </TabsContent>

        {/* ================================= JAWABAN ================================= */}
        <TabsContent value="jawaban" className="flex flex-col gap-4">
          {responsesState === "idle" || responsesState === "loading" ? (
            <div className="flex flex-col gap-3">
              <div className="h-12 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
              ))}
            </div>
          ) : responsesState === "not-builder" ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
              <ClipboardList className="size-10 text-muted-foreground/40" aria-hidden="true" />
              <p className="text-sm font-medium">
                Simpan formulir dulu untuk melihat jawaban
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Statistik jawaban tersedia setelah posisi memakai Form Builder. Tekan
                &quot;Simpan &amp; Terapkan&quot; di tab Pertanyaan, lalu buka tab ini lagi.
              </p>
            </div>
          ) : responsesState === "error" || responses === null ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">Gagal memuat jawaban.</p>
              <Button variant="outline" size="sm" className="h-9" onClick={() => void loadResponses()}>
                Coba Lagi
              </Button>
            </div>
          ) : (
            <>
              {/* Ringkasan + CSV */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  <span className="text-xl font-bold tabular-nums text-foreground">
                    {responses.total}
                  </span>{" "}
                  jawaban terkumpul
                </p>
                <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                  <a href={csvUrl} download>
                    <FileDown className="size-4" aria-hidden="true" />
                    Unduh CSV
                  </a>
                </Button>
              </div>

              {/* Statistik per pertanyaan */}
              {responses.fields.length === 0 ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
                  <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">
                    Formulir belum punya pertanyaan aktif.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {responses.fields.map((stat) => {
                    const meta = statFieldMeta.get(stat.fieldId);
                    const title = meta?.label ?? stat.fieldId;
                    return (
                      <Card key={stat.fieldId} className="gap-3 rounded-2xl p-5">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 text-sm font-semibold">{title}</p>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {meta ? (
                              <Badge variant="secondary">{FORM_FIELD_TYPE_LABELS[meta.type]}</Badge>
                            ) : null}
                            <Badge variant="outline">{stat.filled} terisi</Badge>
                          </div>
                        </div>

                        {stat.kind === "choices" ? (
                          <div className="flex flex-col gap-2.5">
                            {stat.filled === 0 ? (
                              <p className="text-xs text-muted-foreground">Belum ada jawaban.</p>
                            ) : (
                              <>
                                {Object.entries(stat.counts).map(([option, count]) => (
                                  <div key={option} className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                      <span className="min-w-0 truncate">{option}</span>
                                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {count} ({Math.round((count / stat.filled) * 100)}%)
                                      </span>
                                    </div>
                                    <div
                                      className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                                      role="img"
                                      aria-label={`${option}: ${count} jawaban`}
                                    >
                                      <div
                                        className="h-full rounded-full bg-rose-600"
                                        style={{ width: barWidth(count, stat.filled) }}
                                      />
                                    </div>
                                  </div>
                                ))}
                                {stat.otherCount > 0 ? (
                                  <div className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                      <span className="min-w-0 truncate italic">Lainnya</span>
                                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                        {stat.otherCount}
                                      </span>
                                    </div>
                                    <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                                      <div
                                        className="h-full rounded-full bg-zinc-400 dark:bg-zinc-500"
                                        style={{ width: barWidth(stat.otherCount, stat.filled) }}
                                      />
                                    </div>
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}

                        {stat.kind === "rating" ? (
                          <div className="flex flex-col gap-2.5">
                            <div className="flex items-center gap-2">
                              <RatingStars
                                value={Math.round(stat.avg ?? 0)}
                                size="size-4"
                                ariaLabel={`Rata-rata rating ${title}`}
                              />
                              <span className="text-sm font-semibold tabular-nums">
                                {stat.avg != null ? stat.avg.toFixed(1) : "-"}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                dari {stat.counts.length}
                              </span>
                            </div>
                            {stat.counts.map((count, index) => (
                              <div key={index} className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-3 text-xs">
                                  <span>{index + 1} bintang</span>
                                  <span className="tabular-nums text-muted-foreground">{count}</span>
                                </div>
                                <div
                                  className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                                  role="img"
                                  aria-label={`${index + 1} bintang: ${count} jawaban`}
                                >
                                  <div
                                    className="h-full rounded-full bg-amber-500"
                                    style={{ width: barWidth(count, stat.filled) }}
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {stat.kind === "files" ? (
                          <div className="flex flex-col gap-2">
                            {stat.files.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Belum ada berkas.</p>
                            ) : (
                              stat.files.map((file, index) => (
                                <div key={`${file.fileId}-${index}`} className="flex items-center gap-2">
                                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm">{file.filename || "berkas"}</p>
                                    <p className="truncate text-xs text-muted-foreground">{file.name}</p>
                                  </div>
                                  <a
                                    href={`/api/files/${file.fileId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                                  >
                                    Unduh
                                  </a>
                                </div>
                              ))
                            )}
                          </div>
                        ) : null}

                        {stat.kind === "text" ? (
                          <div className="flex flex-col gap-2">
                            {stat.samples.length === 0 ? (
                              <p className="text-xs text-muted-foreground">Belum ada jawaban.</p>
                            ) : (
                              stat.samples.slice(0, 5).map((sample, index) => (
                                <div
                                  key={`${sample.trackingCode ?? sample.name}-${index}`}
                                  className="rounded-lg bg-muted/50 p-2.5"
                                >
                                  <p className="text-sm whitespace-pre-wrap">{sample.value}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {sample.name}
                                    {sample.trackingCode ? ` · ${sample.trackingCode}` : ""}
                                  </p>
                                </div>
                              ))
                            )}
                          </div>
                        ) : null}
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Jawaban terbaru */}
              <Card className="gap-3 rounded-2xl p-5 md:p-6">
                <p className="text-sm font-semibold">Jawaban terbaru</p>
                {responses.recent.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-6 text-center">
                    <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">
                      Belum ada lamaran dengan jawaban formulir.
                    </p>
                  </div>
                ) : (
                  <div className="nice-scrollbar max-h-96 overflow-y-auto rounded-xl border">
                    <Table>
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          <TableHead className="w-28">Kode</TableHead>
                          <TableHead>Nama</TableHead>
                          <TableHead className="hidden md:table-cell">Email</TableHead>
                          <TableHead>Tahap</TableHead>
                          <TableHead className="hidden sm:table-cell">Tanggal</TableHead>
                          <TableHead className="w-16 text-right">
                            <span className="sr-only">Aksi</span>
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {responses.recent.map((row) => (
                          <TableRow key={row.id}>
                            <TableCell className="font-mono text-xs">
                              {row.trackingCode ?? "-"}
                            </TableCell>
                            <TableCell className="max-w-40 truncate font-medium">
                              {row.name}
                            </TableCell>
                            <TableCell className="hidden max-w-52 truncate md:table-cell">
                              {row.email}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{labelForStatus(row.status)}</Badge>
                            </TableCell>
                            <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                              {formatDateTime(row.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              {onOpenApplication ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  onClick={() => onOpenApplication(row.id)}
                                >
                                  Lihat
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </Card>
            </>
          )}
        </TabsContent>

        {/* ================================= SETELAN ================================= */}
        <TabsContent value="setelan" className="flex flex-col gap-4">
          <Card className="gap-5 rounded-2xl p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">Buka formulir lamaran</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Saat ditutup, posisi tetap tayang tetapi tidak menerima lamaran baru.
                  Saklar global di Pengaturan tetap menjadi induk.
                </p>
              </div>
              <Switch
                checked={settings.applyOpen}
                onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, applyOpen: checked }))}
                disabled={!canMutate}
                className="data-[state=checked]:bg-rose-600"
                aria-label="Buka formulir lamaran"
              />
            </div>

            <div className="border-t pt-4">
              <p className="text-sm font-semibold">Berkas wajib dari pendaftar</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Dokumen bawaan yang harus diunggah pelamar di langkah Berkas.
              </p>
              <div className="mt-3 flex flex-col gap-3">
                {(
                  [
                    { key: "requireCv", label: "Wajib CV" },
                    { key: "requireIntro", label: "Wajib Intro Video/Audio" },
                    { key: "requirePortfolio", label: "Wajib Portofolio" },
                  ] as const
                ).map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-3">
                    <Label className="text-sm font-normal">{item.label}</Label>
                    <Switch
                      checked={settings[item.key]}
                      onCheckedChange={(checked) =>
                        setSettings((prev) => ({ ...prev, [item.key]: checked }))
                      }
                      disabled={!canMutate}
                      aria-label={item.label}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="max-applicants" className="text-sm">
                  Kuota pelamar
                </Label>
                <Input
                  id="max-applicants"
                  type="number"
                  min={1}
                  max={10000}
                  value={settings.maxApplicants}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, maxApplicants: e.target.value }))
                  }
                  placeholder="Tanpa kuota"
                  className="h-10"
                  disabled={!canMutate}
                />
                <p className="text-xs text-muted-foreground">
                  1-10000. Kosongkan untuk tanpa batas.
                </p>
              </div>
              <div className="hidden sm:block" aria-hidden="true" />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="publish-at" className="text-sm">
                  Tanggal publikasi
                </Label>
                <Input
                  id="publish-at"
                  type="date"
                  value={settings.publishAt}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, publishAt: e.target.value }))
                  }
                  className="h-10"
                  disabled={!canMutate}
                />
                <p className="text-xs text-muted-foreground">
                  Posisi tayang mulai tanggal ini.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="closes-at" className="text-sm">
                  Tanggal penutupan
                </Label>
                <Input
                  id="closes-at"
                  type="date"
                  value={settings.closesAt}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, closesAt: e.target.value }))
                  }
                  className="h-10"
                  disabled={!canMutate}
                />
                <p className="text-xs text-muted-foreground">
                  Lamaran ditutup setelah akhir hari ini.
                </p>
              </div>
            </div>

            {hasLegacySchema ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                Pertanyaan screening &amp; dokumen lama sudah dimigrasikan ke Pertanyaan;
                kolom lama tidak dipakai lagi.
              </p>
            ) : null}

            <div className="flex items-center gap-3 border-t pt-4">
              <Button
                size="sm"
                className="h-11 sm:h-9"
                onClick={() => void handleSaveSettings()}
                disabled={!canMutate || savingSettings || !settingsDirty}
              >
                {savingSettings ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Simpan Setelan
              </Button>
              {settingsDirty ? (
                <p className="text-xs text-muted-foreground">Ada perubahan belum disimpan.</p>
              ) : null}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Konfirmasi buang perubahan */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Buang perubahan?</AlertDialogTitle>
            <AlertDialogDescription>
              Ada perubahan formulir yang belum disimpan. Bila keluar sekarang,
              perubahan tersebut akan hilang.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Lanjut Mengedit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                setDiscardOpen(false);
                onBack();
              }}
            >
              Buang Perubahan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BadgeSaved() {
  return (
    <Badge variant="secondary" className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
      Skema tersimpan
    </Badge>
  );
}
