"use client";

// Halaman KONTEN posisi — sub-halaman "Satu Pintu Kelola Posisi". Hanya
// berisi konten lowongan: Dasar, Konten Bahasa Inggris (opsional), Cover,
// Gaji, Badge Posisi, Benefit, Contoh Karya (+ switch Publikasi saat membuat
// posisi baru). Setelan lain (Publikasi & Status, Pipeline & AI, Otomasi Pesan,
// Evaluasi, Wawancara, Penawaran & Onboarding) kini ada di halaman setelan
// per posisi (position-settings-pages.tsx).
// Dipakai untuk EDIT (dari PositionManagePage) maupun TAMBAH posisi baru
// (dari daftar Posisi). Layout: tiap kelompok isi menjadi KARTU SECTION
// TERPISAH (latar sendiri) yang bisa DICIUTKAN lewat header — default
// TERTUTUP; section dengan error validasi membuka otomatis. Batas
// karakter/item dikunci via maxLength & maxItems editor (selaras server).

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  BookmarkPlus,
  Briefcase,
  Clapperboard,
  Flame,
  Gift,
  History,
  Image as ImageIcon,
  Languages,
  LayoutTemplate,
  Loader2,
  Pin,
  Send,
  Trash2,
  Upload,
  Wallet,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import {
  INTERVIEW_MODES,
  INTERVIEW_PLATFORMS,
  POSITION_TYPES,
  STAGE_CATEGORIES,
  type AiCoverResponse,
  type AdminUploadResponse,
  type InterviewMode,
  type InterviewPlatform,
  type Position,
  type PositionStatsRow,
  type ScreeningQuestion,
  type StageCategory,
} from "@/lib/types";
import { apiFetch, apiGet, apiPatch, apiPost } from "./api";
import { formatDateTime, isoToLocalInput, localInputToIso } from "./format";
import { useAdminSession } from "./admin-context";
import { StringListEditor } from "./position-list-editors";
import {
  CUSTOM_DOC_MAX_LEN,
  FormSection,
  MAX_CUSTOM_DOCS,
  isInt,
} from "./position-form-parts";

type FormState = {
  title: string;
  department: string;
  type: string;
  location: string;
  description: string;
  requirements: string[];
  // Konten dua bahasa (opsional) — fallback versi Indonesia bila kosong.
  titleEn: string;
  descriptionEn: string;
  requirementsEn: string[];
  isActive: boolean;
  publishAtLocal: string;
  closesAtLocal: string;
  order: string;
  coverFileId: string | null;
  salaryText: string;
  // Rentang gaji wajar — dipakai peringatan saat membuat offer
  salaryMin: string;
  salaryMax: string;
  salaryVisible: boolean;
  benefits: string[];
  examples: string[];
  urgent: boolean;
  featured: boolean;
  requireCv: boolean;
  requireIntro: boolean;
  requirePortfolio: boolean;
  maxApplicants: string;
  applyOpen: boolean;
  screeningQuestions: ScreeningQuestion[];
  stages: string[];
  stageCategories: Record<string, StageCategory>;
  aiCriteria: string;
  autoShortlistScore: string;
  autoShortlistStage: string; // "" = nonaktif
  applyTemplate: string;
  acceptTemplate: string;
  rejectTemplate: string;
  assignmentTitle: string;
  assignmentUrl: string;
  assignmentNote: string;
  rubricCriteria: string[];
  checklistTemplate: string[];
  noteTemplates: string[];
  interviewMode: InterviewMode;
  interviewPlatform: InterviewPlatform;
  interviewDuration: string;
  // Rencana ronde wawancara (template untuk "Jadwalkan Ronde Berikutnya")
  roundPlan: { name: string; durationMin: string; interviewers: string }[];
  interviewCriteria: string[];
  interviewInviteTemplate: string;
  offerTemplate: string;
  welcomeTemplate: string;
  probationMonths: string;
  onboardingDocs: string[];
  reapplyCooldownDays: string;
  autoCloseOnHired: boolean;
};

const EMPTY_FORM: FormState = {
  title: "",
  department: "",
  type: "Full-time",
  location: "Remote",
  description: "",
  requirements: [],
  titleEn: "",
  descriptionEn: "",
  requirementsEn: [],
  isActive: true,
  publishAtLocal: "",
  closesAtLocal: "",
  order: "",
  coverFileId: null,
  salaryText: "",
  salaryMin: "",
  salaryMax: "",
  salaryVisible: false,
  benefits: [],
  examples: [],
  urgent: false,
  featured: false,
  requireCv: true,
  requireIntro: false,
  requirePortfolio: false,
  maxApplicants: "",
  applyOpen: true,
  screeningQuestions: [],
  stages: [],
  stageCategories: {},
  aiCriteria: "",
  autoShortlistScore: "",
  autoShortlistStage: "",
  applyTemplate: "",
  acceptTemplate: "",
  rejectTemplate: "",
  assignmentTitle: "",
  assignmentUrl: "",
  assignmentNote: "",
  rubricCriteria: [],
  checklistTemplate: [],
  noteTemplates: [],
  interviewMode: "ONLINE",
  interviewPlatform: "GOOGLE_MEET",
  interviewDuration: "45",
  roundPlan: [],
  interviewCriteria: [],
  interviewInviteTemplate: "",
  offerTemplate: "",
  welcomeTemplate: "",
  probationMonths: "",
  onboardingDocs: [],
  reapplyCooldownDays: "",
  autoCloseOnHired: false,
};

function buildFormState(p: Position): FormState {
  return {
    title: p.title,
    department: p.department,
    type: POSITION_TYPES.includes(p.type as (typeof POSITION_TYPES)[number])
      ? p.type
      : POSITION_TYPES[0],
    location: p.location || "Remote",
    description: p.description,
    requirements: [...p.requirements],
    titleEn: p.titleEn ?? "",
    descriptionEn: p.descriptionEn ?? "",
    requirementsEn: [...(p.requirementsEn ?? [])],
    isActive: p.isActive,
    publishAtLocal: isoToLocalInput(p.publishAt),
    closesAtLocal: isoToLocalInput(p.closesAt),
    order: String(p.order ?? ""),
    coverFileId: p.coverFileId,
    salaryText: p.salaryText ?? "",
    salaryMin: p.salaryMin != null ? String(p.salaryMin) : "",
    salaryMax: p.salaryMax != null ? String(p.salaryMax) : "",
    salaryVisible: p.salaryVisible,
    benefits: [...p.benefits],
    examples: [...p.examples],
    urgent: p.urgent,
    featured: p.featured,
    requireCv: p.requireCv,
    requireIntro: p.requireIntro,
    requirePortfolio: p.requirePortfolio,
    maxApplicants: p.maxApplicants == null ? "" : String(p.maxApplicants),
    applyOpen: p.applyOpen !== false,
    screeningQuestions: p.screeningQuestions.map((q) => ({ ...q })),
    stages: [...p.stages],
    stageCategories: { ...p.stageCategories },
    aiCriteria: p.aiCriteria ?? "",
    autoShortlistScore: p.autoShortlistScore == null ? "" : String(p.autoShortlistScore),
    autoShortlistStage: p.autoShortlistStage ?? "",
    applyTemplate: p.replyTemplates.apply ?? "",
    acceptTemplate: p.replyTemplates.accept ?? "",
    rejectTemplate: p.replyTemplates.reject ?? "",
    assignmentTitle: p.assignment.title ?? "",
    assignmentUrl: p.assignment.url ?? "",
    assignmentNote: p.assignment.note ?? "",
    rubricCriteria: [...p.rubricCriteria],
    checklistTemplate: [...p.checklistTemplate],
    noteTemplates: [...p.noteTemplates],
    interviewMode: p.interviewMode,
    interviewPlatform: p.interviewPlatform,
    interviewDuration: String(p.interviewDuration ?? 45),
    roundPlan: (p.roundPlan ?? []).map((r) => ({
      name: r.name,
      durationMin: r.durationMin != null ? String(r.durationMin) : "",
      interviewers: (r.interviewers ?? []).join(", "),
    })),
    interviewCriteria: [...p.interviewCriteria],
    interviewInviteTemplate: p.interviewInviteTemplate ?? "",
    offerTemplate: p.offerTemplate ?? "",
    welcomeTemplate: p.welcomeTemplate ?? "",
    probationMonths: String(p.probationMonths ?? 0),
    onboardingDocs: [...p.onboardingDocs],
    reapplyCooldownDays: String(p.reapplyCooldownDays ?? 0),
    autoCloseOnHired: p.autoCloseOnHired,
  };
}



const COVER_MAX_BYTES = 3 * 1024 * 1024;
const COVER_MIME = ["image/png", "image/jpeg", "image/webp"];

// ============================================================
// DRAFT AUTOSAVE (hanya mode "Tambah Posisi")
// Seluruh FormState disimpan ke localStorage "lumina-draft-posisi" dengan
// debounce 1500ms. Restore hanya menyalin key yang valid (sanitizer di bawah).
// ============================================================

const DRAFT_KEY = "lumina-draft-posisi";

type DraftEnvelope = { form: FormState; updatedAt: string };

function draftString(value: unknown, maxLen: number, fallback: string): string {
  return typeof value === "string" ? value.slice(0, maxLen) : fallback;
}

// String|null dari payload API → string kosong bila null/bukan string.
function draftStringOrNull(value: unknown, maxLen: number): string {
  return typeof value === "string" ? value.slice(0, maxLen) : "";
}

function draftStringArray(
  value: unknown,
  maxItems: number,
  maxLen: number,
  fallback: string[]
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) return fallback;
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.slice(0, maxLen));
}

function draftBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

// Angka tersimpan sebagai string di FormState — terima angka atau string angka.
function draftNumberString(value: unknown, fallback: string): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return value.trim();
  return fallback;
}

function draftStageCategories(value: unknown): Record<string, StageCategory> {
  const result: Record<string, StageCategory> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 24);
  for (const [stage, category] of entries) {
    const key = typeof stage === "string" ? stage.trim().slice(0, 40) : "";
    if (
      key &&
      typeof category === "string" &&
      (STAGE_CATEGORIES as readonly string[]).includes(category)
    ) {
      result[key] = category as StageCategory;
    }
  }
  return result;
}

function draftScreeningQuestions(value: unknown): ScreeningQuestion[] {
  if (!Array.isArray(value)) return [];
  const items: ScreeningQuestion[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const id = draftStringOrNull(rec.id, 40);
    const label = draftStringOrNull(rec.label, 200).trim();
    if (!id || label.length < 3) continue;
    items.push({ id, label, required: rec.required === true });
    if (items.length >= 10) break;
  }
  return items;
}

// Rencana ronde: bentuk FormState (interviewers string) maupun payload API
// (interviewers string[], durationMin number) diterima agar bisa dipakai ulang
// oleh template posisi.
function draftRoundPlan(value: unknown): FormState["roundPlan"] {
  if (!Array.isArray(value)) return [];
  const rows: FormState["roundPlan"] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const name = draftStringOrNull(rec.name, 60).trim();
    if (!name) continue;
    const durationMin = draftNumberString(rec.durationMin, "");
    const interviewers = Array.isArray(rec.interviewers)
      ? rec.interviewers
          .filter((v): v is string => typeof v === "string")
          .join(", ")
          .slice(0, 300)
      : draftStringOrNull(rec.interviewers, 300);
    rows.push({ name, durationMin, interviewers });
    if (rows.length >= 10) break;
  }
  return rows;
}

/**
 * Salin data mentah (draf localStorage / data template) ke FormState —
 * HANYA key yang valid disalin; key asing diabaikan dan field tidak valid
 * jatuh ke nilai default. Menerima bentuk FormState maupun payload API.
 * Return null bila data bukan objek.
 */
function formDataFromUnknown(raw: unknown): {
  form: FormState;
  customDocs: string[];
} | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const d = raw as Record<string, unknown>;
  return {
    form: {
      title: draftString(d.title, 120, ""),
      department: draftString(d.department, 80, ""),
      type:
        typeof d.type === "string" && (POSITION_TYPES as readonly string[]).includes(d.type)
          ? d.type
          : "Full-time",
      location: draftString(d.location, 120, "Remote"),
      description: draftString(d.description, 20000, ""),
      requirements: draftStringArray(d.requirements, 20, 200, []),
      titleEn: draftStringOrNull(d.titleEn, 120),
      descriptionEn: draftStringOrNull(d.descriptionEn, 20000),
      requirementsEn: draftStringArray(d.requirementsEn, 20, 200, []),
      isActive: draftBoolean(d.isActive, true),
      publishAtLocal:
        draftString(d.publishAtLocal, 40, "") ||
        isoToLocalInput(typeof d.publishAt === "string" ? d.publishAt : null),
      closesAtLocal:
        draftString(d.closesAtLocal, 40, "") ||
        isoToLocalInput(typeof d.closesAt === "string" ? d.closesAt : null),
      order: draftNumberString(d.order, ""),
      coverFileId:
        typeof d.coverFileId === "string" && d.coverFileId
          ? d.coverFileId.slice(0, 64)
          : null,
      salaryText: draftStringOrNull(d.salaryText, 80),
      salaryMin: draftNumberString(d.salaryMin, ""),
      salaryMax: draftNumberString(d.salaryMax, ""),
      salaryVisible: draftBoolean(d.salaryVisible, false),
      benefits: draftStringArray(d.benefits, 10, 120, []),
      examples: draftStringArray(d.examples, 6, 300, []),
      urgent: draftBoolean(d.urgent, false),
      featured: draftBoolean(d.featured, false),
      requireCv: draftBoolean(d.requireCv, true),
      requireIntro: draftBoolean(d.requireIntro, false),
      requirePortfolio: draftBoolean(d.requirePortfolio, false),
      maxApplicants: draftNumberString(d.maxApplicants, ""),
      applyOpen: draftBoolean(d.applyOpen, true),
      screeningQuestions: draftScreeningQuestions(d.screeningQuestions),
      stages: draftStringArray(d.stages, 12, 40, []),
      stageCategories: draftStageCategories(d.stageCategories),
      aiCriteria: draftStringOrNull(d.aiCriteria, 600),
      autoShortlistScore: draftNumberString(d.autoShortlistScore, ""),
      autoShortlistStage: draftStringOrNull(d.autoShortlistStage, 40),
      applyTemplate: draftStringOrNull(d.applyTemplate, 500),
      acceptTemplate: draftStringOrNull(d.acceptTemplate, 500),
      rejectTemplate: draftStringOrNull(d.rejectTemplate, 500),
      assignmentTitle: draftStringOrNull(d.assignmentTitle, 120),
      assignmentUrl: draftStringOrNull(d.assignmentUrl, 300),
      assignmentNote: draftStringOrNull(d.assignmentNote, 400),
      rubricCriteria: draftStringArray(d.rubricCriteria, 8, 60, []),
      checklistTemplate: draftStringArray(d.checklistTemplate, 8, 120, []),
      noteTemplates: draftStringArray(d.noteTemplates, 8, 200, []),
      interviewMode:
        typeof d.interviewMode === "string" &&
        (INTERVIEW_MODES as readonly string[]).includes(d.interviewMode)
          ? (d.interviewMode as InterviewMode)
          : "ONLINE",
      interviewPlatform:
        typeof d.interviewPlatform === "string" &&
        (INTERVIEW_PLATFORMS as readonly string[]).includes(d.interviewPlatform)
          ? (d.interviewPlatform as InterviewPlatform)
          : "GOOGLE_MEET",
      interviewDuration: draftNumberString(d.interviewDuration, "45"),
      roundPlan: draftRoundPlan(d.roundPlan),
      interviewCriteria: draftStringArray(d.interviewCriteria, 8, 60, []),
      interviewInviteTemplate: draftStringOrNull(d.interviewInviteTemplate, 800),
      offerTemplate: draftStringOrNull(d.offerTemplate, 800),
      welcomeTemplate: draftStringOrNull(d.welcomeTemplate, 800),
      probationMonths: draftNumberString(d.probationMonths, ""),
      onboardingDocs: draftStringArray(d.onboardingDocs, 10, 120, []),
      reapplyCooldownDays: draftNumberString(d.reapplyCooldownDays, ""),
      autoCloseOnHired: draftBoolean(d.autoCloseOnHired, false),
    },
    customDocs: draftStringArray(d.customDocs, MAX_CUSTOM_DOCS, CUSTOM_DOC_MAX_LEN, []),
  };
}

// Jumlah field FormState yang berbeda dari nilai default (untuk syarat kartu draf).
function countFilledFields(form: FormState): number {
  let count = 0;
  for (const key of Object.keys(EMPTY_FORM) as (keyof FormState)[]) {
    if (JSON.stringify(form[key]) !== JSON.stringify(EMPTY_FORM[key])) count++;
  }
  return count;
}

function writeDraftToStorage(form: FormState): void {
  try {
    const envelope = { v: 1, updatedAt: new Date().toISOString(), data: form };
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify(envelope));
  } catch {
    // localStorage tidak tersedia/penuh — autosave bersifat best-effort.
  }
}

function removeDraftStorage(): void {
  try {
    window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // diabaikan — konsisten dengan writeDraftToStorage.
  }
}

function readDraftStorage(): DraftEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const env = parsed as Record<string, unknown>;
    const restored = formDataFromUnknown(env.data);
    if (!restored) return null;
    return { form: restored.form, updatedAt: draftStringOrNull(env.updatedAt, 40) };
  } catch {
    return null;
  }
}

// ============================================================
// TEMPLATE POSISI
// data = objek payload tombol Simpan (buildPositionPayload), bukan FormState.
// ============================================================

type PositionTemplateMeta = {
  id: string;
  name: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

type PositionTemplateDetail = PositionTemplateMeta & { data: Record<string, unknown> };

export function PositionFormPage({
  editing,
  onSaved,
  onCancel,
}: {
  editing: Position | null;
  /** @deprecated diabaikan — halaman ini kini hanya konten. */
  mode?: "posisi" | "formulir";
  /** @deprecated diabaikan — statistik pipeline kini di halaman setelannya sendiri. */
  statsRow?: PositionStatsRow | null;
  onSaved: (updated: Position) => void;
  onCancel: () => void;
}) {
  const { reportError } = useAdminSession();
  const [form, setForm] = useState<FormState>(() =>
    editing ? buildFormState(editing) : EMPTY_FORM
  );
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [aiCoverLoading, setAiCoverLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Draf autosave (hanya mode Tambah Posisi; tidak jalan di mode edit) ----
  const draftEnabled = editing === null;
  const [draftOffer, setDraftOffer] = useState<DraftEnvelope | null>(() =>
    draftEnabled ? readDraftStorage() : null
  );

  // ---- Template posisi ----
  const [templates, setTemplates] = useState<PositionTemplateMeta[] | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplNote, setTplNote] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);

  // Dokumen wajib tambahan — editornya kini ada di halaman setelan Penerimaan;
  // nilainya tetap diinisialisasi dari posisi & dikirim utuh di payload.
  const [customDocs, setCustomDocs] = useState<string[]>(() =>
    editing ? [...editing.customDocs] : []
  );

  // Autosave draf: tulis ke localStorage 1500ms setelah perubahan form terakhir.
  // Tidak menulis bila form masih kosong agar draf lama tidak tertimpa isian kosong.
  useEffect(() => {
    if (!draftEnabled) return;
    if (JSON.stringify(form) === JSON.stringify(EMPTY_FORM)) return;
    const timer = setTimeout(() => writeDraftToStorage(form), 1500);
    return () => clearTimeout(timer);
  }, [form, draftEnabled]);

  // Kartu draf hanya tampil saat form masih kosong (belum ada isian baru).
  const formDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(EMPTY_FORM),
    [form]
  );
  const draftFilledCount = useMemo(
    () => (draftOffer ? countFilledFields(draftOffer.form) : 0),
    [draftOffer]
  );
  const showDraftCard =
    draftEnabled && draftOffer !== null && !formDirty && draftFilledCount > 3;

  function handleRestoreDraft() {
    if (!draftOffer) return;
    setForm(draftOffer.form);
    setDraftOffer(null);
    toast.success("Draf dipulihkan — periksa isian sebelum menyimpan.");
  }

  function handleDiscardDraft() {
    removeDraftStorage();
    setDraftOffer(null);
    toast.info("Draf dibuang.");
  }

  // ---- Template posisi ----

  // Muat daftar template saat dropdown "Isi dari Template" pertama kali dibuka.
  function handleTemplatesOpenChange(open: boolean) {
    if (!open || templates !== null || templatesLoading) return;
    setTemplatesLoading(true);
    apiGet<PositionTemplateMeta[]>("/api/admin/position-templates")
      .then((rows) => setTemplates(Array.isArray(rows) ? rows : []))
      .catch((err) => {
        reportError(err);
        setTemplates([]);
      })
      .finally(() => setTemplatesLoading(false));
  }

  async function handleApplyTemplate(id: string) {
    if (applyingTemplate) return;
    setApplyingTemplate(true);
    try {
      const res = await apiGet<{ template: PositionTemplateDetail }>(
        `/api/admin/position-templates/${id}`
      );
      const parsed = formDataFromUnknown(res.template.data);
      if (!parsed) {
        toast.error("Data template tidak valid.");
        return;
      }
      setForm(parsed.form);
      setCustomDocs(parsed.customDocs);
      toast.success("Template diterapkan");
    } catch (err) {
      reportError(err);
    } finally {
      setApplyingTemplate(false);
    }
  }

  function handleSaveTemplate() {
    if (savingTemplate) return;
    const name = tplName.trim();
    if (name.length < 1 || name.length > 60) {
      toast.error("Nama template wajib diisi (maksimal 60 karakter).");
      return;
    }
    setSavingTemplate(true);
    const payload = buildPositionPayload();
    apiPost<{ template: PositionTemplateMeta }>("/api/admin/position-templates", {
      name,
      note: tplNote.trim() || null,
      data: payload,
    })
      .then(() => {
        toast.success("Template posisi disimpan");
        setTemplateDialogOpen(false);
        setTplName("");
        setTplNote("");
        setTemplates(null); // paksa muat ulang daftar saat dropdown dibuka lagi
      })
      .catch((err) => reportError(err))
      .finally(() => setSavingTemplate(false));
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const cleanedStages = useMemo(
    () => form.stages.map((s) => s.trim()).filter(Boolean),
    [form.stages]
  );

  // Cek error validasi per section — dipakai prop hasError FormSection agar
  // kartu yang berisi isian bermasalah membuka otomatis saat gagal simpan.
  const sectionError = (...keywords: string[]) =>
    validationErrors.some((e) =>
      keywords.some((k) => e.toLowerCase().includes(k))
    );

  function validate(): string[] {
    const errors: string[] = [];
    if (form.title.trim().length < 3)
      errors.push("Judul posisi minimal 3 karakter.");
    if (!form.department.trim()) errors.push("Departemen wajib diisi.");
    if (form.description.trim().length < 10)
      errors.push("Deskripsi minimal 10 karakter.");
    if (form.salaryText.trim().length > 80)
      errors.push("Teks gaji maksimal 80 karakter.");
    if (
      form.examples.some(
        (url) => url.trim().length > 0 && !/^https?:\/\//i.test(url.trim())
      )
    )
      errors.push("Contoh karya harus diawali http:// atau https://.");
    if (
      form.assignmentUrl.trim().length > 0 &&
      !/^https?:\/\//i.test(form.assignmentUrl.trim())
    )
      errors.push("URL tes/assignment harus diawali http:// atau https://.");
    if (form.screeningQuestions.some((q) => q.label.trim().length < 3))
      errors.push("Label pertanyaan screening minimal 3 karakter.");
    if (cleanedStages.length > 12)
      errors.push("Pipeline tahap maksimal 12 tahap.");
    if (form.maxApplicants.trim() !== "") {
      if (!isInt(form.maxApplicants) || Number(form.maxApplicants) < 1 || Number(form.maxApplicants) > 10000)
        errors.push("Kuota pelamar harus angka bulat 1-10000, atau dikosongkan.");
    }
    if (form.autoShortlistScore.trim() !== "") {
      if (!isInt(form.autoShortlistScore) || Number(form.autoShortlistScore) < 0 || Number(form.autoShortlistScore) > 100)
        errors.push("Skor auto-shortlist harus angka bulat 0-100, atau dikosongkan.");
    }
    if (form.order.trim() !== "" && !isInt(form.order))
      errors.push("Urutan harus berupa bilangan bulat.");
    if (form.interviewDuration.trim() !== "") {
      if (
        !isInt(form.interviewDuration) ||
        Number(form.interviewDuration) < 10 ||
        Number(form.interviewDuration) > 480
      )
        errors.push("Durasi wawancara harus angka bulat 10-480 menit.");
    }
    if (form.probationMonths.trim() !== "") {
      if (
        !isInt(form.probationMonths) ||
        Number(form.probationMonths) < 0 ||
        Number(form.probationMonths) > 12
      )
        errors.push("Masa percobaan harus angka bulat 0-12 bulan.");
    }
    if (form.reapplyCooldownDays.trim() !== "") {
      if (
        !isInt(form.reapplyCooldownDays) ||
        Number(form.reapplyCooldownDays) < 0 ||
        Number(form.reapplyCooldownDays) > 365
      )
        errors.push("Jeda lamar ulang harus angka bulat 0-365 hari.");
    }
    return errors;
  }

  // Builder payload tombol Simpan — dipakai ulang oleh "Simpan sebagai Template"
  // agar data template identik dengan data yang dikirim saat menyimpan posisi.
  function buildPositionPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      department: form.department.trim(),
      type: form.type,
      location: form.location.trim() || "Remote",
      description: form.description.trim(),
      requirements: form.requirements.map((r) => r.trim()).filter(Boolean),
      // Konten dua bahasa — kosong berarti fallback ke versi Indonesia (null).
      titleEn: form.titleEn.trim() || null,
      descriptionEn: form.descriptionEn.trim() || null,
      requirementsEn: form.requirementsEn.map((r) => r.trim()).filter(Boolean),
      isActive: form.isActive,
      publishAt: localInputToIso(form.publishAtLocal),
      closesAt: localInputToIso(form.closesAtLocal),
      coverFileId: form.coverFileId,
      salaryText: form.salaryText.trim() || null,
      // Rentang gaji wajar — kosong berarti tanpa batasan (null)
      salaryMin: form.salaryMin.trim() === "" ? null : Number(form.salaryMin),
      salaryMax: form.salaryMax.trim() === "" ? null : Number(form.salaryMax),
      salaryVisible: form.salaryVisible,
      benefits: form.benefits.map((b) => b.trim()).filter(Boolean),
      examples: form.examples.map((e) => e.trim()).filter(Boolean),
      urgent: form.urgent,
      featured: form.featured,
      requireCv: form.requireCv,
      requireIntro: form.requireIntro,
      requirePortfolio: form.requirePortfolio,
      maxApplicants:
        form.maxApplicants.trim() === "" ? null : Number(form.maxApplicants),
      applyOpen: form.applyOpen,
      screeningQuestions: form.screeningQuestions.map((q) => ({
        id: q.id,
        label: q.label.trim(),
        required: q.required,
      })),
      // Dokumen wajib tambahan (diedit di halaman Formulir Lamaran)
      customDocs: customDocs.map((d) => d.trim()).filter(Boolean),
      stages: cleanedStages,
      stageCategories: form.stageCategories,
      aiCriteria: form.aiCriteria.trim() || null,
      autoShortlistScore:
        form.autoShortlistScore.trim() === ""
          ? null
          : Number(form.autoShortlistScore),
      autoShortlistStage:
        cleanedStages.length === 0 ? null : form.autoShortlistStage || null,
      applyTemplate: form.applyTemplate.trim() || null,
      acceptTemplate: form.acceptTemplate.trim() || null,
      rejectTemplate: form.rejectTemplate.trim() || null,
      assignmentTitle: form.assignmentTitle.trim() || null,
      assignmentUrl: form.assignmentUrl.trim() || null,
      assignmentNote: form.assignmentNote.trim() || null,
      rubricCriteria: form.rubricCriteria.map((r) => r.trim()).filter(Boolean),
      checklistTemplate: form.checklistTemplate.map((c) => c.trim()).filter(Boolean),
      noteTemplates: form.noteTemplates.map((n) => n.trim()).filter(Boolean),
      // Wawancara
      interviewMode: form.interviewMode,
      interviewPlatform: form.interviewPlatform,
      interviewDuration:
        form.interviewDuration.trim() === "" ? null : Number(form.interviewDuration),
      interviewCriteria: form.interviewCriteria.map((c) => c.trim()).filter(Boolean),
      // Rencana ronde wawancara — hanya baris bernama yang disimpan
      roundPlan: form.roundPlan
        .filter((r) => r.name.trim())
        .map((r, index) => ({
          round: index + 1,
          name: r.name.trim(),
          durationMin:
            r.durationMin.trim() !== "" && isInt(r.durationMin) ? Number(r.durationMin) : undefined,
          interviewers: r.interviewers.split(",").map((n) => n.trim()).filter(Boolean),
        })),
      interviewInviteTemplate: form.interviewInviteTemplate.trim() || null,
      // Penawaran & onboarding
      offerTemplate: form.offerTemplate.trim() || null,
      welcomeTemplate: form.welcomeTemplate.trim() || null,
      probationMonths:
        form.probationMonths.trim() === "" ? 0 : Number(form.probationMonths),
      onboardingDocs: form.onboardingDocs.map((d) => d.trim()).filter(Boolean),
      reapplyCooldownDays:
        form.reapplyCooldownDays.trim() === "" ? 0 : Number(form.reapplyCooldownDays),
      autoCloseOnHired: form.autoCloseOnHired,
    };
    if (form.order.trim() !== "") payload.order = Number(form.order);
    return payload;
  }

  async function handleSave() {
    if (saving) return;
    const errors = validate();
    setValidationErrors(errors);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    setSaving(true);
    const payload = buildPositionPayload();

    try {
      let updated: Position;
      if (editing) {
        updated = await apiPatch<Position>(`/api/admin/positions/${editing.id}`, payload);
        toast.success("Posisi diperbarui");
      } else {
        updated = await apiPost<Position>("/api/admin/positions", payload);
        toast.success("Posisi ditambahkan");
        // Draf mode Tambah selesai — hapus agar tidak muncul lagi nanti.
        removeDraftStorage();
        setDraftOffer(null);
      }
      onSaved(updated);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  function handleUploadCover(file: File) {
    if (!COVER_MIME.includes(file.type)) {
      toast.error("Format gambar harus PNG, JPEG, atau WebP.");
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      toast.error("Ukuran gambar maksimal 3 MB.");
      return;
    }
    setUploadingCover(true);
    const fd = new FormData();
    fd.append("file", file);
    apiFetch<AdminUploadResponse>("/api/admin/upload", {
      method: "POST",
      body: fd,
    })
      .then((res) => {
        set("coverFileId", res.fileId);
        toast.success("Cover berhasil diunggah");
      })
      .catch((err) => reportError(err))
      .finally(() => {
        setUploadingCover(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
  }

  function handleAiCover() {
    if (!editing || aiCoverLoading) return;
    setAiCoverLoading(true);
    const tid = toast.loading(
      "Membuat cover dengan AI... proses bisa memakan waktu hingga 1 menit."
    );
    apiPost<AiCoverResponse>("/api/admin/ai/cover", { positionId: editing.id })
      .then((res) => {
        if (res.ok) {
          set("coverFileId", res.fileId);
          toast.success("Cover AI berhasil dibuat", { id: tid });
          // Daftar posisi di latar sudah diperbarui otomatis lewat realtime
          // (route AI memancarkan positions:changed).
        } else {
          toast.error(res.error, { id: tid });
        }
      })
      .catch((err) => {
        reportError(err);
        toast.dismiss(tid);
      })
      .finally(() => setAiCoverLoading(false));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Kepala halaman: tombol kembali + judul */}
      <div className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-11 gap-2 sm:h-9"
            onClick={onCancel}
            aria-label="Kembali tanpa menyimpan"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            {editing ? "Kelola Posisi" : "Daftar Posisi"}
          </Button>
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold leading-tight">
            {editing ? `Edit Posisi: ${editing.title}` : "Tambah Posisi"}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {editing
              ? "Perbarui konten lowongan, lalu klik Simpan."
              : "Lengkapi detail posisi lowongan baru untuk halaman publik."}
          </p>
        </div>

        {/* Baris aksi template: isi dari template (create) + simpan sebagai template */}
        <div className="flex flex-wrap items-center gap-2">
          {!editing ? (
            <DropdownMenu onOpenChange={handleTemplatesOpenChange}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9">
                  {applyingTemplate ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LayoutTemplate className="size-4" aria-hidden="true" />
                  )}
                  Isi dari Template
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                {templatesLoading ? (
                  <DropdownMenuItem disabled className="gap-2 text-xs">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Memuat template...
                  </DropdownMenuItem>
                ) : templates !== null && templates.length > 0 ? (
                  templates.map((tpl) => (
                    <DropdownMenuItem
                      key={tpl.id}
                      className="flex-col items-start gap-0.5 py-2.5"
                      onClick={() => void handleApplyTemplate(tpl.id)}
                    >
                      <span className="w-full truncate text-sm font-medium">{tpl.name}</span>
                      {tpl.note ? (
                        <span className="w-full truncate text-xs text-muted-foreground">
                          {tpl.note}
                        </span>
                      ) : null}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <DropdownMenuItem disabled>Belum ada template</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              setTplName("");
              setTplNote("");
              setTemplateDialogOpen(true);
            }}
          >
            <BookmarkPlus className="size-4" aria-hidden="true" />
            Simpan sebagai Template
          </Button>
        </div>
      </div>

      {/* Kartu draf belum tersimpan — hanya mode Tambah Posisi dengan draf layak */}
      {showDraftCard && draftOffer ? (
        <Card className="flex flex-col gap-3 rounded-2xl border-amber-200 bg-amber-50/70 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400">
              <History className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Draf belum tersimpan dari {formatDateTime(draftOffer.updatedAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                {draftFilledCount} isian tersimpan di perangkat ini. Lanjutkan pengisian,
                atau buang draf untuk memulai dari awal.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              onClick={handleDiscardDraft}
            >
              Buang Draf
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-9 active:scale-[0.99]"
              onClick={handleRestoreDraft}
            >
              Lanjutkan Draf
            </Button>
          </div>
        </Card>
      ) : null}

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
            {validationErrors.length > 0 ? (
              <div
                className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
                role="alert"
              >
                <p className="font-semibold">Periksa kembali formulir:</p>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {validationErrors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : null}

              {/* a. Dasar */}
              <FormSection
                id="dasar"
                icon={Briefcase}
                title="Dasar"
                hint="Informasi inti lowongan yang tampil di halaman publik."
                hasError={sectionError("judul posisi", "departemen", "deskripsi")}
              >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-title">Nama Posisi *</Label>
                    <Input
                      id="pos-title"
                      value={form.title}
                      onChange={(e) => set("title", e.target.value)}
                      placeholder="mis. Content Video Creator"
                      className="h-10"
                      maxLength={120}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-department">Departemen *</Label>
                      <Input
                        id="pos-department"
                        value={form.department}
                        onChange={(e) => set("department", e.target.value)}
                        placeholder="mis. Produksi"
                        className="h-10"
                        maxLength={80}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Jenis</Label>
                      <Select
                        value={form.type}
                        onValueChange={(v) => set("type", v)}
                      >
                        <SelectTrigger
                          className="h-10 w-full"
                          aria-label="Jenis pekerjaan"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {POSITION_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-location">Lokasi</Label>
                    <Input
                      id="pos-location"
                      value={form.location}
                      onChange={(e) => set("location", e.target.value)}
                      placeholder="Remote"
                      className="h-10"
                      maxLength={120}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-description">Deskripsi *</Label>
                    <Textarea
                      id="pos-description"
                      value={form.description}
                      onChange={(e) => set("description", e.target.value)}
                      placeholder="Jelaskan tanggung jawab dan gambaran umum posisi..."
                      rows={4}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Persyaratan</Label>
                    <StringListEditor
                      name="Persyaratan"
                      items={form.requirements}
                      onChange={(items) => set("requirements", items)}
                      maxItems={20}
                      maxLength={200}
                      addLabel="Tambah persyaratan"
                      placeholder="mis. Menguasai editing video"
                    />
                  </div>
                </FormSection>

              {/* a2. Konten Bahasa Inggris (opsional) — dipakai publik saat lang "en" */}
              <FormSection
                id="bahasa-inggris"
                icon={Languages}
                title="Konten Bahasa Inggris (opsional)"
                hint="Dipakai saat pengunjung memilih Bahasa Inggris; bila kosong otomatis memakai versi Indonesia."
              >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-titleEn">Nama Posisi (EN)</Label>
                    <Input
                      id="pos-titleEn"
                      value={form.titleEn}
                      onChange={(e) => set("titleEn", e.target.value)}
                      placeholder="mis. Video Editor"
                      className="h-10"
                      maxLength={120}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-descriptionEn">Deskripsi (EN)</Label>
                    <Textarea
                      id="pos-descriptionEn"
                      value={form.descriptionEn}
                      onChange={(e) => set("descriptionEn", e.target.value)}
                      placeholder="Describe the role, responsibilities, and overall picture..."
                      rows={4}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Persyaratan (EN)</Label>
                    <StringListEditor
                      name="Persyaratan (EN)"
                      items={form.requirementsEn}
                      onChange={(items) => set("requirementsEn", items)}
                      maxItems={20}
                      maxLength={200}
                      addLabel="Tambah persyaratan (EN)"
                      placeholder="e.g. Proficient in video editing"
                    />
                  </div>
                </FormSection>

              {/* c1. Cover — kartu section terpisah */}
              <FormSection
                id="cover"
                icon={ImageIcon}
                title="Cover"
                hint="Gambar sampul posisi di kartu lowongan & pratinjau berbagi tautan."
              >
                  <div className="flex flex-col gap-2">
                    <Label>Cover Posisi</Label>
                    {form.coverFileId ? (
                      <img
                        src={`/api/files/${form.coverFileId}`}
                        alt={`Cover posisi ${form.title || "baru"}`}
                        className="h-40 w-full rounded-lg border object-cover"
                      />
                    ) : (
                      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed bg-zinc-50/60 text-xs text-muted-foreground dark:bg-zinc-900/40">
                        Belum ada cover
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-11 active:scale-[0.99] sm:h-9"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingCover}
                      >
                        {uploadingCover ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Upload className="size-4" aria-hidden="true" />
                        )}
                        Unggah Gambar
                      </Button>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={COVER_MIME.join(",")}
                        className="hidden"
                        aria-hidden="true"
                        tabIndex={-1}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadCover(file);
                        }}
                      />
                      {editing ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 active:scale-[0.99] sm:h-9"
                          onClick={handleAiCover}
                          disabled={aiCoverLoading || uploadingCover}
                        >
                          {aiCoverLoading ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Wand2 className="size-4" aria-hidden="true" />
                          )}
                          Buat dengan AI
                        </Button>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-block">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-11 sm:h-9"
                                disabled
                              >
                                <Wand2 className="size-4" aria-hidden="true" />
                                Buat dengan AI
                              </Button>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>Simpan posisi dulu</TooltipContent>
                        </Tooltip>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-9 dark:hover:bg-rose-950"
                        onClick={() => {
                          set("coverFileId", null);
                          toast.success("Cover dihapus dari formulir");
                        }}
                        disabled={!form.coverFileId || uploadingCover}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        Hapus Cover
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      PNG/JPEG/WebP maksimal 3 MB. Cover tampil di kartu posisi &amp; pratinjau berbagi tautan.
                    </p>
                  </div>
                </FormSection>

              {/* c2. Gaji — kartu section terpisah */}
              <FormSection
                id="gaji"
                icon={Wallet}
                title="Gaji"
                hint="Teks gaji, tampilan gaji, dan rentang gaji wajar untuk peringatan offer."
                hasError={sectionError("teks gaji")}
              >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-salaryText">Teks Gaji (opsional)</Label>
                      <Input
                        id="pos-salaryText"
                        value={form.salaryText}
                        onChange={(e) => set("salaryText", e.target.value)}
                        placeholder="mis. Rp 4-6 juta/bulan"
                        className="h-10"
                        maxLength={80}
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="flex w-full items-center justify-between gap-3 rounded-lg border p-3">
                        <div>
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            <Wallet className="size-3.5" aria-hidden="true" />
                            Tampilkan gaji
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Teks gaji tampil di halaman publik
                          </p>
                        </div>
                        <Switch
                          checked={form.salaryVisible}
                          onCheckedChange={(checked) => set("salaryVisible", checked)}
                          aria-label="Tampilkan teks gaji di halaman publik"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-salaryMin">Gaji wajar minimum (Rp/bulan)</Label>
                      <Input
                        id="pos-salaryMin"
                        type="number"
                        min={0}
                        value={form.salaryMin}
                        onChange={(e) => set("salaryMin", e.target.value)}
                        placeholder="mis. 3500000 — kosongkan bila tanpa batas"
                        className="h-10"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-salaryMax">Gaji wajar maksimum (Rp/bulan)</Label>
                      <Input
                        id="pos-salaryMax"
                        type="number"
                        min={0}
                        value={form.salaryMax}
                        onChange={(e) => set("salaryMax", e.target.value)}
                        placeholder="mis. 6000000 — dipakai peringatan offer"
                        className="h-10"
                      />
                    </div>
                  </div>
                </FormSection>

              {/* c3. Badge Posisi — kartu section terpisah */}
              <FormSection
                id="badge"
                icon={Flame}
                title="Badge Posisi"
                hint="Tanda urgent & unggulan pada kartu posisi."
              >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <Flame className="size-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                          Tandai urgent
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Badge &quot;Urgent&quot; di kartu posisi
                        </p>
                      </div>
                      <Switch
                        checked={form.urgent}
                        onCheckedChange={(checked) => set("urgent", checked)}
                        aria-label="Tandai posisi sebagai urgent"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <Pin className="size-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                          Tandai unggulan
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Posisi tampil paling depan
                        </p>
                      </div>
                      <Switch
                        checked={form.featured}
                        onCheckedChange={(checked) => set("featured", checked)}
                        aria-label="Tandai posisi sebagai unggulan"
                      />
                    </div>
                  </div>
                </FormSection>

              {/* d1. Benefit — kartu section terpisah */}
              <FormSection
                id="benefit"
                icon={Gift}
                title="Benefit"
                hint="Benefit yang dipajang di detail lowongan."
              >
                  <div className="flex flex-col gap-1.5">
                    <Label>Benefit</Label>
                    <StringListEditor
                      name="Benefit"
                      items={form.benefits}
                      onChange={(items) => set("benefits", items)}
                      maxItems={10}
                      maxLength={120}
                      addLabel="Tambah benefit"
                      placeholder="mis. Fasilitas peralatan lengkap"
                    />
                  </div>
                </FormSection>

              {/* d2. Contoh Karya — kartu section terpisah */}
              <FormSection
                id="karya"
                icon={Clapperboard}
                title="Contoh Karya"
                hint="Tautan contoh karya yang dipajang di detail lowongan."
                hasError={sectionError("contoh karya")}
              >
                  <div className="flex flex-col gap-1.5">
                    <Label>Contoh Karya</Label>
                    <StringListEditor
                      name="Contoh karya"
                      items={form.examples}
                      onChange={(items) => set("examples", items)}
                      maxItems={6}
                      maxLength={300}
                      addLabel="Tambah contoh karya"
                      placeholder="https://youtube.com/..."
                      urlOnly
                    />
                  </div>
                </FormSection>

              {editing === null ? (
                <FormSection
                  id="publikasi-create"
                  icon={Send}
                  title="Publikasi"
                  hint="Tentukan apakah posisi langsung tayang setelah disimpan."
                >
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Aktifkan posisi</p>
                      <p className="text-xs text-muted-foreground">
                        Dasar tampil di halaman publik
                      </p>
                    </div>
                    <Switch
                      checked={form.isActive}
                      onCheckedChange={(checked) => set("isActive", checked)}
                      aria-label="Aktifkan posisi (tampil di halaman publik)"
                    />
                  </div>
                </FormSection>
              ) : (
                <p className="rounded-2xl border bg-card p-5 text-xs text-muted-foreground md:p-6">
                  Status tayang, jadwal, kuota, dan penerimaan kini dikelola di
                  tab Penerimaan halaman Kelola.
                </p>
              )}

            {/* Tombol submit tersembunyi agar Enter mensubmit form */}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>

      {/* Bilah aksi menempel di bawah layar — tetap terlihat di formulir panjang */}
      <div className="sticky bottom-4 z-20">
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur">
          <p className="hidden text-xs text-muted-foreground sm:block">
            {editing
              ? "Perubahan berlaku setelah tombol Simpan diklik."
              : "Posisi tampil di halaman publik setelah disimpan."}
          </p>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={saving}
              className="h-11 sm:h-10"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="h-11 min-w-36 active:scale-[0.99] sm:h-10"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : editing ? (
                "Simpan Perubahan"
              ) : (
                "Tambah Posisi"
              )}
            </Button>
          </div>
        </div>
      </div>
      {/* Dialog simpan posisi saat ini sebagai template */}
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Simpan sebagai Template</DialogTitle>
            <DialogDescription>
              Simpan isi formulir posisi saat ini sebagai template agar bisa dipakai
              ulang lewat "Isi dari Template".
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-name">Nama Template *</Label>
              <Input
                id="tpl-name"
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                placeholder="mis. Video Editor Standar"
                maxLength={60}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-note">Catatan (opsional)</Label>
              <Input
                id="tpl-note"
                value={tplNote}
                onChange={(e) => setTplNote(e.target.value)}
                placeholder="mis. Konfigurasi dasar posisi produksi video"
                maxLength={300}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setTemplateDialogOpen(false)}
              disabled={savingTemplate}
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void handleSaveTemplate()}
              disabled={savingTemplate || tplName.trim().length === 0}
            >
              {savingTemplate ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <BookmarkPlus className="size-4" aria-hidden="true" />
              )}
              Simpan Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
