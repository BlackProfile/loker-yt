"use client";

// Halaman-halaman setelan per posisi (bukan popup) — dirender inline di dalam
// halaman Kelola. Setiap halaman mengelola SATU kelompok field milik posisi dan
// mengirim PATCH hanya dengan kunci milik halaman itu. Setiap kelompok isi
// dirender sebagai KARTU SECTION TERPISAH (FormSection) yang bisa DICIUTKAN —
// default TERTUTUP; section dengan error validasi membuka otomatis via hasError:
// - PositionIntakePage    -> "Penerimaan" (status, publikasi, kuota, berkas)
// - PositionSelectionPage -> "Seleksi"    (pipeline, auto-shortlist, AI, tes, rubrik)
// - PositionInterviewPage -> "Wawancara"  (bawaan, scorecard, ronde, undangan)
// - PositionMessagesPage  -> "Pesan"      (otomasi status, penawaran, onboarding)
// State lokal diinisialisasi dari prop position via useState initializer;
// parent me-remount via key saat posisi berganti, jadi tidak perlu sinkron.

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
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
import {
  ArrowLeft,
  BadgeCheck,
  CalendarClock,
  Check,
  ClipboardCheck,
  ClipboardList,
  EyeOff,
  FileText,
  Inbox,
  ListChecks,
  ListOrdered,
  Loader2,
  MessagesSquare,
  Plus,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
  TriangleAlert,
  UserCheck,
  Users,
  Video,
  Wallet,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  INTERVIEW_PLATFORM_LABELS,
  INTERVIEW_PLATFORMS,
  ONSITE_DOC_PRESETS,
  STAGE_CATEGORIES,
  STAGE_CATEGORY_LABELS,
  type InterviewMode,
  type InterviewPlatform,
  type Position,
  type PositionStatsRow,
  type StageCategory,
} from "@/lib/types";
import {
  defaultCategoryForCustomStage,
  isBuiltInStage,
  stagesForPosition,
  stageLabel,
} from "@/lib/stages";
import { isFormSchemaActive } from "@/lib/form-schema";
import { HIDDEN_UI_OPTIONS, type HiddenUiKey } from "@/lib/hidden-ui"; // NR-22
import { apiPatch } from "./api";
import { isoToLocalInput, localInputToIso } from "./format";
import { useAdminSession } from "./admin-context";
import { StringListEditor } from "./position-list-editors";
import {
  CUSTOM_DOC_MAX_LEN,
  DEMO_TEMPLATES,
  FormSection,
  MAX_CUSTOM_DOCS,
  PUB_MODE,
  SHORTLIST_NONE,
  formPublicationMode,
  isInt,
} from "./position-form-parts";

/* ========================================================================== */
/* Shell bersama: header, kartu form, validasi, dan bilah aksi menempel.      */
/* ========================================================================== */

function SettingsPageShell({
  position,
  pageTitle,
  description,
  saveLabel,
  successToast,
  validate,
  buildPayload,
  onBack,
  onSaved,
  children,
}: {
  position: Position;
  pageTitle: string;
  description: string;
  saveLabel: string;
  successToast: string;
  validate: () => string[];
  buildPayload: () => Record<string, unknown>;
  onBack: () => void;
  onSaved: (p: Position) => void;
  /** Bisa berupa JSX statis atau fungsi (validationErrors) => JSX untuk hasError per section. */
  children: ReactNode | ((validationErrors: string[]) => ReactNode);
}) {
  const { canMutate, reportError } = useAdminSession();
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (saving) return;
    const errors = validate();
    setValidationErrors(errors);
    if (errors.length > 0) {
      toast.error(errors[0]);
      return;
    }
    setSaving(true);
    try {
      const updated = await apiPatch<Position>(
        `/api/admin/positions/${position.id}`,
        buildPayload()
      );
      toast.success(successToast);
      onSaved(updated);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
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
            onClick={onBack}
            aria-label="Kembali ke Kelola Posisi tanpa menyimpan"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Kelola Posisi
          </Button>
        </div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-bold leading-tight">
            {pageTitle} — {position.title}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
      >
        {validationErrors.length > 0 ? (
          <div
            className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
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

        {typeof children === "function" ? children(validationErrors) : children}

        {/* Tombol submit tersembunyi agar Enter mensubmit form */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>

      {/* Bilah aksi menempel di bawah layar — tetap terlihat di formulir panjang */}
      <div className="sticky bottom-4 z-20">
        <div className="flex items-center justify-between gap-3 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur">
          <p className="hidden text-xs text-muted-foreground sm:block">
            Perubahan berlaku setelah tombol Simpan diklik.
          </p>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              disabled={saving}
              className="h-11 sm:h-10"
            >
              Batal
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !canMutate}
              className="h-11 min-w-36 active:scale-[0.99] sm:h-10"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : (
                saveLabel
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* 1. Penerimaan — status & publikasi, kuota, berkas wajib.                    */
/* ========================================================================== */

type IntakeState = {
  isActive: boolean;
  applyOpen: boolean;
  publishAtLocal: string;
  closesAtLocal: string;
  order: string;
  maxApplicants: string;
  requireCv: boolean;
  requireIntro: boolean;
  requirePortfolio: boolean;
  // NR-22 — slot opsional wizard klasik bisa disembunyikan per posisi
  showCvField: boolean;
  showIntroField: boolean;
  showPortfolioField: boolean;
  showSocialField: boolean;
  // NR-24 — kolom opsional ekspektasi gaji di formulir lamaran
  showExpectedSalary: boolean;
};

function buildIntakeState(p: Position): IntakeState {
  return {
    isActive: p.isActive,
    applyOpen: p.applyOpen !== false,
    publishAtLocal: isoToLocalInput(p.publishAt),
    closesAtLocal: isoToLocalInput(p.closesAt),
    order: String(p.order ?? ""),
    maxApplicants: p.maxApplicants == null ? "" : String(p.maxApplicants),
    requireCv: p.requireCv,
    requireIntro: p.requireIntro,
    requirePortfolio: p.requirePortfolio,
    showCvField: p.showCvField !== false,
    showIntroField: p.showIntroField !== false,
    showPortfolioField: p.showPortfolioField !== false,
    showSocialField: p.showSocialField !== false,
    showExpectedSalary: p.showExpectedSalary !== false, // NR-24 — default true
  };
}

export function PositionIntakePage({
  position,
  onBack,
  onSaved,
}: {
  position: Position;
  onBack: () => void;
  onSaved: (p: Position) => void;
}) {
  const [form, setForm] = useState<IntakeState>(() => buildIntakeState(position));
  const [customDocs, setCustomDocs] = useState<string[]>(() => [...position.customDocs]);
  const [newDoc, setNewDoc] = useState("");

  const set = <K extends keyof IntakeState>(key: K, value: IntakeState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Posisi memakai Form Builder (skema aktif): switch berkas klasik dikelola
  // di tab Formulir — bagian Berkas, jadi tidak dikirim dari halaman ini.
  const schemaActive = useMemo(
    () => isFormSchemaActive({ formSchema: position.formSchema }),
    [position.formSchema]
  );

  const pubMode = formPublicationMode({
    isActive: form.isActive,
    publishAtLocal: form.publishAtLocal,
    closesAtLocal: form.closesAtLocal,
  });
  const pub = PUB_MODE[pubMode.key];

  // Dokumen wajib tambahan — baru tersimpan saat tombol Simpan diklik.
  const addCustomDoc = useCallback(() => {
    const label = newDoc.trim().slice(0, CUSTOM_DOC_MAX_LEN);
    if (label.length < 2) {
      toast.error("Nama dokumen minimal 2 karakter.");
      return;
    }
    if (customDocs.length >= MAX_CUSTOM_DOCS) {
      toast.error(`Maksimal ${MAX_CUSTOM_DOCS} dokumen tambahan.`);
      return;
    }
    if (customDocs.some((d) => d.toLowerCase() === label.toLowerCase())) {
      toast.error("Dokumen dengan nama itu sudah ada.");
      return;
    }
    setCustomDocs((prev) => [...prev, label]);
    setNewDoc("");
  }, [newDoc, customDocs]);

  const removeCustomDoc = useCallback((label: string) => {
    setCustomDocs((prev) => prev.filter((d) => d !== label));
  }, []);

  return (
    <SettingsPageShell
      position={position}
      pageTitle="Penerimaan"
      description="Atur status tayang, jadwal publikasi, kuota, dan berkas wajib posisi ini."
      saveLabel="Simpan Penerimaan"
      successToast="Setelan penerimaan disimpan"
      onBack={onBack}
      onSaved={onSaved}
      validate={() => {
        const errors: string[] = [];
        if (form.order.trim() !== "" && !isInt(form.order))
          errors.push("Urutan harus berupa bilangan bulat.");
        if (form.maxApplicants.trim() !== "") {
          if (
            !isInt(form.maxApplicants) ||
            Number(form.maxApplicants) < 1 ||
            Number(form.maxApplicants) > 10000
          )
            errors.push("Kuota pelamar harus angka bulat 1-10000, atau dikosongkan.");
        }
        return errors;
      }}
      buildPayload={() => {
        const payload: Record<string, unknown> = {
          isActive: form.isActive,
          applyOpen: form.applyOpen,
          publishAt: localInputToIso(form.publishAtLocal),
          closesAt: localInputToIso(form.closesAtLocal),
          maxApplicants:
            form.maxApplicants.trim() === "" ? null : Number(form.maxApplicants),
          customDocs: customDocs.map((d) => d.trim()).filter(Boolean),
        };
        if (form.order.trim() !== "") payload.order = Number(form.order);
        if (!schemaActive) {
          payload.requireCv = form.requireCv;
          payload.requireIntro = form.requireIntro;
          payload.requirePortfolio = form.requirePortfolio;
          payload.showCvField = form.requireCv || form.showCvField;
          payload.showIntroField = form.requireIntro || form.showIntroField;
          payload.showPortfolioField =
            form.requirePortfolio || form.showPortfolioField;
          payload.showSocialField = form.showSocialField;
        }
        // NR-24 — dikirim SELALU di payload penerimaan (berlaku untuk semua
        // mode formulir, klasik maupun skema/Form Builder).
        payload.showExpectedSalary = form.showExpectedSalary;
        return payload;
      }}
    >
      {(errors) => {
        const hasErr = (...keywords: string[]) =>
          errors.some((e) => keywords.some((k) => e.toLowerCase().includes(k)));
        return (
          <>
      <FormSection
        id="status"
        icon={Inbox}
        title="Status Tayang"
        hint="Aktifkan posisi dan buka/tutup formulir lamaran."
      >
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Aktifkan posisi</p>
            <p className="text-xs text-muted-foreground">Dasar tampil di halaman publik</p>
          </div>
          <Switch
            checked={form.isActive}
            onCheckedChange={(checked) => set("isActive", checked)}
            aria-label="Aktifkan posisi (tampil di halaman publik)"
          />
        </div>

        {/* Formulir lamaran per posisi — buka/tutup terpisah dari status tayang */}
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Buka formulir lamaran</p>
            <p className="text-xs text-muted-foreground">
              Saat ditutup, posisi tetap tayang tetapi tidak menerima lamaran baru
            </p>
          </div>
          <Switch
            checked={form.applyOpen}
            onCheckedChange={(checked) => set("applyOpen", checked)}
            aria-label="Buka atau tutup formulir lamaran posisi ini"
          />
        </div>

        {/* Pratinjau status publikasi berdasarkan isian saat ini */}
        <div className="flex items-center gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <Badge className={pub.className} variant="outline">
            {pub.label}
          </Badge>
          <p className="text-xs text-muted-foreground">{pubMode.hint}</p>
        </div>
      </FormSection>

      <FormSection
        id="publikasi"
        icon={CalendarClock}
        title="Publikasi"
        hint="Jadwal tayang, tanggal penutupan, dan urutan tampil."
        hasError={hasErr("urutan")}
      >
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

      <FormSection
        id="kuota"
        icon={Users}
        title="Kuota Pelamar"
        hint="Batas jumlah pelamar yang diterima posisi ini."
        hasError={hasErr("kuota pelamar")}
      >
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
      </FormSection>

      <FormSection
        id="berkas"
        icon={FileText}
        title="Berkas Wajib"
        hint="Berkas yang wajib diunggah pendaftar."
      >
        {schemaActive ? (
          <p className="text-xs text-muted-foreground">
            Pengaturan CV, intro, dan portofolio dikelola di tab Formulir — bagian Berkas.
          </p>
        ) : (
          <>
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

          {/* NR-22 — sembunyikan slot opsional yang tidak relevan (mis. supir
              & pembantu tidak butuh CV/intro/portofolio/sosmed). Slot yang
              diwajibkan selalu tampil — sakelarnya terkunci nyala. */}
          <div className="mt-1 flex flex-col gap-2">
            <p className="text-sm font-medium">Slot Opsional Formulir</p>
            <p className="text-xs text-muted-foreground">
              Matikan bila slot tidak relevan untuk posisi ini — pelamar tidak
              akan melihatnya. Slot yang diwajibkan selalu tampil.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ["showCvField", "Unggah CV", "Tampilkan unggah CV opsional", form.requireCv],
                  ["showIntroField", "Unggah Perkenalan", "Tampilkan audio/video perkenalan opsional", form.requireIntro],
                  ["showPortfolioField", "Link Portofolio", "Tampilkan input tautan portofolio", form.requirePortfolio],
                  ["showSocialField", "Link Sosial Media", "Tampilkan input tautan sosial media", false],
                ] as const
              ).map(([key, label, hint, locked]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-3 sm:flex-col sm:items-start sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted-foreground">{hint}</p>
                  </div>
                  <Switch
                    checked={locked || form[key]}
                    disabled={locked}
                    onCheckedChange={(checked) => set(key, checked)}
                    aria-label={label}
                  />
                </div>
              ))}
            </div>
          </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor="pos-customDocs">Dokumen Wajib Tambahan</Label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Misal: KTP, Ijazah, Sertifikat, Surat Sehat. Pelamar wajib
            mengunggah semuanya (PDF/gambar/Word, maks 5 MB per berkas,
            maksimal {MAX_CUSTOM_DOCS} dokumen).
          </p>
          {customDocs.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {customDocs.map((doc) => (
                <li
                  key={doc}
                  className="flex min-h-10 items-center justify-between gap-2 rounded-lg border bg-zinc-50/60 px-3 py-1.5 dark:bg-zinc-900/40"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText
                      className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400"
                      aria-hidden="true"
                    />
                    <span className="truncate">{doc}</span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground hover:text-rose-600"
                    onClick={() => removeCustomDoc(doc)}
                    aria-label={`Hapus dokumen ${doc}`}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Belum ada dokumen tambahan.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Input
              id="pos-customDocs"
              value={newDoc}
              onChange={(e) => setNewDoc(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomDoc();
                }
              }}
              placeholder="Nama dokumen, mis. KTP"
              className="h-11 sm:flex-1"
              maxLength={CUSTOM_DOC_MAX_LEN}
              disabled={customDocs.length >= MAX_CUSTOM_DOCS}
              aria-label="Nama dokumen baru"
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0 sm:h-10"
              onClick={addCustomDoc}
              disabled={customDocs.length >= MAX_CUSTOM_DOCS}
            >
              <Plus className="size-4" aria-hidden="true" />
              Tambah
            </Button>
          </div>

          {/* Preset cepat dokumen wajib posisi on-site (KTP/SKCK/Surat Sehat) —
              sekali klik menambahkan ke daftar tanpa duplikat. */}
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              Preset cepat untuk posisi on-site
            </p>
            <div className="flex flex-wrap gap-2">
              {ONSITE_DOC_PRESETS.map((preset) => {
                const exists = customDocs.some(
                  (d) => d.toLowerCase() === preset.toLowerCase()
                );
                const full = customDocs.length >= MAX_CUSTOM_DOCS;
                return (
                  <Button
                    key={preset}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-11 active:scale-[0.99] sm:h-9"
                    onClick={() => {
                      if (exists || full) return;
                      setCustomDocs((prev) =>
                        prev.some((d) => d.toLowerCase() === preset.toLowerCase())
                          ? prev
                          : [...prev, preset]
                      );
                    }}
                    disabled={exists || full}
                    aria-label={
                      exists ? `${preset} sudah ada dalam daftar` : `Tambahkan ${preset}`
                    }
                  >
                    {exists ? (
                      <Check className="size-4" aria-hidden="true" />
                    ) : (
                      <Plus className="size-4" aria-hidden="true" />
                    )}
                    {preset}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </FormSection>

      {/* NR-24 — kolom ekspektasi gaji wizard. Section TERPISAH di luar kondisi
          schemaActive agar tampil di SEMUA mode formulir (klasik & skema). */}
      <FormSection
        id="ekspektasi-gaji"
        icon={Wallet}
        title="Kolom Ekspektasi Gaji"
        hint="Kolom opsional ekspektasi gaji bulanan pada formulir lamaran."
      >
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Tampilkan ekspektasi gaji</p>
            <p className="text-xs text-muted-foreground">
              Tampilkan kolom opsional ekspektasi gaji di formulir lamaran.
            </p>
          </div>
          <Switch
            checked={form.showExpectedSalary}
            onCheckedChange={(checked) => set("showExpectedSalary", checked)}
            aria-label="Tampilkan kolom opsional ekspektasi gaji di formulir lamaran"
          />
        </div>
      </FormSection>
          </>
        );
      }}
    </SettingsPageShell>
  );
}

/* ========================================================================== */
/* 2. Seleksi — pipeline & auto-shortlist, kriteria AI, tes, rubrik.           */
/* ========================================================================== */

type SelectionState = {
  stages: string[];
  stageCategories: Record<string, StageCategory>;
  stageNotes: Record<string, string>; // NR-15: penjelasan per tahap untuk halaman status pelamar
  stageWipLimits: Record<string, string>; // NR-19: batas kapasitas per tahap (string dari input angka; "" = tanpa batas)
  hiddenUi: string[]; // NR-22: blok UI yang disembunyikan di dialog detail lamaran
  aiCriteria: string;
  autoShortlistScore: string;
  autoShortlistStage: string; // "" = nonaktif
  assignmentTitle: string;
  assignmentUrl: string;
  assignmentNote: string;
  rubricCriteria: string[];
  checklistTemplate: string[];
  noteTemplates: string[];
};

function buildSelectionState(p: Position): SelectionState {
  return {
    stages: [...p.stages],
    stageCategories: { ...p.stageCategories },
    stageNotes: p.stageNotes ? { ...p.stageNotes } : {},
    stageWipLimits: p.stageWipLimits
      ? Object.fromEntries(
          Object.entries(p.stageWipLimits).map(([stage, limit]) => [stage, String(limit)])
        )
      : {},
    aiCriteria: p.aiCriteria ?? "",
    hiddenUi: [...p.hiddenUi], // NR-22
    autoShortlistScore: p.autoShortlistScore == null ? "" : String(p.autoShortlistScore),
    autoShortlistStage: p.autoShortlistStage ?? "",
    assignmentTitle: p.assignment.title ?? "",
    assignmentUrl: p.assignment.url ?? "",
    assignmentNote: p.assignment.note ?? "",
    rubricCriteria: [...p.rubricCriteria],
    checklistTemplate: [...p.checklistTemplate],
    noteTemplates: [...p.noteTemplates],
  };
}

export function PositionSelectionPage({
  position,
  statsRow,
  onBack,
  onSaved,
}: {
  position: Position;
  statsRow: PositionStatsRow | null;
  onBack: () => void;
  onSaved: (p: Position) => void;
}) {
  const [form, setForm] = useState<SelectionState>(() => buildSelectionState(position));

  const set = <K extends keyof SelectionState>(key: K, value: SelectionState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // NR-22 — aktif/nonaktifkan penyembunyian satu blok di dialog detail lamaran.
  const toggleHiddenUi = (key: HiddenUiKey, hidden: boolean) =>
    setForm((f) => ({
      ...f,
      hiddenUi: hidden ? [...f.hiddenUi, key] : f.hiddenUi.filter((k) => k !== key),
    }));

  const cleanedStages = useMemo(
    () => form.stages.map((s) => s.trim()).filter(Boolean),
    [form.stages]
  );

  // Tahap kustom (di luar 5 bawaan) — untuk editor kategori fitur tab Pipeline.
  const customStages = useMemo(
    () => cleanedStages.filter((s) => !isBuiltInStage(s)),
    [cleanedStages]
  );

  // Daftar tahap efektif (bawaan bila pipeline kustom kosong) — dipakai editor
  // penjelasan tahap untuk halaman status pelamar.
  const effectiveStages = useMemo(() => stagesForPosition(cleanedStages), [cleanedStages]);

  // Catatan tahap yang dikirim ke server: hanya tahap aktif + teks non-kosong
  // (catatan tahap yang dihapus dari pipeline ikut terbersihkan otomatis).
  const cleanStageNotes = useMemo(() => {
    const out: Record<string, string> = {};
    for (const stage of effectiveStages) {
      const note = (form.stageNotes[stage] ?? "").trim();
      if (note) out[stage] = note;
    }
    return out;
  }, [effectiveStages, form.stageNotes]);

  // NR-19 — batas kapasitas tahap yang dikirim ke server: hanya tahap aktif
  // dengan angka valid 1-999 (kosong = tanpa batas; {} di server = clear/null).
  const cleanStageWipLimits = useMemo(() => {
    const out: Record<string, number> = {};
    for (const stage of effectiveStages) {
      const raw = (form.stageWipLimits[stage] ?? "").trim();
      if (!raw) continue;
      const limit = Number(raw);
      if (Number.isInteger(limit) && limit >= 1 && limit <= 999) out[stage] = limit;
    }
    return out;
  }, [effectiveStages, form.stageWipLimits]);

  const invalidWipStages = useMemo(() => {
    const out: string[] = [];
    for (const stage of effectiveStages) {
      const raw = (form.stageWipLimits[stage] ?? "").trim();
      if (!raw) continue;
      const limit = Number(raw);
      if (!Number.isInteger(limit) || limit < 1 || limit > 999) out.push(stageLabel(stage));
    }
    return out;
  }, [effectiveStages, form.stageWipLimits]);

  // Lamaran pada tahap di luar daftar pipeline tersimpan (dari stats funnel).
  const outOfStageApps = useMemo(() => {
    if (!statsRow) return 0;
    const inFunnel = statsRow.funnel.reduce((sum, f) => sum + f.count, 0);
    return Math.max(0, statsRow.applications - inFunnel);
  }, [statsRow]);

  return (
    <SettingsPageShell
      position={position}
      pageTitle="Seleksi"
      description="Atur pipeline tahap, auto-shortlist, kriteria AI, tes, dan rubrik evaluasi posisi ini."
      saveLabel="Simpan Seleksi"
      successToast="Setelan seleksi disimpan"
      onBack={onBack}
      onSaved={onSaved}
      validate={() => {
        const errors: string[] = [];
        if (cleanedStages.length > 12)
          errors.push("Pipeline tahap maksimal 12 tahap.");
        if (invalidWipStages.length > 0)
          errors.push(
            `Batas kapasitas tahap ${invalidWipStages.join(", ")} harus angka bulat 1-999, atau dikosongkan.`
          );
        if (form.autoShortlistScore.trim() !== "") {
          if (
            !isInt(form.autoShortlistScore) ||
            Number(form.autoShortlistScore) < 0 ||
            Number(form.autoShortlistScore) > 100
          )
            errors.push("Skor auto-shortlist harus angka bulat 0-100, atau dikosongkan.");
        }
        if (
          form.assignmentUrl.trim().length > 0 &&
          !/^https?:\/\//i.test(form.assignmentUrl.trim())
        )
          errors.push("URL tes/assignment harus diawali http:// atau https://.");
        return errors;
      }}
      buildPayload={() => ({
        stages: cleanedStages,
        stageCategories: form.stageCategories,
        stageNotes: cleanStageNotes,
        stageWipLimits: cleanStageWipLimits,
        hiddenUi: form.hiddenUi, // NR-22
        aiCriteria: form.aiCriteria.trim() || null,
        autoShortlistScore:
          form.autoShortlistScore.trim() === "" ? null : Number(form.autoShortlistScore),
        autoShortlistStage:
          cleanedStages.length === 0 ? null : form.autoShortlistStage || null,
        assignmentTitle: form.assignmentTitle.trim() || null,
        assignmentUrl: form.assignmentUrl.trim() || null,
        assignmentNote: form.assignmentNote.trim() || null,
        rubricCriteria: form.rubricCriteria.map((r) => r.trim()).filter(Boolean),
        checklistTemplate: form.checklistTemplate.map((c) => c.trim()).filter(Boolean),
        noteTemplates: form.noteTemplates.map((n) => n.trim()).filter(Boolean),
      })}
    >
      {(errors) => {
        const hasErr = (...keywords: string[]) =>
          errors.some((e) => keywords.some((k) => e.toLowerCase().includes(k)));
        return (
          <>
      <FormSection
        id="pipeline"
        icon={Workflow}
        title="Pipeline Tahap"
        hint="Tahapan seleksi kustom dan kategori fitur tahap."
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

        {/* NR-15 idea 2: penjelasan per tahap yang tampil di halaman Cek Status pelamar */}
        <div className="flex flex-col gap-1.5">
          <Label>Penjelasan Tahap untuk Pelamar (opsional)</Label>
          <p className="text-xs text-muted-foreground">
            Teks ini tampil pada halaman Cek Status pelamar saat lamaran berada di tahap
            terkait. Kosongkan untuk memakai penjelasan bawaan.
          </p>
          <div className="flex flex-col gap-2">
            {effectiveStages.map((stage, i) => (
              <div key={stage} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <span
                  className="w-44 shrink-0 truncate rounded-lg border bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
                  title={stage}
                >
                  {stageLabel(stage)}
                </span>
                <Input
                  id={`pos-stageNote-${i}`}
                  value={form.stageNotes[stage] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      stageNotes: { ...f.stageNotes, [stage]: e.target.value },
                    }))
                  }
                  placeholder={`Penjelasan untuk pelamar pada tahap ${stageLabel(stage)}`}
                  className="h-10"
                  maxLength={400}
                  aria-label={`Penjelasan tahap ${stageLabel(stage)} untuk pelamar`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* NR-19 idea 2: batas kapasitas per tahap (WIP limit) — kanban + Pusat Tugas */}
        <div className="flex flex-col gap-1.5">
          <Label>Batas Kapasitas Tahap (opsional)</Label>
          <p className="text-xs text-muted-foreground">
            Batas maksimum kandidat aktif per tahap. Kolom kanban yang melebihinya ditandai dan
            tahap bermasalah muncul di Pusat Tugas. Kosongkan untuk tahap tanpa batas.
          </p>
          <div className="flex flex-col gap-2">
            {effectiveStages.map((stage, i) => (
              <div key={stage} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <span
                  className="w-44 shrink-0 truncate rounded-lg border bg-zinc-50 px-3 py-2 text-sm dark:bg-zinc-900"
                  title={stage}
                >
                  {stageLabel(stage)}
                </span>
                <Input
                  id={`pos-stageWipLimit-${i}`}
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  value={form.stageWipLimits[stage] ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      stageWipLimits: { ...f.stageWipLimits, [stage]: e.target.value },
                    }))
                  }
                  placeholder="Tanpa batas"
                  className="h-10"
                  aria-label={`Batas kapasitas tahap ${stageLabel(stage)}`}
                />
              </div>
            ))}
          </div>
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
                      form.stageCategories[stage] ?? defaultCategoryForCustomStage(stage)
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
      </FormSection>

      <FormSection
        id="auto-shortlist"
        icon={Zap}
        title="Auto-Shortlist"
        hint="Pindahkan otomatis lamaran Baru saat skor AI mencapai ambang."
        hasError={hasErr("auto-shortlist")}
      >
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
              onValueChange={(v) => set("autoShortlistStage", v === SHORTLIST_NONE ? "" : v)}
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
      </FormSection>

      <FormSection
        id="ai"
        icon={Sparkles}
        title="Kriteria AI"
        hint="Kriteria tambahan untuk prompt screening AI posisi ini."
      >
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

      <FormSection
        id="tes"
        icon={ClipboardList}
        title="Tes untuk Pelamar"
        hint="Info tes/brief dikirim bersama pesan konfirmasi lamaran."
        hasError={hasErr("url tes")}
      >
        <div className="rounded-lg border p-3">
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

      <FormSection
        id="rubrik"
        icon={ClipboardCheck}
        title="Rubrik Penilaian"
        hint="Kriteria untuk menilai kualitas lamaran."
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
      </FormSection>

      <FormSection
        id="checklist"
        icon={ListChecks}
        title="Template Checklist"
        hint="Checklist cepat saat meninjau lamaran."
      >
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
      </FormSection>

      <FormSection
        id="catatan"
        icon={StickyNote}
        title="Template Catatan Cepat"
        hint="Catatan satu klik saat menulis evaluasi lamaran."
      >
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

      {/* NR-22 — tampilan dialog detail lamaran untuk posisi ini */}
      <FormSection
        id="tampilan"
        icon={EyeOff}
        title="Tampilan Detail Lamaran"
        hint="Blok yang disembunyikan tidak tampil saat admin membuka detail lamaran posisi ini (default: semua tampil)."
      >
        <div className="flex flex-col gap-1.5">
          <Label>Blok yang Disembunyikan</Label>
          {HIDDEN_UI_OPTIONS.map((opt) => {
            const hidden = form.hiddenUi.includes(opt.key);
            return (
              <div
                key={opt.key}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">{opt.hint}</p>
                </div>
                <Switch
                  checked={hidden}
                  onCheckedChange={(checked) => toggleHiddenUi(opt.key, checked)}
                  aria-label={hidden ? `Tampilkan kembali ${opt.label}` : `Sembunyikan ${opt.label}`}
                />
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">
            Posisi operasional non-kreatif biasanya menyembunyikan Panel AI dan Portofolio.
          </p>
        </div>
      </FormSection>
          </>
        );
      }}
    </SettingsPageShell>
  );
}

/* ========================================================================== */
/* 3. Wawancara — bawaan, scorecard & ronde, template undangan.                */
/* ========================================================================== */

type InterviewState = {
  interviewMode: InterviewMode;
  interviewPlatform: InterviewPlatform;
  interviewDuration: string;
  interviewCriteria: string[];
  // Rencana ronde wawancara (template untuk "Jadwalkan Ronde Berikutnya")
  roundPlan: { name: string; durationMin: string; interviewers: string }[];
  interviewInviteTemplate: string;
};

function buildInterviewState(p: Position): InterviewState {
  return {
    interviewMode: p.interviewMode,
    interviewPlatform: p.interviewPlatform,
    interviewDuration: String(p.interviewDuration ?? 45),
    interviewCriteria: [...p.interviewCriteria],
    roundPlan: (p.roundPlan ?? []).map((r) => ({
      name: r.name,
      durationMin: r.durationMin != null ? String(r.durationMin) : "",
      interviewers: (r.interviewers ?? []).join(", "),
    })),
    interviewInviteTemplate: p.interviewInviteTemplate ?? "",
  };
}

export function PositionInterviewPage({
  position,
  onBack,
  onSaved,
}: {
  position: Position;
  onBack: () => void;
  onSaved: (p: Position) => void;
}) {
  const [form, setForm] = useState<InterviewState>(() => buildInterviewState(position));

  const set = <K extends keyof InterviewState>(key: K, value: InterviewState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <SettingsPageShell
      position={position}
      pageTitle="Wawancara"
      description="Atur mode, durasi, scorecard, rencana ronde, dan template undangan wawancara."
      saveLabel="Simpan Wawancara"
      successToast="Setelan wawancara disimpan"
      onBack={onBack}
      onSaved={onSaved}
      validate={() => {
        const errors: string[] = [];
        if (form.interviewDuration.trim() !== "") {
          if (
            !isInt(form.interviewDuration) ||
            Number(form.interviewDuration) < 10 ||
            Number(form.interviewDuration) > 480
          )
            errors.push("Durasi wawancara harus angka bulat 10-480 menit.");
        }
        return errors;
      }}
      buildPayload={() => ({
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
              r.durationMin.trim() !== "" && isInt(r.durationMin)
                ? Number(r.durationMin)
                : undefined,
            interviewers: r.interviewers.split(",").map((n) => n.trim()).filter(Boolean),
          })),
        interviewInviteTemplate: form.interviewInviteTemplate.trim() || null,
      })}
    >
      {(errors) => {
        const hasErr = (...keywords: string[]) =>
          errors.some((e) => keywords.some((k) => e.toLowerCase().includes(k)));
        return (
          <>
      <FormSection
        id="bawaan"
        icon={Video}
        title="Bawaan Wawancara"
        hint="Mode, platform, dan durasi default saat menjadwalkan wawancara."
        hasError={hasErr("durasi wawancara")}
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
      </FormSection>

      <FormSection
        id="scorecard"
        icon={ClipboardCheck}
        title="Kriteria Scorecard"
        hint="Kriteria penilaian wawancara."
      >
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
      </FormSection>

      <FormSection
        id="ronde"
        icon={ListOrdered}
        title="Rencana Ronde"
        hint='Rencana ronde untuk fitur "Jadwalkan Ronde Berikutnya" di dialog wawancara.'
      >
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Rencana Ronde Wawancara (opsional)</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={form.roundPlan.length >= 10}
              onClick={() =>
                set("roundPlan", [
                  ...form.roundPlan,
                  { name: "", durationMin: "", interviewers: "" },
                ])
              }
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Tambah ronde
            </Button>
          </div>
          {form.roundPlan.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Contoh: HR Screen 30 menit, lalu User Trial 60 menit. Setelah sebuah ronde selesai, admin bisa
              menjadwalkan ronde berikutnya sekali klik dari dialog wawancara.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {form.roundPlan.map((row, index) => (
                <div
                  key={index}
                  className="grid grid-cols-1 items-end gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_110px_1fr_auto]"
                >
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Nama ronde {index + 1}</Label>
                    <Input
                      value={row.name}
                      onChange={(e) =>
                        set(
                          "roundPlan",
                          form.roundPlan.map((r, i) =>
                            i === index ? { ...r, name: e.target.value } : r,
                          ),
                        )
                      }
                      placeholder="mis. HR Screen"
                      className="h-9"
                      maxLength={60}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Durasi (menit)</Label>
                    <Input
                      type="number"
                      min={10}
                      max={480}
                      value={row.durationMin}
                      onChange={(e) =>
                        set(
                          "roundPlan",
                          form.roundPlan.map((r, i) =>
                            i === index ? { ...r, durationMin: e.target.value } : r,
                          ),
                        )
                      }
                      placeholder="45"
                      className="h-9"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Pewawancara (pisah koma)</Label>
                    <Input
                      value={row.interviewers}
                      onChange={(e) =>
                        set(
                          "roundPlan",
                          form.roundPlan.map((r, i) =>
                            i === index ? { ...r, interviewers: e.target.value } : r,
                          ),
                        )
                      }
                      placeholder="mis. Ajo (HR), Jawa (Owner)"
                      className="h-9"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 px-2 text-rose-600 hover:text-rose-700"
                    aria-label={`Hapus ronde ${index + 1}`}
                    onClick={() => set("roundPlan", form.roundPlan.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </FormSection>

      <FormSection
        id="undangan"
        icon={Send}
        title="Template Undangan"
        hint="Pesan undangan yang dikirim saat wawancara dijadwalkan."
      >
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
          </>
        );
      }}
    </SettingsPageShell>
  );
}

/* ========================================================================== */
/* 4. Pesan — otomasi status lamaran, penawaran & onboarding.                  */
/* ========================================================================== */

type MessagesState = {
  applyTemplate: string;
  acceptTemplate: string;
  rejectTemplate: string;
  offerTemplate: string;
  welcomeTemplate: string;
  probationMonths: string;
  reapplyCooldownDays: string;
  onboardingDocs: string[];
  autoCloseOnHired: boolean;
};

function buildMessagesState(p: Position): MessagesState {
  return {
    applyTemplate: p.replyTemplates.apply ?? "",
    acceptTemplate: p.replyTemplates.accept ?? "",
    rejectTemplate: p.replyTemplates.reject ?? "",
    offerTemplate: p.offerTemplate ?? "",
    welcomeTemplate: p.welcomeTemplate ?? "",
    probationMonths: String(p.probationMonths ?? 0),
    reapplyCooldownDays: String(p.reapplyCooldownDays ?? 0),
    onboardingDocs: [...p.onboardingDocs],
    autoCloseOnHired: p.autoCloseOnHired,
  };
}

export function PositionMessagesPage({
  position,
  onBack,
  onSaved,
}: {
  position: Position;
  onBack: () => void;
  onSaved: (p: Position) => void;
}) {
  const [form, setForm] = useState<MessagesState>(() => buildMessagesState(position));

  const set = <K extends keyof MessagesState>(key: K, value: MessagesState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <SettingsPageShell
      position={position}
      pageTitle="Pesan"
      description="Atur template pesan otomatis, penawaran, dan onboarding untuk posisi ini."
      saveLabel="Simpan Pesan"
      successToast="Setelan pesan disimpan"
      onBack={onBack}
      onSaved={onSaved}
      validate={() => {
        const errors: string[] = [];
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
      }}
      buildPayload={() => ({
        applyTemplate: form.applyTemplate.trim() || null,
        acceptTemplate: form.acceptTemplate.trim() || null,
        rejectTemplate: form.rejectTemplate.trim() || null,
        offerTemplate: form.offerTemplate.trim() || null,
        welcomeTemplate: form.welcomeTemplate.trim() || null,
        probationMonths:
          form.probationMonths.trim() === "" ? 0 : Number(form.probationMonths),
        reapplyCooldownDays:
          form.reapplyCooldownDays.trim() === "" ? 0 : Number(form.reapplyCooldownDays),
        onboardingDocs: form.onboardingDocs.map((d) => d.trim()).filter(Boolean),
        autoCloseOnHired: form.autoCloseOnHired,
      })}
    >
      {(errors) => {
        const hasErr = (...keywords: string[]) =>
          errors.some((e) => keywords.some((k) => e.toLowerCase().includes(k)));
        return (
          <>
      <FormSection
        id="otomasi"
        icon={MessagesSquare}
        title="Otomasi Status Lamaran"
        hint="Pesan otomatis saat pelamar mendaftar, diterima, atau ditolak, plus jeda lamar ulang."
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

        <div className="flex flex-col gap-1.5 sm:max-w-56">
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
      </FormSection>

      <FormSection
        id="penawaran"
        icon={BadgeCheck}
        title="Penawaran"
        hint="Pesan penawaran untuk kandidat lolos dan tindak lanjutnya."
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

      <FormSection
        id="onboarding"
        icon={UserCheck}
        title="Onboarding"
        hint="Sambutan kandidat baru, masa percobaan, dan dokumen onboarding."
        hasError={hasErr("masa percobaan")}
      >
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
      </FormSection>
          </>
        );
      }}
    </SettingsPageShell>
  );
}
