"use client";

// NR60 (Task 2-c D2) — "Pratinjau sebagai pelamar" di Form Builder admin.
// Dialog yang merender SKEMA DRAF saat ini (termasuk editan yang belum
// disimpan) persis seperti pengalaman pelamar di wizard publik:
// - bagian diurut sesuai skema, bagian kosong/tombstone dilewati
//   (sectionHasStep — semantik sama dengan wizard);
// - pertanyaan kustom dirender via FormFieldRenderer bersama
//   (src/components/landing/form-field-renderer.tsx — hasil ekstraksi 2-b);
// - visibilitas kondisional (showIf) dievaluasi per jawaban saat ini lewat
//   isFieldVisible (helper resmi src/lib/form-schema.ts — semantik identik
//   dengan wizard publik), sehingga field kondisional muncul/hilang HIDUP;
// - item inti (Nama/Email/WA/NIK/Tanggal Lahir/Pengalaman/Motivasi/CV/intro/
//   portofolio) dirender ringkas dengan label/placeholder/teks bantuan hasil
//   kustomisasi admin (coreItem/coreItemLabel) dan status wajib dari getter;
// - berkas dipilih hanya disimpan LOKAL (File di state + pratinjau blob),
//   TIDAK diunggah ke mana pun.
//
// FormFieldRenderer memakai useLang (konteks landing) — isi dialog dibungkus
// LangProvider sendiri agar aman dipakai di panel admin (pola position-detail).
// TIDAK menyentuh apply-wizard.tsx.

import { Fragment, useMemo, useState } from "react";
import { Eye, FileText, Info, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LangProvider, useLang } from "@/components/landing/lang-context";
import {
  FormFieldRenderer,
  ImageThumb,
  LocalFileViewerDialog,
  formSectionTitle,
  type FormAnswerInput,
  type FormAnswers,
} from "@/components/landing/form-field-renderer";
import { formatMb } from "@/components/landing/landing-utils";
import {
  coreItem,
  coreItemLabel,
  isBirthDateEnabled,
  isBirthDateRequired,
  isCvEnabled,
  isCvRequired,
  isEmailRequired,
  isExperienceEnabled,
  isExperienceRequired,
  isFieldVisible,
  isIntroEnabled,
  isIntroRequired,
  isMotivationEnabled,
  isMotivationRequired,
  isNikEnabled,
  isNikRequired,
  isPortfolioEnabled,
  isPortfolioRequired,
  isWaRequired,
  sectionFields,
  sectionHasStep,
  type FormField,
  type FormSchema,
  type FormSection,
} from "@/lib/form-schema";

/* ------------------------------ Komponen utama ------------------------------ */

export function FormBuilderPreviewDialog({
  open,
  onOpenChange,
  schema,
  positionTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Skema DRAF (bukan tersimpan) — editan terkini ikut terlihat. */
  schema: FormSchema | null;
  positionTitle: string;
}) {
  const steps = useMemo(
    () =>
      schema
        ? schema.sections.filter((section) => sectionHasStep(schema, section))
        : [],
    [schema],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-4 overflow-hidden rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Eye className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Pratinjau Formulir Pelamar
          </DialogTitle>
          <DialogDescription>
            Beginilah formulir lamaran {positionTitle ? `untuk ${positionTitle} ` : ""}
            tampil di mata pelamar — pertanyaan kondisional menyesuaikan jawaban saat ini.
          </DialogDescription>
        </DialogHeader>

        {/* Konten bisa digulir; state jawaban hidup di PreviewBody. Radix
            me-unmount isi dialog saat tertutup, jadi setiap buka = mulai kosong. */}
        <div className="min-h-0 flex-1 overflow-y-auto nice-scrollbar">
          {schema && steps.length > 0 ? (
            <LangProvider>
              <PreviewBody schema={schema} steps={steps} />
            </LangProvider>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <FileText className="size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Belum ada bagian formulir yang bisa ditampilkan. Tambahkan pertanyaan
                atau aktifkan isi bagian terlebih dahulu.
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Pratinjau — tidak ada data yang disimpan.
          </p>
          <Button
            type="button"
            variant="outline"
            className="h-11 sm:h-9"
            onClick={() => onOpenChange(false)}
          >
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Isi pratinjau ------------------------------ */

function PreviewBody({
  schema,
  steps,
}: {
  schema: FormSchema;
  steps: FormSection[];
}) {
  const { t, lang } = useLang();

  // Jawaban pertanyaan kustom (stateful — sumber evaluasi showIf).
  const [answers, setAnswers] = useState<FormAnswers>({});
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // Isian ringkas item inti (representatif, tidak divalidasi — ini pratinjau).
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [wa, setWa] = useState("");
  const [nik, setNik] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [experience, setExperience] = useState("");
  const [motivation, setMotivation] = useState("");
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [introFile, setIntroFile] = useState<File | null>(null);

  /** Set/hapus jawaban field kustom + bersihkan error field itu (pola wizard). */
  function handleFormAnswer(fieldId: string, value: FormAnswerInput | undefined) {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[fieldId];
      else next[fieldId] = value;
      return next;
    });
    setFormErrors((prev) => {
      if (!prev[fieldId]) return prev;
      const next = { ...prev };
      delete next[fieldId];
      return next;
    });
  }

  function handleFormAnswerError(fieldId: string, message: string) {
    setFormErrors((prev) => ({ ...prev, [fieldId]: message }));
  }

  const requiredMark = (required: boolean) =>
    required ? (
      <span className="text-rose-600">*</span>
    ) : (
      <span className="text-xs font-normal text-muted-foreground">
        ({t.apply.uploads.optional})
      </span>
    );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        {t.apply.requiredBefore} <span className="text-rose-600">*</span>{" "}
        {t.apply.requiredAfter}
      </p>

      {steps.map((section, index) => (
        <section
          key={section.id}
          aria-label={formSectionTitle(section, lang)}
          className="flex flex-col gap-4 rounded-2xl border bg-background p-4 sm:p-5"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Bagian {index + 1}
            </p>
            <h4 className="text-sm font-bold leading-tight">
              {formSectionTitle(section, lang)}
            </h4>
            {section.description ? (
              <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
            ) : null}
          </div>

          {/* Item inti ringkas per jenis bagian — label/placeholder/bantuan
              mengikuti kustomisasi admin (NR-26), status wajib dari getter. */}
          {section.kind === "biodata" ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="preview-core-name" className="gap-2">
                  {coreItemLabel(section, "name")} {requiredMark(true)}
                </Label>
                {coreItem(section, "name").helpText ? (
                  <p className="text-xs text-muted-foreground">
                    {coreItem(section, "name").helpText}
                  </p>
                ) : null}
                <Input
                  id="preview-core-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    coreItem(section, "name").placeholder?.trim() || t.apply.fields.namePh
                  }
                  autoComplete="name"
                  className="h-11"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="preview-core-email" className="gap-2">
                  {coreItemLabel(section, "email")} {requiredMark(isEmailRequired(section))}
                </Label>
                {coreItem(section, "email").helpText ? (
                  <p className="text-xs text-muted-foreground">
                    {coreItem(section, "email").helpText}
                  </p>
                ) : null}
                <Input
                  id="preview-core-email"
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={
                    coreItem(section, "email").placeholder?.trim() || t.apply.fields.emailPh
                  }
                  autoComplete="email"
                  className="h-11"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="preview-core-wa" className="gap-2">
                  {coreItemLabel(section, "wa")} {requiredMark(isWaRequired(section))}
                </Label>
                {coreItem(section, "wa").helpText ? (
                  <p className="text-xs text-muted-foreground">
                    {coreItem(section, "wa").helpText}
                  </p>
                ) : null}
                <Input
                  id="preview-core-wa"
                  type="tel"
                  inputMode="tel"
                  value={wa}
                  onChange={(e) => setWa(e.target.value)}
                  placeholder={
                    coreItem(section, "wa").placeholder?.trim() || t.apply.fields.phonePh
                  }
                  autoComplete="tel"
                  className="h-11"
                />
              </div>
              {/* NR-32 — NIK & Tanggal Lahir: hanya bila diaktifkan admin. */}
              {isNikEnabled(section) ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="preview-core-nik" className="gap-2">
                    {coreItemLabel(section, "nik")} {requiredMark(isNikRequired(section))}
                  </Label>
                  {coreItem(section, "nik").helpText ? (
                    <p className="text-xs text-muted-foreground">
                      {coreItem(section, "nik").helpText}
                    </p>
                  ) : null}
                  <Input
                    id="preview-core-nik"
                    inputMode="numeric"
                    value={nik}
                    onChange={(e) => setNik(e.target.value)}
                    placeholder={coreItem(section, "nik").placeholder?.trim() || "16 digit"}
                    className="h-11"
                  />
                </div>
              ) : null}
              {isBirthDateEnabled(section) ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="preview-core-birthdate" className="gap-2">
                    {coreItemLabel(section, "birthDate")}{" "}
                    {requiredMark(isBirthDateRequired(section))}
                  </Label>
                  {coreItem(section, "birthDate").helpText ? (
                    <p className="text-xs text-muted-foreground">
                      {coreItem(section, "birthDate").helpText}
                    </p>
                  ) : null}
                  <Input
                    id="preview-core-birthdate"
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="h-11"
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {section.kind === "experience" ? (
            <>
              {isExperienceEnabled(section) ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="preview-core-experience" className="gap-2">
                    {coreItemLabel(section, "experience")}{" "}
                    {requiredMark(isExperienceRequired(section))}
                  </Label>
                  {coreItem(section, "experience").helpText ? (
                    <p className="text-xs text-muted-foreground">
                      {coreItem(section, "experience").helpText}
                    </p>
                  ) : null}
                  <Textarea
                    id="preview-core-experience"
                    rows={3}
                    value={experience}
                    onChange={(e) => setExperience(e.target.value)}
                    placeholder={
                      coreItem(section, "experience").placeholder?.trim() ||
                      t.apply.fields.experiencePh
                    }
                  />
                </div>
              ) : null}
              {isMotivationEnabled(section) ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="preview-core-motivation" className="gap-2">
                    {coreItemLabel(section, "motivation")}{" "}
                    {requiredMark(isMotivationRequired(section))}
                  </Label>
                  {coreItem(section, "motivation").helpText ? (
                    <p className="text-xs text-muted-foreground">
                      {coreItem(section, "motivation").helpText}
                    </p>
                  ) : null}
                  <Textarea
                    id="preview-core-motivation"
                    rows={3}
                    value={motivation}
                    onChange={(e) => setMotivation(e.target.value)}
                    placeholder={
                      coreItem(section, "motivation").placeholder?.trim() ||
                      t.apply.fields.motivationPh
                    }
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {section.kind === "files" ? (
            <>
              {isCvEnabled(section) ? (
                <CoreFileSlot
                  id="preview-core-cv"
                  label={coreItemLabel(section, "cv")}
                  fallbackLabel={t.apply.uploads.cvLabel}
                  helpText={coreItem(section, "cv").helpText}
                  required={isCvRequired(section)}
                  requiredHint={t.apply.uploads.cvRequiredHint}
                  accept=".pdf,application/pdf"
                  file={cvFile}
                  onFile={setCvFile}
                  optionalText={t.apply.uploads.optional}
                  dropHint={t.apply.uploads.dropHint}
                  viewLabel={t.apply.uploads.view}
                  removeLabel={t.apply.uploads.remove}
                />
              ) : null}
              {isIntroEnabled(section) ? (
                <CoreFileSlot
                  id="preview-core-intro"
                  label={coreItemLabel(section, "intro")}
                  fallbackLabel={t.apply.uploads.introLabel}
                  helpText={coreItem(section, "intro").helpText}
                  required={isIntroRequired(section)}
                  requiredHint={t.apply.uploads.introRequiredHint}
                  accept="audio/*,video/*"
                  file={introFile}
                  onFile={setIntroFile}
                  optionalText={t.apply.uploads.optional}
                  dropHint={t.apply.uploads.dropHint}
                  viewLabel={t.apply.uploads.view}
                  removeLabel={t.apply.uploads.remove}
                />
              ) : null}
              {isPortfolioEnabled(section) ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="preview-core-portfolio" className="gap-2">
                    {coreItemLabel(section, "portfolio")}{" "}
                    {requiredMark(isPortfolioRequired(section))}
                  </Label>
                  {coreItem(section, "portfolio").helpText ? (
                    <p className="text-xs text-muted-foreground">
                      {coreItem(section, "portfolio").helpText}
                    </p>
                  ) : null}
                  <Input
                    id="preview-core-portfolio"
                    type="url"
                    value={portfolioUrl}
                    onChange={(e) => setPortfolioUrl(e.target.value)}
                    placeholder={
                      coreItem(section, "portfolio").placeholder?.trim() || "https://..."
                    }
                    className="h-11"
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {/* Pertanyaan kustom bagian ini — hanya yang TERLIHAT (showIf cocok
              dgn jawaban saat ini), sub-header grup tampil saat berganti grup
              (semantik persis renderSectionFields di wizard publik). */}
          <SectionFieldsPreview
            fields={sectionFields(schema, section.id)}
            answers={answers}
            errors={formErrors}
            onAnswer={handleFormAnswer}
            onAnswerError={handleFormAnswerError}
          />
        </section>
      ))}
    </div>
  );
}

/**
 * Daftar field kustom satu bagian: filter isFieldVisible terhadap jawaban
 * saat ini (kondisional muncul/hilang langsung) + sub-header grup kecil
 * sebelum field yang grupnya berubah — pola sama dengan wizard publik.
 */
function SectionFieldsPreview({
  fields,
  answers,
  errors,
  onAnswer,
  onAnswerError,
}: {
  fields: FormField[];
  answers: FormAnswers;
  errors: Record<string, string>;
  onAnswer: (fieldId: string, value: FormAnswerInput | undefined) => void;
  onAnswerError: (fieldId: string, message: string) => void;
}) {
  const { lang } = useLang();
  const visible = fields.filter((field) => isFieldVisible(field, answers));
  let lastGroup: string | undefined;
  return (
    <>
      {visible.map((field) => {
        const groupChanged = (field.group ?? undefined) !== lastGroup;
        lastGroup = field.group ?? undefined;
        return (
          <Fragment key={field.id}>
            {groupChanged && field.group ? (
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
                {lang === "en" && field.groupEn ? field.groupEn : field.group}
              </p>
            ) : null}
            <FormFieldRenderer
              field={field}
              value={answers[field.id]}
              error={errors[field.id]}
              onAnswer={onAnswer}
              onAnswerError={onAnswerError}
              // Pratinjau lokal: tanpa meta draft server & tanpa unggahan —
              // berkas hanya hidup di state dialog (blob, tidak dikirim).
              draftFile={null}
              draftUploading={false}
              draftProgress={null}
            />
          </Fragment>
        );
      })}
      {visible.length === 0 && fields.length > 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          Semua pertanyaan di bagian ini tersembunyi menurut jawaban saat ini.
        </p>
      ) : null}
    </>
  );
}

/**
 * Slot berkas inti ringan (CV / audio-video perkenalan): kotak unggah gaya
 * wizard + baris berkas terpilih (thumbnail gambar via ImageThumb, pratinjau
 * isi via LocalFileViewerDialog blob lokal). Berkas hanya di state lokal —
 * tidak ada unggahan jaringan apa pun.
 */
function CoreFileSlot({
  id,
  label,
  fallbackLabel,
  helpText,
  required,
  requiredHint,
  accept,
  file,
  onFile,
  optionalText,
  dropHint,
  viewLabel,
  removeLabel,
}: {
  id: string;
  label: string;
  fallbackLabel: string;
  helpText?: string;
  required: boolean;
  requiredHint: string;
  accept: string;
  file: File | null;
  onFile: (file: File | null) => void;
  optionalText: string;
  dropHint: string;
  viewLabel: string;
  removeLabel: string;
}) {
  const [viewOpen, setViewOpen] = useState(false);
  const effectiveLabel = label.trim() ? label : fallbackLabel;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="gap-2">
        {effectiveLabel}{" "}
        {required ? (
          <span className="text-xs font-normal text-rose-600">({requiredHint})</span>
        ) : (
          <span className="text-xs font-normal text-muted-foreground">
            ({optionalText})
          </span>
        )}
      </Label>
      {helpText ? <p className="text-xs text-muted-foreground">{helpText}</p> : null}
      <label
        htmlFor={id}
        className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-4 text-center transition-colors hover:bg-accent/50"
      >
        <Upload className="h-5 w-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">{dropHint}</span>
        <input
          id={id}
          name={id}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(event) => {
            onFile(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
      </label>
      {file ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            {/* NR60 (B2) — thumbnail 40x40 utk berkas gambar (klik = pratinjau). */}
            <ImageThumb
              file={file}
              onView={() => setViewOpen(true)}
              viewLabel={viewLabel}
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
              {viewLabel}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={removeLabel}
              onClick={() => onFile(null)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ) : null}
      {/* NR-36 — pratinjau isi berkas lokal (blob:) tanpa jaringan. */}
      <LocalFileViewerDialog file={file} open={viewOpen} onOpenChange={setViewOpen} />
    </div>
  );
}
