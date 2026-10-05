"use client";

// Form Builder per Posisi — halaman penuh 2 tab (ala Google Forms, bahasa desain
// Lumina): Pertanyaan (penyusun skema v2 — SEMUA bagian bisa diedit, diurut, dan
// dikonfigurasi; urutan kartu = urutan wizard publik) dan Jawaban (statistik +
// ekspor CSV). Setelan penerimaan (buka/tutup, kuota, jadwal tayang) pindah ke
// sub-halaman "Penerimaan" — halaman ini hanya menyediakan tautan onOpenIntake.
// Skema disimpan via PUT /api/admin/positions/{id}/form; jawaban dibaca dari
// /api/admin/positions/{id}/form-responses (JSON/CSV). Halaman ini tidak pernah
// memakai popup untuk navigasi utama — Kembali berupa full-page (onBack).
// Kontrak skema ada di src/lib/form-schema.ts (client-safe).

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Copy,
  Eye,
  FileDown,
  FileText,
  Inbox,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  CORE_ITEM_DEFAULT_LABELS,
  FORM_AUTOCOMPLETE_KEYS,
  FORM_FIELD_TYPES,
  FORM_FIELD_TYPE_LABELS,
  FORM_LIMITS,
  FORM_SCHEMA_VERSION,
  FORM_SECTION_KIND_LABELS,
  coreItem,
  coreItemLabel,
  coreItemOverridden,
  defaultBiodataSection,
  defaultExperienceSection,
  defaultFilesSection,
  isBirthDateEnabled,
  isBirthDateRequired,
  isBuiltinSection,
  isChoiceType,
  isCvEnabled,
  isCvRequired,
  isEmailRequired,
  isExperienceEnabled,
  isExperienceRequired,
  isIntroEnabled,
  isIntroRequired,
  isMotivationEnabled,
  isMotivationRequired,
  isNikEnabled,
  isNikRequired,
  isPortfolioEnabled,
  isPortfolioRequired,
  isWaRequired,
  newFormId,
  normalizeFormSchema,
  type CoreItemKey,
  type CoreItemOverride,
  type CoreOverrides,
  type FormAnswerValue,
  type FormField,
  type FormFieldType,
  type FormSchema,
  type FormSection,
} from "@/lib/form-schema";
import { FORM_TEMPLATES, expandTemplateFields, type FormTemplate } from "@/lib/form-templates";
import { STATUS_LABELS, type ApplicationStatus, type Position } from "@/lib/types";
import { ApiError, apiGet, apiPost, apiPut } from "./api";
import { formatDateTime } from "./format";
import { useAdminSession } from "./admin-context";
import { Reveal } from "./motion-primitives";
import { RatingStars } from "./rating-stars";
import { cn } from "@/lib/utils";

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
type AiQuestionsResponse = { questions: { label: string }[] };

/* -------------------------------- Utilitas -------------------------------- */

/** Skema kosong untuk posisi tanpa konten klasik: v2 lengkap dengan 3 bagian inti. */
function emptySchema(): FormSchema {
  return {
    version: FORM_SCHEMA_VERSION,
    sections: [defaultBiodataSection(), defaultExperienceSection(), defaultFilesSection()],
    fields: [],
    retiredFields: [],
  };
}

/** Jumlah bagian kustom (tambahan) dalam skema. */
function customSectionCount(schema: FormSchema): number {
  return schema.sections.filter((s) => s.kind === "custom").length;
}

/**
 * Sisipkan bagian kustom baru SEBELUM bagian Berkas agar wizard tetap ditutup
 * Berkas (konvensi migrasi); bila Berkas tidak ada, tambahkan di akhir.
 */
function insertCustomSection(sections: FormSection[], section: FormSection): FormSection[] {
  const next = [...sections];
  const filesIdx = next.map((s) => s.kind).lastIndexOf("files");
  if (filesIdx >= 0) next.splice(filesIdx, 0, section);
  else next.push(section);
  return next;
}

/**
 * Fingerprint kanonik bagian + pertanyaan — dasar perbandingan "dirty"
 * (retiredFields diurus server). Urutan bagian, judul, deskripsi, SEMUA
 * flag bawaan, dan batu nisan bagian bawaan (NR-23 `removed`) ikut
 * diperhitungkan; flag dibaca lewat semantik getter (aman untuk properti
 * yang belum terisi) agar bentuk tersimpan tidak memicu false-positive.
 */
function editableFingerprint(schema: FormSchema | null): string {
  const canonical = {
    sections: (schema?.sections ?? []).map((s) => ({
      id: s.id,
      kind: s.kind,
      title: s.title,
      description: s.description ?? null,
      titleEn: s.titleEn ?? null,
      removed: s.removed === true,
      waRequired: s.kind === "biodata" ? s.waRequired !== false : null,
      experienceEnabled: s.kind === "experience" ? s.experienceEnabled !== false : null,
      experienceRequired: s.kind === "experience" ? s.experienceRequired !== false : null,
      motivationEnabled: s.kind === "experience" ? s.motivationEnabled !== false : null,
      motivationRequired: s.kind === "experience" ? s.motivationRequired !== false : null,
      cvEnabled: s.kind === "files" ? s.cvEnabled !== false : null,
      cvRequired: s.kind === "files" ? s.cvEnabled !== false && s.cvRequired === true : null,
      introEnabled: s.kind === "files" ? s.introEnabled !== false : null,
      introRequired: s.kind === "files" ? s.introEnabled !== false && s.introRequired === true : null,
      portfolioEnabled: s.kind === "files" ? s.portfolioEnabled !== false : null,
      portfolioRequired:
        s.kind === "files" ? s.portfolioEnabled !== false && s.portfolioRequired === true : null,
      // NR-32 — item inti opsional NIK & Tanggal Lahir (biodata) ikut dirty check.
      nikEnabled: s.kind === "biodata" ? s.nikEnabled === true : null,
      nikRequired:
        s.kind === "biodata" && s.nikEnabled === true ? s.nikRequired === true : null,
      birthDateEnabled: s.kind === "biodata" ? s.birthDateEnabled === true : null,
      birthDateRequired:
        s.kind === "biodata" && s.birthDateEnabled === true ? s.birthDateRequired === true : null,
      // NR-26 — kustomisasi item inti ikut menandai perubahan (dibandingkan
      // apa adanya; pembersihan kunci kosong terjadi di patchCoreItem).
      core: s.core ?? null,
    })),
    fields: schema?.fields ?? [],
  };
  return JSON.stringify(canonical);
}

function labelForStatus(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
}

/**
 * NR-32 — label terbaca untuk hint isi-otomatis browser (dropdown editor field).
 * Kunci diambil dari whitelist FORM_AUTOCOMPLETE_KEYS (form-schema) agar tipe
 * tetap sinkron dengan sanitizer server.
 */
const FORM_AUTOCOMPLETE_LABELS: Record<(typeof FORM_AUTOCOMPLETE_KEYS)[number], string> = {
  off: "Nonaktif (off)",
  name: "Nama",
  email: "Email",
  tel: "No. Telepon",
  bday: "Tanggal lahir",
  sex: "Jenis kelamin",
  "street-address": "Alamat",
  organization: "Organisasi",
  url: "URL",
};

/**
 * NR-32 — nilai sentinel dropdown "tampil bersyarat" (Radix Select melarang
 * value string kosong): pilihan ini berarti field selalu tampil (tanpa showIf).
 */
const SHOWIF_ALWAYS = "__selalu_tampil__";

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

/**
 * Kartu satu item inti bagian bawaan (NR-26) — bisa diedit "seperti biasa":
 * label, placeholder, teks bantuan, status wajib (bila boleh opsional), dan
 * saklar Aktif (slot pengalaman/motivasi/berkas). Tombol pulihkan memuncul
 * kembali seluruh teks bawaan item. Nama selalu wajib (identitas pelamar).
 */
function CoreItemCard({
  section,
  itemKey,
  canMutate,
  onPatchCoreItem,
  enabled,
  canDisable = false,
  onToggleEnabled,
  required = true,
  requiredLocked = false,
  onRequiredChange,
  showTextConfig = false,
  formatHint,
  hint,
}: {
  section: FormSection;
  itemKey: CoreItemKey;
  canMutate: boolean;
  onPatchCoreItem: (key: CoreItemKey, patch: Partial<CoreItemOverride>) => void;
  /** Status saklar Aktif (hanya slot yang bisa dimatikan). */
  enabled?: boolean;
  canDisable?: boolean;
  onToggleEnabled?: (checked: boolean) => void;
  /** Status wajib efektif; bawaan true (perilaku lama). */
  required?: boolean;
  /** Item yang tidak boleh opsional (Nama) — tampil badge Wajib + ikon kunci. */
  requiredLocked?: boolean;
  onRequiredChange?: (checked: boolean) => void;
  /** Tampilkan editor placeholder + teks bantuan (item teks). */
  showTextConfig?: boolean;
  /** Petunjuk format statis (slot berkas — tidak bisa diganti admin). */
  formatHint?: string;
  hint?: string;
}) {
  const defaultLabel = CORE_ITEM_DEFAULT_LABELS[itemKey];
  const label = coreItemLabel(section, itemKey);
  const override = coreItem(section, itemKey);
  const overridden =
    coreItemOverridden(section, itemKey) ||
    (!requiredLocked && override.required === false);
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-background p-3.5 shadow-xs">
      <div className="flex items-center gap-1.5">
        <Label className="sr-only" htmlFor={`core-label-${itemKey}`}>
          Label item {defaultLabel}
        </Label>
        <Input
          id={`core-label-${itemKey}`}
          value={label}
          onChange={(e) => onPatchCoreItem(itemKey, { label: e.target.value })}
          maxLength={FORM_LIMITS.labelMax}
          placeholder={defaultLabel}
          disabled={!canMutate}
          className="h-10 flex-1"
        />
        {overridden ? (
          <IconButton
            icon={RotateCcw}
            label={`Pulihkan bawaan item ${defaultLabel}`}
            onClick={() =>
              onPatchCoreItem(itemKey, { label: "", placeholder: "", helpText: "", required: undefined })
            }
            disabled={!canMutate}
          />
        ) : null}
      </div>
      {showTextConfig ? (
        <div className="grid gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`core-ph-${itemKey}`} className="text-xs text-muted-foreground">
              Placeholder (opsional)
            </Label>
            <Input
              id={`core-ph-${itemKey}`}
              value={override.placeholder ?? ""}
              onChange={(e) => onPatchCoreItem(itemKey, { placeholder: e.target.value })}
              maxLength={FORM_LIMITS.placeholderMax}
              placeholder="Teks samaran di kolom jawaban"
              className="h-9"
              disabled={!canMutate}
              aria-label={`Placeholder item ${defaultLabel}`}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`core-help-${itemKey}`} className="text-xs text-muted-foreground">
              Teks bantuan (opsional)
            </Label>
            <Input
              id={`core-help-${itemKey}`}
              value={override.helpText ?? ""}
              onChange={(e) => onPatchCoreItem(itemKey, { helpText: e.target.value })}
              maxLength={FORM_LIMITS.helpMax}
              placeholder="Petunjuk kecil di bawah pertanyaan"
              className="h-9"
              disabled={!canMutate}
              aria-label={`Teks bantuan item ${defaultLabel}`}
            />
          </div>
        </div>
      ) : formatHint ? (
        <p className="text-xs text-muted-foreground">{formatHint}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        {canDisable ? (
          <>
            <Switch
              checked={enabled === true}
              onCheckedChange={(checked) => onToggleEnabled?.(checked)}
              disabled={!canMutate}
              aria-label={`Aktifkan item ${defaultLabel}`}
            />
            <Label className="text-xs font-normal text-muted-foreground">Aktif</Label>
          </>
        ) : null}
        {requiredLocked ? (
          <>
            <Badge
              variant="outline"
              className="border-rose-200 bg-rose-50 px-1.5 text-[10px] text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
            >
              Wajib
            </Badge>
            <Lock className="size-3 shrink-0 text-muted-foreground/60" aria-hidden="true" />
          </>
        ) : onRequiredChange ? (
          <>
            <Switch
              checked={required}
              onCheckedChange={onRequiredChange}
              disabled={!canMutate || (canDisable && enabled === false)}
              className="data-[state=checked]:bg-rose-600"
              aria-label={`${defaultLabel} wajib diisi`}
            />
            <Label className="text-xs font-normal text-muted-foreground">Wajib</Label>
          </>
        ) : null}
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
    </div>
  );
}

/**
 * Kartu satu bagian skema (semua jenis). Bagian bawaan Pengalaman/Berkas bisa
 * "dihapus" via mode kunci NR-23: tombol hapus membuka panel inline (tanpa
 * dialog) tempat admin mengetik "kunci" untuk membuka proteksi — konfirmasi
 * hanya menandai batu nisan `removed: true` (bisa dipulihkan). Biodata tetap
 * terkunci penuh (identitas & deteksi duplikat). Bagian kustom dihapus fisik.
 * Urutan kartu = urutan wizard.
 */
function SectionCard({
  section,
  index,
  totalSections,
  fields,
  canAddField,
  canMutate,
  locked,
  onToggleLock,
  onPatch,
  onMove,
  onRemove,
  onRemoveBuiltin,
  onFieldChange,
  onFieldMove,
  onFieldDuplicate,
  onFieldRemove,
  onAddField,
  onApplyTemplate,
}: {
  section: FormSection;
  index: number;
  totalSections: number;
  fields: FormField[];
  canAddField: boolean;
  canMutate: boolean;
  /** Kunci anti-hapus (bagian inti: default terkunci; bagian kustom bebas). */
  locked: boolean;
  onToggleLock: () => void;
  onPatch: (patch: Partial<Omit<FormSection, "id" | "kind">>) => void;
  onMove: (dir: 1 | -1) => void;
  onRemove: () => void;
  /** NR-23 — tandai bagian bawaan sebagai dihapus (tombstone, bisa dipulihkan). */
  onRemoveBuiltin: () => void;
  onFieldChange: (fieldId: string, patch: Partial<FormField>) => void;
  onFieldMove: (fieldId: string, dir: 1 | -1) => void;
  onFieldDuplicate: (fieldId: string) => void;
  onFieldRemove: (fieldId: string) => void;
  onAddField: () => void;
  /** NR-32 — suntik paket pertanyaan dari template ke bagian ini (biodata/kustom). */
  onApplyTemplate: (template: FormTemplate) => void;
}) {
  const isBuiltin = isBuiltinSection(section);
  // NR-23 — mode kunci: hanya Pengalaman & Berkas (biodata tak terhapus).
  const kunciDeletable = isBuiltin && (section.kind === "experience" || section.kind === "files");
  const [kunciOpen, setKunciOpen] = useState(false);
  const [kunciInput, setKunciInput] = useState("");
  const kunciMatch = kunciInput.trim() === "kunci";
  const [confirmRemove, setConfirmRemove] = useState(false);
  const lockHint =
    section.kind === "biodata"
      ? "Selalu tersedia untuk identitas, deteksi lamaran ganda, dan komunikasi — tidak bisa dihapus."
      : "";

  /**
   * NR-26 — perbarui kustomisasi satu item inti. Kunci yang tidak lagi
   * membawa nilai (teks kosong, required kembali wajib) dibuang supaya JSON
   * tetap ramping; peta kosong menghapus `core` dari bagian sepenuhnya.
   */
  function patchCoreItem(key: CoreItemKey, patch: Partial<CoreItemOverride>) {
    const merged = { ...coreItem(section, key), ...patch };
    const cleaned: CoreItemOverride = {};
    if (merged.label && merged.label.trim()) cleaned.label = merged.label;
    if (merged.placeholder && merged.placeholder.trim()) cleaned.placeholder = merged.placeholder;
    if (merged.helpText && merged.helpText.trim()) cleaned.helpText = merged.helpText;
    if (merged.required === false) cleaned.required = false;
    const core: CoreOverrides = { ...(section.core ?? {}) };
    if (Object.keys(cleaned).length === 0) delete core[key];
    else core[key] = cleaned;
    const nextKeys = Object.keys(core);
    onPatch({ core: nextKeys.length > 0 ? core : undefined });
  }

  return (
    <Card className="gap-4 rounded-2xl p-5 md:p-6">
      {/* Kepala bagian: judul + deskripsi + kontrol urutan/kunci/hapus */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Label className="sr-only" htmlFor={`section-title-${section.id}`}>
            Judul bagian
          </Label>
          <Input
            id={`section-title-${section.id}`}
            value={section.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            maxLength={FORM_LIMITS.sectionTitleMax}
            placeholder="Judul bagian"
            className="h-10 border-transparent bg-zinc-50/60 text-base font-semibold dark:bg-zinc-900/40"
            disabled={!canMutate}
          />
          <Label className="sr-only" htmlFor={`section-desc-${section.id}`}>
            Deskripsi bagian
          </Label>
          <Input
            id={`section-desc-${section.id}`}
            value={section.description ?? ""}
            onChange={(e) => onPatch({ description: e.target.value || undefined })}
            maxLength={FORM_LIMITS.sectionDescMax}
            placeholder="Deskripsi opsional untuk bagian ini"
            className="mt-1.5 h-9 border-transparent bg-zinc-50/60 text-sm text-muted-foreground dark:bg-zinc-900/40"
            disabled={!canMutate}
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            icon={ChevronUp}
            label="Naikkan bagian"
            onClick={() => onMove(-1)}
            disabled={!canMutate || index === 0}
          />
          <IconButton
            icon={ChevronDown}
            label="Turunkan bagian"
            onClick={() => onMove(1)}
            disabled={!canMutate || index === totalSections - 1}
          />
          {kunciDeletable ? (
            <IconButton
              icon={Trash2}
              label="Hapus bagian bawaan (mode kunci)"
              onClick={() => {
                setKunciOpen((open) => !open);
                setKunciInput("");
              }}
              disabled={!canMutate}
            />
          ) : isBuiltin ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "size-8 shrink-0",
                    locked
                      ? "text-muted-foreground/70 hover:text-foreground"
                      : "border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
                  )}
                  onClick={onToggleLock}
                  disabled={!canMutate}
                  aria-label={locked ? "Buka kunci bagian" : "Kunci bagian"}
                >
                  {locked ? (
                    <Lock className="size-3.5" aria-hidden="true" />
                  ) : (
                    <LockOpen className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60">
                {locked
                  ? "Terkunci — bagian inti tidak bisa dihapus. Klik untuk membuka kunci."
                  : "Kunci terbuka — bagian bisa dihapus. Klik untuk mengunci kembali."}
              </TooltipContent>
            </Tooltip>
          ) : null}
          <IconButton
            icon={Trash2}
            label={locked ? "Buka kunci dulu untuk menghapus" : "Hapus bagian"}
            onClick={() => setConfirmRemove(true)}
            disabled={!canMutate || locked}
          />
        </div>
      </div>

      {/* NR-23 — panel kunci inline (tanpa dialog): konfirmasi penghapusan bagian
          bawaan dengan mengetik "kunci". Konfirmasi hanya menandai tombstone —
          bagian tetap tersimpan dan bisa dipulihkan di daftar bawah. */}
      {kunciDeletable && kunciOpen ? (
        <div
          className="flex flex-col gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
          role="group"
          aria-label="Konfirmasi penghapusan bagian bawaan"
        >
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Bagian bawaan dilindungi. Ketik &quot;kunci&quot; untuk membuka proteksi penghapusan.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={kunciInput}
              onChange={(e) => setKunciInput(e.target.value)}
              maxLength={20}
              placeholder='Ketik "kunci"'
              aria-label="Ketik kunci untuk membuka proteksi penghapusan"
              autoComplete="off"
              className="h-9 w-44"
              disabled={!canMutate}
            />
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="h-9"
              onClick={() => {
                setKunciOpen(false);
                setKunciInput("");
                onRemoveBuiltin();
              }}
              disabled={!canMutate || !kunciMatch}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Hapus Bagian
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                setKunciOpen(false);
                setKunciInput("");
              }}
            >
              Batal
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Bagian tidak hilang permanen — tersimpan sebagai batu nisan dan bisa dipulihkan dari
            daftar bagian bawaan yang dihapus.
          </p>
        </div>
      ) : null}

      {/* Isi khusus bagian bawaan — NR-26: setiap item inti kini kartu editor
          penuh (label, placeholder, teks bantuan, status wajib) seperti
          pertanyaan kustom; slot pengalaman/motivasi/berkas tetap punya
          saklar Aktif dan WA/CV/intro/portofolio tetap memakai flag lama. */}
      {section.kind === "biodata" ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <CoreItemCard
            section={section}
            itemKey="name"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            requiredLocked
            showTextConfig
            hint="Identitas pelamar — selalu wajib."
          />
          <CoreItemCard
            section={section}
            itemKey="email"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            showTextConfig
            required={isEmailRequired(section)}
            onRequiredChange={(checked) => patchCoreItem("email", { required: checked ? undefined : false })}
            hint="Dipakai kirim update & deteksi lamaran ganda."
          />
          <CoreItemCard
            section={section}
            itemKey="wa"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            showTextConfig
            required={isWaRequired(section)}
            onRequiredChange={(checked) => onPatch({ waRequired: checked })}
          />
          {/* NR-32 — item inti opsional: mati secara bawaan (opt-in admin).
              Jawabannya tersimpan sebagai kolom tersendiri Application.nik /
              Application.birthDate, bukan teks bebas. */}
          <CoreItemCard
            section={section}
            itemKey="nik"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            canDisable
            enabled={isNikEnabled(section)}
            onToggleEnabled={(checked) => onPatch({ nikEnabled: checked })}
            required={isNikRequired(section)}
            onRequiredChange={(checked) => onPatch({ nikRequired: checked })}
            showTextConfig
            hint="16 digit sesuai KTP — tersimpan sebagai kolom tersendiri."
          />
          <CoreItemCard
            section={section}
            itemKey="birthDate"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            canDisable
            enabled={isBirthDateEnabled(section)}
            onToggleEnabled={(checked) => onPatch({ birthDateEnabled: checked })}
            required={isBirthDateRequired(section)}
            onRequiredChange={(checked) => onPatch({ birthDateRequired: checked })}
            showTextConfig
            hint="Terstruktur (pemilih tanggal) — dipakai hitung umur otomatis."
          />
          <p className="text-xs text-muted-foreground">
            Bagian Data Diri selalu tersedia untuk identitas pelamar &amp; deteksi lamaran ganda —
            tidak bisa dihapus. Item opsional boleh dikosongkan pelamar.
          </p>
        </div>
      ) : null}

      {section.kind === "experience" ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <CoreItemCard
            section={section}
            itemKey="experience"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            canDisable
            enabled={isExperienceEnabled(section)}
            onToggleEnabled={(checked) => onPatch({ experienceEnabled: checked })}
            required={isExperienceRequired(section)}
            onRequiredChange={(checked) => patchCoreItem("experience", { required: checked ? undefined : false })}
            showTextConfig
          />
          <CoreItemCard
            section={section}
            itemKey="motivation"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            canDisable
            enabled={isMotivationEnabled(section)}
            onToggleEnabled={(checked) => onPatch({ motivationEnabled: checked })}
            required={isMotivationRequired(section)}
            onRequiredChange={(checked) => patchCoreItem("motivation", { required: checked ? undefined : false })}
            showTextConfig
          />
          <p className="text-xs text-muted-foreground">
            Matikan keduanya dan biarkan tanpa pertanyaan tambahan agar langkah ini dilewati di
            wizard. Item opsional boleh dikosongkan pelamar.
          </p>
        </div>
      ) : null}

      {section.kind === "files" ? (
        <div className="flex flex-col gap-3 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <CoreItemCard
            section={section}
            itemKey="cv"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            canDisable
            enabled={isCvEnabled(section)}
            onToggleEnabled={(checked) => onPatch({ cvEnabled: checked })}
            required={isCvRequired(section)}
            onRequiredChange={(checked) => onPatch({ cvRequired: checked })}
            formatHint="PDF, maks 5 MB — dipakai screening AI & arsip."
          />
          <CoreItemCard
            section={section}
            itemKey="intro"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            canDisable
            enabled={isIntroEnabled(section)}
            onToggleEnabled={(checked) => onPatch({ introEnabled: checked })}
            required={isIntroRequired(section)}
            onRequiredChange={(checked) => onPatch({ introRequired: checked })}
            formatHint="Audio (mp3/wav/m4a) atau video pendek — maks 10 MB."
          />
          <CoreItemCard
            section={section}
            itemKey="portfolio"
            canMutate={canMutate}
            onPatchCoreItem={patchCoreItem}
            canDisable
            enabled={isPortfolioEnabled(section)}
            onToggleEnabled={(checked) => onPatch({ portfolioEnabled: checked })}
            required={isPortfolioRequired(section)}
            onRequiredChange={(checked) => onPatch({ portfolioRequired: checked })}
            formatHint="Tautan Behance, Dribbble, Drive, atau YouTube."
          />
          <p className="text-xs text-muted-foreground">
            Matikan semua slot &amp; tanpa pertanyaan agar langkah dilewati.
          </p>
        </div>
      ) : null}

      {/* Daftar pertanyaan kustom bagian ini */}
      {fields.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          Belum ada pertanyaan di bagian ini.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {fields.map((field, fieldIndex) => (
            <FieldEditorCard
              key={field.id}
              field={field}
              fieldIndex={fieldIndex}
              sectionFields={fields}
              canMoveUp={fieldIndex > 0}
              canMoveDown={fieldIndex < fields.length - 1}
              canMutate={canMutate}
              onChange={(patch) => onFieldChange(field.id, patch)}
              onMove={(dir) => onFieldMove(field.id, dir)}
              onDuplicate={() => onFieldDuplicate(field.id)}
              onRemove={() => onFieldRemove(field.id)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 w-fit"
          onClick={onAddField}
          disabled={!canMutate || !canAddField}
        >
          <Plus className="size-4" aria-hidden="true" />
          Tambah pertanyaan
        </Button>
        {/* NR-32 — paket pertanyaan siap pakai. Hanya untuk bagian biodata &
            kustom: Pengalaman/Berkas berisi item inti terstruktur (slot teks &
            berkas), bukan tempat paket pertanyaan. */}
        {section.kind === "biodata" || section.kind === "custom" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-fit"
                disabled={!canMutate || !canAddField}
              >
                <LayoutTemplate className="size-4" aria-hidden="true" />
                Dari template
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              {FORM_TEMPLATES.map((template) => (
                <DropdownMenuItem
                  key={template.id}
                  onClick={() => onApplyTemplate(template)}
                  className="flex-col items-start gap-0.5 py-2.5"
                >
                  <span className="flex w-full items-center justify-between gap-3">
                    <span className="font-medium">{template.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {template.fields.length} pertanyaan
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs font-normal text-muted-foreground">
                    {template.description}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* Konfirmasi hapus — pengaman kedua setelah kunci (anti-hapus-sengaja) */}
      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Hapus bagian "{section.title.trim() || "tanpa judul"}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Bagian dihapus dari draf saat kamu menekan "Simpan &amp; Terapkan" — sebelum
              disimpan, kamu masih bisa membatalknya. Pertanyaan di dalamnya harus dipindahkan
              atau dihapus dulu.
              {section.kind === "biodata"
                ? " Identitas (nama & email) tetap dikumpulkan wizard dengan label bawaan bila bagian ini dihapus."
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={onRemove}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ------------------------------- Kartu field ------------------------------- */

function FieldEditorCard({
  field,
  fieldIndex,
  sectionFields,
  canMoveUp,
  canMoveDown,
  canMutate,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  field: FormField;
  /** Posisi field ini di daftar field bagian — kandidat showIf harus di atasnya. */
  fieldIndex: number;
  /** Seluruh field bagian yang sama (urutan draf) — sumber showIf pilihan. */
  sectionFields: FormField[];
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

  // NR-32 — kandidat sumber showIf: field pilihan (radio/checkbox/dropdown) di
  // bagian yang sama yang muncul SEBELUM field ini (kontrak normalizeShowIf:
  // anti-lingkaran lewat urutan array draf).
  const showIfSources = useMemo(
    () =>
      sectionFields
        .slice(0, Math.max(0, fieldIndex))
        .filter((f) => f.id !== field.id && isChoiceType(f.type)),
    [sectionFields, fieldIndex, field.id],
  );
  const showIfSource = field.showIf
    ? showIfSources.find((f) => f.id === field.showIf?.fieldId)
    : undefined;

  // Sumber showIf hilang (dihapus/diubah tipe/dipindah ke bawah field ini) —
  // bersihkan draf agar UI tidak menampilkan syarat mati; sanitasi server
  // (normalizeShowIf) tetap jaring pengaman saat "Simpan & Terapkan".
  useEffect(() => {
    if (field.showIf && !showIfSource) onChange({ showIf: undefined });
  }, [field.showIf, showIfSource, onChange]);

  /** NR-32 — centang/hapus satu nilai syarat tampil (checkbox = cocok salah satu). */
  function toggleShowIfValue(option: string, checked: boolean) {
    if (!field.showIf) return;
    const values = checked
      ? Array.from(new Set([...field.showIf.values, option]))
      : field.showIf.values.filter((v) => v !== option);
    onChange({ showIf: { ...field.showIf, values } });
  }

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

      {/* NR-32 — pengelompokan (sub-header wizard) & hint isi-otomatis browser.
          Berlaku untuk semua tipe; kosong = tanpa kelompok / tanpa isi-otomatis. */}
      <div className="grid gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`group-${field.id}`} className="text-xs text-muted-foreground">
            Kelompok (sub-header, opsional)
          </Label>
          <Input
            id={`group-${field.id}`}
            value={field.group ?? ""}
            onChange={(e) => onChange({ group: e.target.value || undefined })}
            maxLength={FORM_LIMITS.labelMax}
            placeholder="cth. Kontak Darurat — kosongkan bila tanpa kelompok"
            className="h-9"
            disabled={!canMutate}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`groupEn-${field.id}`} className="text-xs text-muted-foreground">
            Kelompok (EN)
          </Label>
          <Input
            id={`groupEn-${field.id}`}
            value={field.groupEn ?? ""}
            onChange={(e) => onChange({ groupEn: e.target.value || undefined })}
            maxLength={FORM_LIMITS.labelMax}
            placeholder="cth. Emergency Contact"
            className="h-9"
            disabled={!canMutate}
          />
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Label htmlFor={`autocomplete-${field.id}`} className="text-xs text-muted-foreground">
            Isi-otomatis browser
          </Label>
          <Select
            value={field.autocomplete ?? "none"}
            onValueChange={(v) => onChange({ autocomplete: v === "none" ? undefined : v })}
            disabled={!canMutate}
          >
            <SelectTrigger id={`autocomplete-${field.id}`} className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tanpa isi-otomatis</SelectItem>
              {FORM_AUTOCOMPLETE_KEYS.map((key) => (
                <SelectItem key={key} value={key}>
                  {FORM_AUTOCOMPLETE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* NR-32 — tampil bersyarat: hanya pertanyaan pilihan yang bisa bergantung
          pada pertanyaan pilihan lain DI ATASNYA (bagian sama — kontrak server). */}
      {isChoiceType(field.type) ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <Label htmlFor={`showif-${field.id}`} className="text-xs text-muted-foreground">
            Tampilkan hanya jika
          </Label>
          {showIfSources.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Butuh pertanyaan pilihan di atas field ini.
            </p>
          ) : (
            <>
              <Select
                value={field.showIf?.fieldId ?? SHOWIF_ALWAYS}
                onValueChange={(v) => {
                  if (v === SHOWIF_ALWAYS) {
                    onChange({ showIf: undefined });
                    return;
                  }
                  // Ganti sumber: reset nilai agar opsi field lain tidak ikut tersimpan.
                  onChange({ showIf: { fieldId: v, values: [] } });
                }}
                disabled={!canMutate}
              >
                <SelectTrigger id={`showif-${field.id}`} className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SHOWIF_ALWAYS}>Selalu tampil</SelectItem>
                  {showIfSources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      <span className="block max-w-56 truncate">
                        {source.label.trim() || "(tanpa judul)"}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {field.showIf && showIfSource ? (
                <div className="flex flex-col gap-1.5 rounded-md border bg-background p-2.5">
                  <p className="text-xs text-muted-foreground">
                    Tampilkan bila jawaban &quot;
                    {showIfSource.label.trim() || "pertanyaan sumber"}&quot; adalah:
                  </p>
                  {showIfSource.options.map((option) => (
                    <label
                      key={option}
                      className="flex min-h-8 cursor-pointer items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={field.showIf?.values.includes(option) ?? false}
                        onCheckedChange={(checked) => toggleShowIfValue(option, checked === true)}
                        disabled={!canMutate}
                        aria-label={`Tampilkan bila jawaban ${option}`}
                      />
                      <span className="truncate">{option}</span>
                    </label>
                  ))}
                  {field.showIf.values.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Pilih minimal satu nilai — tanpa itu pertanyaan tidak akan tampil.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
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
  onOpenIntake,
}: {
  position: Position;
  onBack: () => void;
  onUpdated: (position: Position) => void;
  /** Opsional: buka detail lamaran dari tab Jawaban (halaman lain, bukan dialog di sini). */
  onOpenApplication?: (applicationId: string) => void;
  /** Opsional: buka sub-halaman "Penerimaan" (kuota, jadwal tayang, buka/tutup pindah ke sana). */
  onOpenIntake?: () => void;
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
  // NR-23 — kunci anti-hapus bagian inti: default TERKUNCI, dibuka manual per
  // sesi edit (tidak tersimpan) agar setiap muat ulang kembali terkunci.
  // NR-26 — buka/tutup kunci edit item inti satu bagian bawaan.
  function toggleCoreLock(id: string) {
    setUnlockedCoreIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }
  const [unlockedCoreIds, setUnlockedCoreIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ schema: FormSchema | null; derived: FormSchema | null }>(
      `/api/admin/positions/${position.id}/form`,
    )
      .then((data) => {
        if (cancelled) return;
        // GET sudah mengembalikan v2; normalisasi defensif hanya merakit ulang
        // skema v1 sisa menjadi v2 (skema v2 dipercaya apa adanya — NR-23).
        const saved = normalizeFormSchema(data.schema ?? null);
        const derived = normalizeFormSchema(data.derived ?? null);
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

  function updateSection(sectionId: string, patch: Partial<Omit<FormSection, "id" | "kind">>) {
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    }));
  }

  /**
   * NR-23 — pindahkan bagian pada urutan TAMPIL (bagian bertombstone tidak
   * dihitung) tetapi array penuh tetap memuat tombstone di posisinya: slot
   * non-tombstone diisi ulang sesuai urutan baru, tombstone menahan tempat.
   */
  function moveSection(sectionId: string, dir: 1 | -1) {
    setDraft((prev) => {
      const visible = prev.sections.filter((s) => !s.removed);
      const vIndex = visible.findIndex((s) => s.id === sectionId);
      const vTarget = vIndex + dir;
      if (vIndex < 0 || vTarget < 0 || vTarget >= visible.length) return prev;
      const newVisible = [...visible];
      [newVisible[vIndex], newVisible[vTarget]] = [newVisible[vTarget], newVisible[vIndex]];
      let cursor = 0;
      const sections = prev.sections.map((s) => (s.removed ? s : newVisible[cursor++]));
      return { ...prev, sections };
    });
  }

  function addSection() {
    setDraft((prev) => {
      // Batas dihitung dari bagian TAMBAHAN (kustom), bukan total bagian —
      // bagian inti tidak dihitung.
      if (customSectionCount(prev) >= FORM_LIMITS.maxSections) return prev;
      if (prev.sections.length >= FORM_LIMITS.maxTotalSections) return prev;
      return {
        ...prev,
        sections: insertCustomSection(prev.sections, {
          id: newFormId("sec"),
          kind: "custom",
          title: `Bagian ${customSectionCount(prev) + 1}`,
        }),
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

  /**
   * NR-23 — hapus bagian bawaan (Pengalaman/Berkas) via mode kunci: TIDAK
   * dihapus fisik, hanya ditandai tombstone `removed: true` agar bisa
   * dipulihkan. Biodata tidak pernah lewat sini. Sama seperti hapus kustom,
   * bagian yang masih memuat pertanyaan ditolak (pertanyaan wajib di bagian
   * yang tak terlihat bisa menggagalkan submit pelamar).
   */
  function tombstoneSection(sectionId: string) {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section || !isBuiltinSection(section) || section.kind === "biodata") return;
    if (draft.fields.some((f) => f.sectionId === sectionId)) {
      toast.error("Bagian masih berisi pertanyaan. Hapus atau pindahkan pertanyaannya dulu.");
      return;
    }
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, removed: true } : s)),
    }));
    toast.success(`Bagian "${section.title}" dihapus — dapat dipulihkan di daftar bagian bawaan.`);
  }

  /** NR-23 — pulihkan bagian bawaan bertombstone ke posisi aslinya. */
  function restoreSection(sectionId: string) {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section || section.removed !== true) return;
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) => (s.id === sectionId ? { ...s, removed: undefined } : s)),
    }));
    toast.success(`Bagian "${section.title}" dipulihkan ke posisi aslinya.`);
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

  /**
   * NR-32 — suntik paket pertanyaan dari template ke satu bagian (biodata atau
   * kustom). ID final dibangun dari key template agar unik per posisi, dan
   * showIf antar-field dipetakan oleh expandTemplateFields (sumber selalu
   * sebelum field bergantung dalam urutan array). Template dengan enablesCore
   * (Data Diri Lengkap) ikut MENYALAKAN item inti NIK & Tanggal Lahir saat
   * diterapkan ke bagian biodata.
   */
  function applyTemplateToSection(sectionId: string, template: FormTemplate) {
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section || (section.kind !== "biodata" && section.kind !== "custom")) return;
    const remaining = FORM_LIMITS.maxFields - draft.fields.length;
    if (remaining <= 0) {
      toast.error(
        `Maksimal ${FORM_LIMITS.maxFields} pertanyaan tercapai — hapus beberapa pertanyaan dulu.`,
      );
      return;
    }
    if (template.fields.length > remaining) {
      toast.error(
        `Template "${template.name}" butuh ${template.fields.length} slot pertanyaan — tersisa ${remaining}. Hapus beberapa pertanyaan dulu.`,
      );
      return;
    }
    const expanded = expandTemplateFields(template, (key) => newFormId(`tpl_${key}`));
    const enablesCore = section.kind === "biodata" ? template.enablesCore : undefined;
    setDraft((prev) => ({
      ...prev,
      sections: prev.sections.map((s) =>
        s.id === sectionId && enablesCore
          ? {
              ...s,
              nikEnabled: enablesCore.nik === true ? true : s.nikEnabled,
              birthDateEnabled: enablesCore.birthDate === true ? true : s.birthDateEnabled,
            }
          : s,
      ),
      fields: [...prev.fields, ...expanded.map((f) => ({ ...f, sectionId }))],
    }));
    toast.success(`${expanded.length} pertanyaan ditambahkan dari template "${template.name}".`);
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
      // Kirim skema v2 lengkap; retiredFields dikembalikan apa adanya — server
      // yang menggabungkannya dengan makam field lama.
      const res = await apiPut<FormPutResponse>(`/api/admin/positions/${position.id}/form`, {
        schema: { ...draft, version: FORM_SCHEMA_VERSION },
      });
      if (res.schema) {
        setDraft(res.schema);
        setSavedSchema(res.schema);
      }
      if (res.position) onUpdated(res.position);
      // Kunci bagian inti otomatis terpasang kembali setelah menyimpan —
      // penghapusan selalu butuh buka kunci baru di sesi berikutnya.
      setUnlockedCoreIds([]);
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
        // Hasil AI selalu opsional (konsisten dgn generator di halaman edit posisi);
        // admin bisa menandai wajib manual lewat saklar "Wajib diisi".
        newFields.push({
          id: newFormId("fld"),
          sectionId: "__target__",
          type: "text",
          label,
          required: false,
          options: [],
          allowOther: false,
          maxLen: FORM_LIMITS.textDefaultMax,
        });
      }
      if (newFields.length === 0) {
        toast.info("Tidak ada pertanyaan baru dari AI (sudah ada semua atau batas tercapai).");
        return;
      }
      // Target: bagian KUSTOM terakhir. Bila belum ada, siapkan bagian baru
      // "Pertanyaan Screening" — hormati batas bagian tambahan.
      const createsSection = !draft.sections.some((s) => s.kind === "custom");
      if (createsSection) {
        const canCreate =
          customSectionCount(draft) < FORM_LIMITS.maxSections &&
          draft.sections.length < FORM_LIMITS.maxTotalSections;
        if (!canCreate) {
          toast.error(
            `Maksimal ${FORM_LIMITS.maxSections} bagian tambahan — hasil AI tidak bisa ditempatkan.`,
          );
          return;
        }
      }
      setDraft((prev) => {
        const lastCustom = [...prev.sections].reverse().find((s) => s.kind === "custom");
        if (lastCustom) {
          return {
            ...prev,
            fields: [
              ...prev.fields,
              ...newFields.map((f) => ({ ...f, sectionId: lastCustom.id })),
            ],
          };
        }
        const section: FormSection = {
          id: newFormId("sec"),
          kind: "custom",
          title: "Pertanyaan Screening",
        };
        return {
          ...prev,
          sections: insertCustomSection(prev.sections, section),
          fields: [...prev.fields, ...newFields.map((f) => ({ ...f, sectionId: section.id }))],
        };
      });
      toast.success(
        createsSection
          ? `${newFields.length} pertanyaan dari AI ditambahkan ke bagian baru "Pertanyaan Screening".`
          : `${newFields.length} pertanyaan dari AI ditambahkan ke bagian kustom terakhir.`,
      );
    } catch (err) {
      reportError(err);
    } finally {
      setAiLoading(false);
    }
  }

  /* ------------------------------- Tab Jawaban ------------------------------- */

  const [responses, setResponses] = useState<FormResponsesData | null>(null);
  const [responsesState, setResponsesState] = useState<
    "idle" | "ready" | "not-builder" | "error"
  >("idle");
  // Fetch terpisah dari "state" agar segarkan tidak mengganti konten jadi skeleton.
  const [responsesFetching, setResponsesFetching] = useState(false);
  const [responsesLoaded, setResponsesLoaded] = useState(false);

  async function loadResponses() {
    setResponsesFetching(true);
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
    } finally {
      setResponsesFetching(false);
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

  /* --------------------------------- Navigasi --------------------------------- */

  function handleBackClick() {
    if (dirty) setDiscardOpen(true);
    else onBack();
  }

  function handleTabChange(value: string) {
    if (value !== "pertanyaan" && value !== "jawaban") return;
    if (value === "jawaban" && !responsesLoaded) {
      setResponsesLoaded(true);
      void loadResponses();
    }
  }

  const csvUrl = `/api/admin/positions/${position.id}/form-responses?format=csv`;
  const totalFields = draft.fields.length;
  const customCount = customSectionCount(draft);
  // NR-23 — kartu bagian hanya menampilkan bagian aktif (bukan tombstone);
  // batu nisan bagian bawaan muncul di area "Bagian bawaan yang dihapus".
  const visibleSections = useMemo(() => draft.sections.filter((s) => !s.removed), [draft.sections]);
  const removedBuiltinSections = useMemo(
    () => draft.sections.filter((s) => s.removed === true && isBuiltinSection(s)),
    [draft.sections],
  );

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
              <h2 className="text-lg font-bold leading-tight">
                Formulir Lamaran
                <span className="text-muted-foreground"> — {position.title}</span>
              </h2>
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
              {visibleSections.map((section, sectionIndex) => (
                <Reveal key={section.id} delay={Math.min(sectionIndex * 0.04, 0.2)}>
                  <SectionCard
                    section={section}
                    index={sectionIndex}
                    totalSections={visibleSections.length}
                    fields={draft.fields.filter((f) => f.sectionId === section.id)}
                    canAddField={totalFields < FORM_LIMITS.maxFields}
                    canMutate={canMutate}
                    locked={section.kind !== "custom" && !unlockedCoreIds.includes(section.id)}
                    onToggleLock={() => toggleCoreLock(section.id)}
                    onPatch={(patch) => updateSection(section.id, patch)}
                    onMove={(dir) => moveSection(section.id, dir)}
                    onRemove={() => removeSection(section.id)}
                    onRemoveBuiltin={() => tombstoneSection(section.id)}
                    onFieldChange={updateField}
                    onFieldMove={moveField}
                    onFieldDuplicate={duplicateField}
                    onFieldRemove={removeField}
                    onAddField={() => addField(section.id)}
                    onApplyTemplate={(template) => applyTemplateToSection(section.id, template)}
                  />
                </Reveal>
              ))}

              {/* NR-23 — makam bagian bawaan: tombstone tetap tersimpan di skema
                  agar bisa dipulihkan; pulihkan mengembalikan flag removed dan
                  bagian kembali ke posisi array aslinya. */}
              {removedBuiltinSections.length > 0 ? (
                <div
                  className="flex flex-col gap-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-4 dark:border-amber-900 dark:bg-amber-950/20"
                  aria-label="Bagian bawaan yang dihapus"
                >
                  <p className="text-sm font-medium">Bagian bawaan yang dihapus</p>
                  {removedBuiltinSections.map((section) => (
                    <div
                      key={section.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate text-sm">{section.title}</span>
                        <Badge
                          variant="outline"
                          className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                        >
                          Bawaan — {FORM_SECTION_KIND_LABELS[section.kind]}
                        </Badge>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        onClick={() => restoreSection(section.id)}
                        disabled={!canMutate}
                      >
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                        Pulihkan
                      </Button>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">Dipulihkan ke posisi aslinya.</p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-fit sm:h-10"
                  onClick={addSection}
                  disabled={!canMutate || customCount >= FORM_LIMITS.maxSections}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Tambah Bagian
                  <span className="text-xs text-muted-foreground">
                    ({customCount}/{FORM_LIMITS.maxSections})
                  </span>
                </Button>
                {customCount >= FORM_LIMITS.maxSections ? (
                  <p className="text-xs text-muted-foreground">
                    Maksimal {FORM_LIMITS.maxSections} bagian tambahan.
                  </p>
                ) : null}
              </div>

              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>
                  Urutan wizard publik mengikuti urutan bagian di atas — Pratinjau selalu terakhir.
                </span>
                <Badge variant="secondary" className="ml-1">
                  {totalFields}/{FORM_LIMITS.maxFields} pertanyaan
                </Badge>
              </p>

              {/* Setelan penerimaan (kuota, jadwal tayang, buka/tutup) pindah ke Penerimaan */}
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
                <p className="text-xs text-muted-foreground">
                  Kuota pelamar, jadwal tayang, dan buka/tutup formulir kini dikelola di halaman
                  Penerimaan.
                </p>
                {onOpenIntake ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-9 shrink-0"
                    onClick={() => onOpenIntake?.()}
                    aria-label="Buka halaman Penerimaan"
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                    Buka Penerimaan
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </TabsContent>

        {/* ================================= JAWABAN ================================= */}
        <TabsContent value="jawaban" className="flex flex-col gap-4">
          {responsesState === "idle" || (responsesFetching && responses === null) ? (
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
                <div className="flex items-center gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-9 sm:size-8"
                        onClick={() => void loadResponses()}
                        disabled={responsesFetching}
                        aria-label="Segarkan data jawaban"
                      >
                        <Loader2
                          className={cn(
                            "size-4",
                            responsesFetching && "animate-spin",
                          )}
                          aria-hidden="true"
                        />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Segarkan</TooltipContent>
                  </Tooltip>
                  <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                    <a href={csvUrl} download>
                      <FileDown className="size-4" aria-hidden="true" />
                      Unduh CSV
                    </a>
                  </Button>
                </div>
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
