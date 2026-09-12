"use client";

// Dialog form posisi v3 — pusat kendali semua field per lowongan.
// Layout: section fitur FLAT selebar layar (tanpa accordion), dipisah garis
// panjang (hairline) sebagai pembatas antar fitur agar mudah dipindai.
// Batas karakter/item dikunci via maxLength & maxItems editor (selaras server).

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Briefcase,
  ClipboardCheck,
  Gift,
  Handshake,
  Image as ImageIcon,
  Languages,
  ListChecks,
  Loader2,
  MessagesSquare,
  Pin,
  Flame,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  Video,
  Wallet,
  Wand2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  INTERVIEW_PLATFORM_LABELS,
  INTERVIEW_PLATFORMS,
  POSITION_TYPES,
  STAGE_CATEGORIES,
  STAGE_CATEGORY_LABELS,
  type AiCoverResponse,
  type AdminUploadResponse,
  type InterviewMode,
  type InterviewPlatform,
  type Position,
  type PositionStatsRow,
  type ScreeningQuestion,
  type StageCategory,
} from "@/lib/types";
import {
  defaultCategoryForCustomStage,
  isBuiltInStage,
  stagesForPosition,
  stageLabel,
} from "@/lib/stages";
import { apiFetch, apiPatch, apiPost } from "./api";
import { isoToLocalInput, localInputToIso } from "./format";
import { useAdminSession } from "./admin-context";
import { ScreeningQuestionsEditor, StringListEditor } from "./position-list-editors";

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

const PUB_MODE = {
  tayang: {
    label: "Tayang",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  },
  terjadwal: {
    label: "Terjadwal",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
  draft: {
    label: "Draft",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  tutup: {
    label: "Tutup",
    className:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  },
} as const;

function formPublicationMode(form: FormState): {
  key: keyof typeof PUB_MODE;
  hint: string;
} {
  if (!form.isActive) {
    return { key: "draft", hint: "Posisi tidak tampil di halaman publik." };
  }
  if (form.publishAtLocal) {
    const t = new Date(form.publishAtLocal).getTime();
    if (!Number.isNaN(t) && t > Date.now()) {
      return {
        key: "terjadwal",
        hint: "Posisi otomatis tayang tepat pada jadwal publikasi di atas.",
      };
    }
  }
  if (form.closesAtLocal) {
    const t = new Date(form.closesAtLocal).getTime();
    if (!Number.isNaN(t) && t <= Date.now()) {
      return {
        key: "tutup",
        hint: "Posisi sudah melewati tanggal penutupan dan tidak menerima lamaran baru.",
      };
    }
  }
  return { key: "tayang", hint: "Posisi tampil di halaman publik sekarang." };
}

const DEMO_TEMPLATES = {
  apply:
    "Terima kasih {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Pantau statusnya kapan saja dengan kode {kode}.",
  accept:
    "Selamat {nama}, kamu diterima untuk posisi {posisi}! Tim kami akan menghubungimu untuk langkah selanjutnya.",
  reject:
    "Terima kasih {nama}, setelah meninjau lamaranmu untuk posisi {posisi}, kami memutuskan untuk tidak melanjutkan proses. Semoga sukses di kesempatan berikutnya!",
};

const COVER_MAX_BYTES = 3 * 1024 * 1024;
const COVER_MIME = ["image/png", "image/jpeg", "image/webp"];

// Sentinel opsi "(nonaktif)" — Radix Select melarang SelectItem dengan value "".
const SHORTLIST_NONE = "__nonaktif__";

// Garis panjang pembatas antar section fitur — selebar area formulir.
function FormDivider() {
  return (
    <hr
      aria-hidden="true"
      className="h-px w-full border-0 bg-zinc-200 dark:bg-zinc-800"
    />
  );
}

// Header section fitur flat: ikon dalam kotak rose + judul + petunjuk singkat.
function FormSection({
  id,
  icon: Icon,
  title,
  hint,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`formsec-${id}`} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3
            id={`formsec-${id}`}
            className="text-sm font-semibold leading-tight"
          >
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function isInt(value: string): boolean {
  return /^-?\d+$/.test(value.trim());
}

export function PositionFormDialog({
  open,
  onOpenChange,
  editing,
  statsRow,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Position | null;
  statsRow: PositionStatsRow | null;
  onSaved: () => void;
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

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const cleanedStages = useMemo(
    () => form.stages.map((s) => s.trim()).filter(Boolean),
    [form.stages]
  );

  // Tahap kustom (di luar 5 bawaan) — untuk editor kategori fitur tab Pipeline.
  const customStages = useMemo(
    () => cleanedStages.filter((s) => !isBuiltInStage(s)),
    [cleanedStages]
  );

  // Lamaran pada tahap di luar daftar pipeline tersimpan (dari stats funnel).
  const outOfStageApps = useMemo(() => {
    if (!editing || !statsRow) return 0;
    const inFunnel = statsRow.funnel.reduce((sum, f) => sum + f.count, 0);
    return Math.max(0, statsRow.applications - inFunnel);
  }, [editing, statsRow]);

  const pubMode = formPublicationMode(form);
  const pub = PUB_MODE[pubMode.key];

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

  async function handleSave() {
    if (saving) return;
    const errors = validate();
    setValidationErrors(errors);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    setSaving(true);
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
      screeningQuestions: form.screeningQuestions.map((q) => ({
        id: q.id,
        label: q.label.trim(),
        required: q.required,
      })),
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

    try {
      if (editing) {
        await apiPatch<Position>(`/api/admin/positions/${editing.id}`, payload);
        toast.success("Posisi diperbarui");
      } else {
        await apiPost<Position>("/api/admin/positions", payload);
        toast.success("Posisi ditambahkan");
      }
      onOpenChange(false);
      onSaved();
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
          onSaved();
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-hidden rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Posisi" : "Tambah Posisi"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Perbarui semua pengaturan posisi lowongan."
              : "Tambahkan posisi lowongan baru untuk halaman publik."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 max-h-[68vh] overflow-y-auto pr-2 nice-scrollbar sm:max-h-[70vh]">
          <form
            className="flex flex-col gap-3"
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

            <div className="flex flex-col gap-5">
              {/* a. Dasar */}
              <FormSection
                id="dasar"
                icon={Briefcase}
                title="Dasar"
                hint="Informasi inti lowongan yang tampil di halaman publik."
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

                <FormDivider />

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

                <FormDivider />

              {/* b. Publikasi & Status */}
              <FormSection
                id="publikasi"
                icon={Send}
                title="Publikasi & Status"
                hint="Status tayang, jadwal publikasi & penutupan, dan urutan tampil."
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

                  <div className="flex items-center gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
                    <Badge className={pub.className} variant="outline">
                      {pub.label}
                    </Badge>
                    <p className="text-xs text-muted-foreground">{pubMode.hint}</p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-publishAt">Jadwal Publikasi (opsional)</Label>
                      <Input
                        id="pos-publishAt"
                        type="datetime-local"
                        value={form.publishAtLocal}
                        onChange={(e) => set("publishAtLocal", e.target.value)}
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Posisi mulai tayang otomatis setelah waktu ini.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-closesAt">Tanggal Penutupan (opsional)</Label>
                      <Input
                        id="pos-closesAt"
                        type="datetime-local"
                        value={form.closesAtLocal}
                        onChange={(e) => set("closesAtLocal", e.target.value)}
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Posisi berhenti tampil setelah waktu ini.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 sm:max-w-56">
                    <Label htmlFor="pos-order">Urutan Tampil</Label>
                    <Input
                      id="pos-order"
                      type="number"
                      step={1}
                      value={form.order}
                      onChange={(e) => set("order", e.target.value)}
                      placeholder="Otomatis"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">
                      Angka kecil tampil lebih dulu. Kosongkan untuk urutan otomatis.
                    </p>
                  </div>
                </FormSection>

                <FormDivider />

              {/* c. Tampilan & Konten */}
              <FormSection
                id="tampilan"
                icon={ImageIcon}
                title="Tampilan & Konten"
                hint="Cover, teks gaji, serta badge urgent & unggulan."
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

                <FormDivider />

              {/* d. Benefit & Karya */}
              <FormSection
                id="benefit"
                icon={Gift}
                title="Benefit & Karya"
                hint="Benefit dan contoh karya yang dipajang di detail lowongan."
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

                <FormDivider />

              {/* e. Formulir & Screening */}
              <FormSection
                id="formulir"
                icon={ListChecks}
                title="Formulir & Screening"
                hint="Berkas wajib, kuota pelamar, dan pertanyaan screening."
              >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(
                      [
                        ["requireCv", "Wajib CV", "Berkas PDF saat melamar"],
                        ["requireIntro", "Wajib Intro Video", "Audio/video perkenalan"],
                        ["requirePortfolio", "Wajib Portofolio", "Tautan portofolio karya"],
                      ] as const
                    ).map(([key, label, hint]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:flex-col sm:items-start sm:justify-between"
                      >
                        <div>
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">{hint}</p>
                        </div>
                        <Switch
                          checked={form[key]}
                          onCheckedChange={(checked) => set(key, checked)}
                          aria-label={label}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col gap-1.5 sm:max-w-56">
                    <Label htmlFor="pos-maxApplicants">Kuota Pelamar (opsional)</Label>
                    <Input
                      id="pos-maxApplicants"
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={form.maxApplicants}
                      onChange={(e) => set("maxApplicants", e.target.value)}
                      placeholder="Tanpa kuota"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">
                      Posisi otomatis berhenti menerima lamaran saat kuota penuh.
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Pertanyaan Screening</Label>
                    <ScreeningQuestionsEditor
                      items={form.screeningQuestions}
                      onChange={(items) => set("screeningQuestions", items)}
                      maxItems={10}
                    />
                  </div>
                </FormSection>

                <FormDivider />

              {/* f. Pipeline & AI */}
              <FormSection
                id="pipeline"
                icon={Workflow}
                title="Pipeline & AI"
                hint="Tahapan seleksi kustom, auto-shortlist, dan kriteria AI."
              >
                  <div className="flex flex-col gap-1.5">
                    <Label>Pipeline Tahap Kustom</Label>
                    {outOfStageApps > 0 ? (
                      <div
                        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                        role="alert"
                      >
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>
                          {outOfStageApps} lamaran posisi ini berada pada tahap yang tidak ada di daftar
                          pipeline tersimpan. Tambahkan kembali tahap tersebut, atau lamaran itu tidak akan
                          tampil di funnel &amp; papan kanban.
                        </span>
                      </div>
                    ) : null}
                    <StringListEditor
                      name="Tahap pipeline"
                      items={form.stages}
                      onChange={(items) => {
                        set("stages", items);
                        // Tahap yang dihapus dari pipeline tidak valid lagi untuk auto-shortlist.
                        setForm((f) =>
                          f.autoShortlistStage &&
                          !items.map((s) => s.trim()).includes(f.autoShortlistStage)
                            ? { ...f, autoShortlistStage: "" }
                            : f
                        );
                      }}
                      maxItems={12}
                      maxLength={40}
                      addLabel="Tambah tahap"
                      placeholder="mis. Tes Menulis"
                      hint="Kosong = pipeline bawaan (Baru/Ditinjau/Wawancara/Diterima/Ditolak)"
                    />
                  </div>

                  {customStages.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <Label>Kategori Fitur Tahap Kustom</Label>
                      <p className="text-xs text-muted-foreground">
                        Tentukan di kategori mana tiap tahap kustom muncul di tab Pipeline:
                        Ditinjau, Wawancara, Diterima, atau Ditolak.
                      </p>
                      <div className="flex flex-col gap-2">
                        {customStages.map((stage) => (
                          <div key={stage} className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate rounded-lg border bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900">
                              {stage}
                            </span>
                            <Select
                              value={
                                form.stageCategories[stage] ??
                                defaultCategoryForCustomStage(stage)
                              }
                              onValueChange={(v) =>
                                setForm((f) => ({
                                  ...f,
                                  stageCategories: {
                                    ...f.stageCategories,
                                    [stage]: v as StageCategory,
                                  },
                                }))
                              }
                            >
                              <SelectTrigger
                                className="h-10 w-40 shrink-0"
                                aria-label={`Kategori fitur untuk tahap ${stage}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STAGE_CATEGORIES.map((c) => (
                                  <SelectItem key={c} value={c}>
                                    {STAGE_CATEGORY_LABELS[c]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-shortlistScore">Ambang Skor Auto-Shortlist (opsional)</Label>
                      <Input
                        id="pos-shortlistScore"
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={form.autoShortlistScore}
                        onChange={(e) => set("autoShortlistScore", e.target.value)}
                        placeholder="mis. 80"
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Lamaran Baru dengan skor AI mencapai angka ini dipindah otomatis.
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Tahap Tujuan Auto-Shortlist</Label>
                      <Select
                        value={form.autoShortlistStage || SHORTLIST_NONE}
                        onValueChange={(v) =>
                          set("autoShortlistStage", v === SHORTLIST_NONE ? "" : v)
                        }
                        disabled={cleanedStages.length === 0}
                      >
                        <SelectTrigger
                          className="h-10 w-full"
                          aria-label="Tahap tujuan auto-shortlist"
                        >
                          <SelectValue placeholder="(nonaktif)" />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Radix melarang SelectItem value="" — pakai sentinel */}
                          <SelectItem value={SHORTLIST_NONE}>(nonaktif)</SelectItem>
                          {stagesForPosition(cleanedStages).map((stage) => (
                            <SelectItem key={stage} value={stage}>
                              {stageLabel(stage)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {cleanedStages.length === 0
                          ? "Isi pipeline tahap kustom di atas untuk mengaktifkan pilihan ini."
                          : "Lamaran dipindah ke tahap ini saat ambang skor tercapai."}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-aiCriteria">Kriteria AI (opsional)</Label>
                    <Textarea
                      id="pos-aiCriteria"
                      value={form.aiCriteria}
                      onChange={(e) => set("aiCriteria", e.target.value)}
                      placeholder="mis. Utamakan kandidat dengan pengalaman editing YouTube dan pemahaman tren konten pendek."
                      rows={3}
                      maxLength={600}
                    />
                    <p className="text-xs text-muted-foreground">
                      Mempengaruhi prompt screening AI khusus posisi ini. Maksimal 600 karakter.
                    </p>
                  </div>
                </FormSection>

                <FormDivider />

              {/* g. Otomasi Pesan */}
              <FormSection
                id="otomasi"
                icon={MessagesSquare}
                title="Otomasi Pesan"
                hint="Template pesan otomatis dan info tes untuk pelamar."
              >
                  <p className="text-xs text-muted-foreground">
                    Variabel yang tersedia:{" "}
                    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-800">
                      {"{nama}"}
                    </code>
                    ,{" "}
                    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-800">
                      {"{posisi}"}
                    </code>
                    ,{" "}
                    <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-800">
                      {"{kode}"}
                    </code>{" "}
                    (kode pelacakan; hanya untuk pesan lamaran). Maksimal 500 karakter per template.
                  </p>

                  {(
                    [
                      ["applyTemplate", "Template Konfirmasi Lamaran", DEMO_TEMPLATES.apply, "Dikirim otomatis saat pelamar selesai mendaftar."],
                      ["acceptTemplate", "Template Diterima", DEMO_TEMPLATES.accept, "Dikirim saat lamaran dipindah ke tahap Diterima."],
                      ["rejectTemplate", "Template Ditolak", DEMO_TEMPLATES.reject, "Dikirim saat lamaran dipindah ke tahap Ditolak."],
                    ] as const
                  ).map(([key, label, demo, hint]) => (
                    <div key={key} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`pos-${key}`}>{label}</Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1 px-2 text-xs active:scale-[0.99]"
                          onClick={() => set(key, demo)}
                        >
                          <Sparkles className="size-3.5" aria-hidden="true" />
                          Isi contoh
                        </Button>
                      </div>
                      <Textarea
                        id={`pos-${key}`}
                        value={form[key]}
                        onChange={(e) => set(key, e.target.value)}
                        placeholder="Kosongkan untuk tidak mengirim pesan otomatis."
                        rows={3}
                        maxLength={500}
                      />
                      <p className="text-xs text-muted-foreground">{hint}</p>
                    </div>
                  ))}

                  <div className="rounded-lg border p-3">
                    <p className="text-sm font-medium">Tes untuk Pelamar</p>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Info tes/brief dikirim bersama pesan konfirmasi lamaran. Kosongkan bila tidak ada tes.
                    </p>
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="pos-assignmentTitle">Judul Tes</Label>
                        <Input
                          id="pos-assignmentTitle"
                          value={form.assignmentTitle}
                          onChange={(e) => set("assignmentTitle", e.target.value)}
                          placeholder="mis. Tes Editing 60 Detik"
                          className="h-10"
                          maxLength={120}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="pos-assignmentUrl">URL Tes</Label>
                        <Input
                          id="pos-assignmentUrl"
                          value={form.assignmentUrl}
                          onChange={(e) => set("assignmentUrl", e.target.value)}
                          placeholder="https://drive.google.com/..."
                          className="h-10"
                          maxLength={300}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="pos-assignmentNote">Catatan Tes</Label>
                        <Textarea
                          id="pos-assignmentNote"
                          value={form.assignmentNote}
                          onChange={(e) => set("assignmentNote", e.target.value)}
                          placeholder="Instruksi singkat pengerjaan tes..."
                          rows={2}
                          maxLength={400}
                        />
                      </div>
                    </div>
                  </div>
                </FormSection>

                <FormDivider />

              {/* h. Evaluasi */}
              <FormSection
                id="evaluasi"
                icon={ClipboardCheck}
                title="Evaluasi"
                hint="Rubrik penilaian, checklist, dan catatan cepat tim."
              >
                  <div className="flex flex-col gap-1.5">
                    <Label>Kriteria Rubrik Penilaian</Label>
                    <StringListEditor
                      name="Kriteria rubrik"
                      items={form.rubricCriteria}
                      onChange={(items) => set("rubricCriteria", items)}
                      maxItems={8}
                      maxLength={60}
                      addLabel="Tambah kriteria"
                      placeholder="mis. Kualitas storytelling"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Template Checklist</Label>
                    <StringListEditor
                      name="Item checklist"
                      items={form.checklistTemplate}
                      onChange={(items) => set("checklistTemplate", items)}
                      maxItems={8}
                      maxLength={120}
                      addLabel="Tambah item checklist"
                      placeholder="mis. Cek reel di Instagram kandidat"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Template Catatan Cepat</Label>
                    <StringListEditor
                      name="Template catatan"
                      items={form.noteTemplates}
                      onChange={(items) => set("noteTemplates", items)}
                      maxItems={8}
                      maxLength={200}
                      addLabel="Tambah template catatan"
                      placeholder="mis. Portofolio kuat, cek di wawancara"
                      hint="Klik cepat saat menulis catatan pada lamaran"
                    />
                  </div>
                </FormSection>

                <FormDivider />

              {/* i. Wawancara */}
              <FormSection
                id="wawancara"
                icon={Video}
                title="Wawancara"
                hint="Mode, platform, durasi bawaan, kriteria scorecard, dan template undangan."
              >
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label>Mode Bawaan</Label>
                      <Select
                        value={form.interviewMode}
                        onValueChange={(v) => set("interviewMode", v as InterviewMode)}
                      >
                        <SelectTrigger className="h-10 w-full" aria-label="Mode wawancara bawaan">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVIEW_MODES.map((m) => (
                            <SelectItem key={m} value={m}>
                              {INTERVIEW_MODE_LABELS[m]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>Platform Bawaan</Label>
                      <Select
                        value={form.interviewPlatform}
                        onValueChange={(v) => set("interviewPlatform", v as InterviewPlatform)}
                      >
                        <SelectTrigger className="h-10 w-full" aria-label="Platform wawancara bawaan">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INTERVIEW_PLATFORMS.map((p) => (
                            <SelectItem key={p} value={p}>
                              {INTERVIEW_PLATFORM_LABELS[p]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5 sm:max-w-56">
                    <Label htmlFor="pos-interviewDuration">Durasi Default (menit)</Label>
                    <Input
                      id="pos-interviewDuration"
                      type="number"
                      min={10}
                      max={480}
                      step={5}
                      value={form.interviewDuration}
                      onChange={(e) => set("interviewDuration", e.target.value)}
                      placeholder="45"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">
                      Terisi otomatis saat menjadwalkan wawancara (10-480 menit).
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Kriteria Scorecard</Label>
                    <StringListEditor
                      name="Kriteria scorecard"
                      items={form.interviewCriteria}
                      onChange={(items) => set("interviewCriteria", items)}
                      maxItems={8}
                      maxLength={60}
                      addLabel="Tambah kriteria"
                      placeholder="mis. Komunikasi"
                      hint="Kosongkan untuk memakai kriteria bawaan (Komunikasi, Portofolio, dll.)"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-interviewInviteTemplate">Template Undangan Wawancara</Label>
                    <Textarea
                      id="pos-interviewInviteTemplate"
                      value={form.interviewInviteTemplate}
                      onChange={(e) => set("interviewInviteTemplate", e.target.value)}
                      placeholder="Hai {nama}, kamu diundang wawancara untuk posisi {posisi} pada {tanggal} pukul {jam} via {mode}. Link: {link}"
                      rows={3}
                      maxLength={800}
                    />
                    <p className="text-xs text-muted-foreground">
                      Variabel: {"{nama}"} {"{posisi}"} {"{tanggal}"} {"{jam}"} {"{link}"} {"{mode}"}
                    </p>
                  </div>
                </FormSection>

                <FormDivider />

              {/* j. Penawaran & Onboarding */}
              <FormSection
                id="penawaran"
                icon={Handshake}
                title="Penawaran & Onboarding"
                hint="Template penawaran & sambutan, masa percobaan, dokumen onboarding, dan jeda lamar ulang."
              >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-offerTemplate">Template Pesan Penawaran</Label>
                    <Textarea
                      id="pos-offerTemplate"
                      value={form.offerTemplate}
                      onChange={(e) => set("offerTemplate", e.target.value)}
                      placeholder="Selamat {nama}! Kami menawarkanmu posisi {posisi} dengan gaji {gaji}, mulai {tanggal}. Mohon konfirmasi sebelum {deadline}."
                      rows={3}
                      maxLength={800}
                    />
                    <p className="text-xs text-muted-foreground">
                      Variabel: {"{nama}"} {"{posisi}"} {"{gaji}"} {"{tanggal}"} {"{deadline}"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="pos-welcomeTemplate">Template Pesan Sambutan</Label>
                    <Textarea
                      id="pos-welcomeTemplate"
                      value={form.welcomeTemplate}
                      onChange={(e) => set("welcomeTemplate", e.target.value)}
                      placeholder="Selamat bergabung, {nama}! Hari pertamamu di posisi {posisi} dimulai {tanggal}."
                      rows={3}
                      maxLength={800}
                    />
                    <p className="text-xs text-muted-foreground">
                      Variabel: {"{nama}"} {"{posisi}"} {"{tanggal}"}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-probationMonths">Masa Percobaan (bulan)</Label>
                      <Input
                        id="pos-probationMonths"
                        type="number"
                        min={0}
                        max={12}
                        step={1}
                        value={form.probationMonths}
                        onChange={(e) => set("probationMonths", e.target.value)}
                        placeholder="0"
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Batas akhir masa percobaan dihitung dari tanggal diterima (0-12).
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="pos-reapplyCooldown">Jeda Lamar Ulang (hari)</Label>
                      <Input
                        id="pos-reapplyCooldown"
                        type="number"
                        min={0}
                        max={365}
                        step={1}
                        value={form.reapplyCooldownDays}
                        onChange={(e) => set("reapplyCooldownDays", e.target.value)}
                        placeholder="0"
                        className="h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Pelamar yang ditolak bisa melamar lagi setelah jeda ini. 0 = bebas.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Dokumen Wajib Onboarding</Label>
                    <StringListEditor
                      name="Dokumen onboarding"
                      items={form.onboardingDocs}
                      onChange={(items) => set("onboardingDocs", items)}
                      maxItems={10}
                      maxLength={120}
                      addLabel="Tambah dokumen"
                      placeholder="mis. Kontrak Kerja"
                      hint="Daftar ini otomatis jadi checklist dokumen saat pelamar diterima"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div>
                      <p className="text-sm font-medium">Tutup otomatis saat diterima</p>
                      <p className="text-xs text-muted-foreground">
                        Lowongan berhenti menerima lamaran begitu ada kandidat menerima penawaran
                      </p>
                    </div>
                    <Switch
                      checked={form.autoCloseOnHired}
                      onCheckedChange={(checked) => set("autoCloseOnHired", checked)}
                      aria-label="Tutup lowongan otomatis saat ada kandidat diterima"
                    />
                  </div>
                </FormSection>
            </div>

            {/* Tombol submit tersembunyi agar Enter mensubmit form */}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
        </div>

        <DialogFooter className="gap-2 border-t pt-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-11 sm:h-10"
          >
            Batal
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            className="h-11 active:scale-[0.99] sm:h-10"
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
