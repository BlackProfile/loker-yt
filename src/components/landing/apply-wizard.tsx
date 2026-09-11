"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Copy,
  FileText,
  Loader2,
  Mic,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import { CV_MAX_BYTES, INTRO_MAX_BYTES, type Position } from "@/lib/types";
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
import { cn } from "@/lib/utils";
import { useLang } from "@/components/landing/lang-context";
import { formatMb } from "@/components/landing/landing-utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DRAFT_KEY = "lumina-draft";
const AUTOSAVE_DELAY_MS = 500;
const MIN_TEXT_LENGTH = 10;

type FormValues = {
  name: string;
  email: string;
  phone: string;
  portfolioUrl: string;
  socialLinks: string;
  experience: string;
  motivation: string;
};

type FieldKey = keyof FormValues | "positionId";
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
  savedAt?: unknown;
};

type ApplyWizardProps = {
  positions: Position[];
  positionId: string;
  onPositionIdChange: (positionId: string) => void;
};

export function ApplyWizard({
  positions,
  positionId,
  onPositionIdChange,
}: ApplyWizardProps) {
  const { t } = useLang();
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ name: string; trackingCode: string } | null>(
    null,
  );

  // File unggahan (tidak masuk draft).
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [introFile, setIntroFile] = useState<File | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const [introError, setIntroError] = useState<string | null>(null);
  const [cvDragging, setCvDragging] = useState(false);
  const [introDragging, setIntroDragging] = useState(false);

  // Draft autosave.
  const [draft, setDraft] = useState<StoredDraft | null>(null);
  const submittedRef = useRef(false);
  const draftDismissedRef = useRef(false);

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
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ values, positionId, savedAt: Date.now() }),
        );
      } catch {
        // penyimpanan penuh / tidak tersedia
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [values, positionId]);

  const setField = (key: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
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
    if (positions.length > 0 && !positionId) next.positionId = t.apply.errors.position;
    return next;
  }

  function validateStep2(): FormErrors {
    const next: FormErrors = {};
    if (values.experience.trim().length < MIN_TEXT_LENGTH)
      next.experience = t.apply.errors.experience;
    if (values.motivation.trim().length < MIN_TEXT_LENGTH)
      next.motivation = t.apply.errors.motivation;
    return next;
  }

  function goNext() {
    const next = step === 0 ? validateStep1() : validateStep2();
    setErrors((prev) => ({ ...prev, ...next }));
    if (Object.values(next).some(Boolean)) return;
    setStep((s) => Math.min(2, s + 1));
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const e1 = validateStep1();
    const e2 = validateStep2();
    const all = { ...e1, ...e2 };
    setErrors(all);
    if (e1.name || e1.email || e1.phone || e1.positionId) {
      setStep(0);
      return;
    }
    if (Object.values(all).some(Boolean)) {
      setStep(1);
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
      if (cvFile) fd.append("cvFile", cvFile);
      if (introFile) fd.append("introFile", introFile);

      const res = await fetch("/api/applications", { method: "POST", body: fd });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const serverError =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : null;
        toast.error(serverError ?? t.apply.errors.submitFailed);
        return;
      }
      const trackingCode =
        typeof data === "object" &&
        data !== null &&
        "trackingCode" in data &&
        typeof (data as { trackingCode: unknown }).trackingCode === "string"
          ? (data as { trackingCode: string }).trackingCode
          : "";

      submittedRef.current = true;
      try {
        window.localStorage.removeItem(DRAFT_KEY);
      } catch {
        // abaikan
      }
      setSuccess({ name: values.name.trim(), trackingCode });
      toast.success(t.apply.success.title);
    } catch {
      toast.error(t.apply.errors.submitFailed);
    } finally {
      setSubmitting(false);
    }
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
    onPositionIdChange("");
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
    if (
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
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center gap-4 py-8 text-center"
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-500/15">
          <CheckCircle2
            className="h-12 w-12 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
        </div>
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

        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <Button onClick={goToStatus}>{t.apply.success.checkStatus}</Button>
          <Button variant="outline" onClick={resetForm}>
            {t.apply.success.another}
          </Button>
        </div>
      </div>
    );
  }

  const stepLabels = t.apply.steps;
  const selectedPosition = positions.find((p) => p.id === positionId);

  return (
    <div className="flex flex-col gap-6">
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
            <p className="truncate text-xs text-muted-foreground">
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

      {/* Stepper */}
      <ol className="flex items-center gap-2" aria-label={t.apply.stepOf}>
        {stepLabels.map((label, index) => {
          const isDone = index < step;
          const isActive = index === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <div className="flex items-center gap-2">
                <span
                  aria-current={isActive ? "step" : undefined}
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
                    "hidden text-xs font-medium sm:block",
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
        {/* LANGKAH 1: Data Diri */}
        {step === 0 ? (
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
            </div>
          </div>
        ) : null}

        {/* LANGKAH 2: Pengalaman */}
        {step === 1 ? (
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
            </div>
          </div>
        ) : null}

        {/* LANGKAH 3: File & Kirim */}
        {step === 2 ? (
          <div className="flex flex-col gap-5">
            <div className="rounded-xl border bg-muted/40 p-4 text-sm">
              <p className="font-semibold">{t.apply.summary.title}</p>
              <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t.apply.summary.name}:</dt>
                  <dd className="truncate font-medium">{values.name || "-"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t.apply.summary.position}:</dt>
                  <dd className="truncate font-medium">
                    {selectedPosition?.title ?? t.apply.summary.notChosen}
                  </dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t.apply.summary.email}:</dt>
                  <dd className="truncate font-medium">{values.email || "-"}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-muted-foreground">{t.apply.summary.phone}:</dt>
                  <dd className="truncate font-medium">{values.phone || "-"}</dd>
                </div>
              </dl>
            </div>

            {/* Dropzone CV */}
            <div className="flex flex-col gap-2">
              <Label htmlFor="apply-cv" className="gap-2">
                {t.apply.uploads.cvLabel}
                <span className="text-xs font-normal text-muted-foreground">
                  ({t.apply.uploads.optional})
                </span>
              </Label>
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
                <span className="text-xs font-normal text-muted-foreground">
                  ({t.apply.uploads.optional})
                </span>
              </Label>
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

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {t.apply.trust[0]}
            </p>
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

          {step < 2 ? (
            <Button type="button" className="h-11 min-w-32" onClick={goNext}>
              {t.apply.buttons.next}
            </Button>
          ) : (
            <Button type="submit" className="h-11 min-w-40" disabled={submitting}>
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
      </form>
    </div>
  );
}
