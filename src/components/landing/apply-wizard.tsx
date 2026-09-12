"use client";

import { useEffect, useRef, useState } from "react";
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
  PencilLine,
  ShieldCheck,
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
import { cn } from "@/lib/utils";
import { useLang } from "@/components/landing/lang-context";
import { fillTemplate, formatMb, safeExternalUrl } from "@/components/landing/landing-utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DRAFT_KEY = "lumina-draft";
const AUTOSAVE_DELAY_MS = 500;
const MIN_TEXT_LENGTH = 10;
const SCREENING_MAX = 500; // batas karakter tiap jawaban screening (sinkron dengan server)
const SCREENING_KEY_PREFIX = "screening:";

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
  const { t } = useLang();
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  // Pratinjau & konfirmasi sebelum pengiriman (tidak ada kirim otomatis).
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [direction, setDirection] = useState(1);
  const [success, setSuccess] = useState<{
    name: string;
    trackingCode: string;
    autoReply: string | null;
    assignment: ApplySuccessResponse["assignment"];
  } | null>(null);

  // Jawaban pertanyaan screening posisi: {questionId: jawaban}
  const [screeningAnswers, setScreeningAnswers] = useState<Record<string, string>>({});
  // Sumber pelamar ("dari mana tahu lowongan ini") — opsional.
  const [source, setSource] = useState("");
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

  // Reset jawaban screening saat posisi berubah (termasuk perubahan dari luar
  // wizard lewat dialog posisi) — pola "adjust state during render", tanpa effect.
  const [lastPositionId, setLastPositionId] = useState(positionId);
  if (lastPositionId !== positionId) {
    setLastPositionId(positionId);
    setScreeningAnswers({});
  }

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

  /** Simpan jawaban screening (dipotong 500 karakter) + hapus error saat diketik. */
  const setAnswer = (questionId: string, value: string) => {
    const clipped = value.slice(0, SCREENING_MAX);
    setScreeningAnswers((prev) => ({ ...prev, [questionId]: clipped }));
    const key = `${SCREENING_KEY_PREFIX}${questionId}` as FieldKey;
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
    // Saat lockPosition, posisi tetap dari halaman detail — dianggap valid,
    // error "pilih posisi" tidak perlu ditampilkan.
    if (!lockPosition && positions.length > 0 && !positionId)
      next.positionId = t.apply.errors.position;
    return next;
  }

  function validateStep2(): FormErrors {
    const next: FormErrors = {};
    if (values.experience.trim().length < MIN_TEXT_LENGTH)
      next.experience = t.apply.errors.experience;
    if (values.motivation.trim().length < MIN_TEXT_LENGTH)
      next.motivation = t.apply.errors.motivation;
    // Pertanyaan screening wajib milik posisi terpilih.
    for (const question of screeningQuestions) {
      if (question.required && !(screeningAnswers[question.id] ?? "").trim()) {
        next[`${SCREENING_KEY_PREFIX}${question.id}`] = fillTemplate(
          t.apply.errors.screeningRequired,
          { label: question.label },
        );
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

  function goToStep(next: number) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function goNext() {
    const next = step === 0 ? validateStep1() : validateStep2();
    setErrors((prev) => ({ ...prev, ...next }));
    if (Object.values(next).some(Boolean)) {
      if (step === 1) {
        // Screening wajib kosong: sorot + scroll + toast (pola error wizard).
        const screeningError = firstScreeningErrorOf(next);
        if (screeningError) {
          scrollToScreening(screeningError.id);
          toast.error(screeningError.message);
        }
      }
      return;
    }
    goToStep(Math.min(2, step + 1));
  }

  function goBack() {
    goToStep(Math.max(0, step - 1));
  }

  /** Validasi seluruh formulir; bila ada galat, lompat ke langkah pertama yang bermasalah. */
  function validateAllAndJump(): boolean {
    const e1 = validateStep1();
    const e2 = validateStep2();
    setErrors((prev) => ({ ...prev, ...e1, ...e2 }));
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
    return true;
  }

  /** Berkas wajib per posisi (CV/audio intro) — dipakai sebelum masuk pratinjau. */
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
      // Jawaban screening posisi (JSON {questionId: jawaban}) — hanya yang terisi.
      if (screeningQuestions.length > 0) {
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

    // Langkah 0-1: validasi per langkah lalu maju.
    if (step === 0 || step === 1) {
      goNext();
      return;
    }

    // Langkah 3 (Berkas): validasi semuanya (termasuk berkas wajib), lalu pratinjau.
    if (step === 2) {
      if (!validateAllAndJump()) return;
      if (!validateRequiredFiles()) return;
      goToStep(3);
      return;
    }

    // Langkah 3 (Pratinjau): wajib pernyataan kebenaran data sebelum konfirmasi.
    if (!agreed) {
      toast.error(t.apply.preview.agreeRequired);
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
    setConfirmOpen(false);
    setDirection(1);
    setSource("");
    setScreeningAnswers({});
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

  const stepLabels = t.apply.steps;

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

            {/* Pertanyaan screening khusus posisi terpilih (v3) */}
            {screeningQuestions.length > 0 ? (
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

        {/* LANGKAH 3: Berkas (CV & audio perkenalan) */}
        {step === 2 && (
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

            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {t.apply.trust[0]}
            </p>
          </div>
        )}

        {/* LANGKAH 4: Pratinjau & Konfirmasi — lamaran tidak terkirim otomatis */}
        {step === 3 && (
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

            {/* Jawaban screening posisi — hanya bila posisi punya pertanyaan */}
            {screeningQuestions.length > 0 ? (
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
            <Button type="submit" className="h-11 min-w-32">
              {t.apply.buttons.next}
            </Button>
          ) : step === 2 ? (
            <Button type="submit" className="h-11 min-w-40">
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t.apply.buttons.review}
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
