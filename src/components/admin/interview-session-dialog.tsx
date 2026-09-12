"use client";

// Dialog sesi wawancara — dipakai dari tab Wawancara & dialog detail pelamar.
// Mode CREATE: form penjadwalan (mode/platform/jadwal/durasi/link/alamat/pewawancara)
//   + pratinjau pesan undangan dari template posisi.
// Mode EDIT/DETAIL: info sesi, aksi cepat (gabung/ics/gcalendar), edit form,
//   aksi status, scorecard hasil (nilai 1-5 per kriteria + rekomendasi + AUTOSAVE 1,2 dtk),
//   unggah rekaman + transkrip AI, tombol "Jadwalkan Ronde Berikutnya" dari Position.roundPlan,
//   hapus.
// Menyimpan hasil otomatis menandai sesi COMPLETED di server (PATCH).

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ClipboardCheck,
  Copy,
  Download,
  ExternalLink,
  FileAudio,
  Loader2,
  MapPin,
  MessageSquareWarning,
  Mic,
  Sparkles,
  Trash2,
  Upload,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_INTERVIEW_CRITERIA,
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  INTERVIEW_PLATFORM_LABELS,
  INTERVIEW_PLATFORMS,
  INTERVIEW_RECOMMENDATION_LABELS,
  INTERVIEW_STATUS_LABELS,
  type Application,
  type Interview,
  type InterviewMode,
  type InterviewPlatform,
  type InterviewRecommendation,
  type InterviewStatus,
  type Position,
  type RoundPlanTemplate,
} from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { copyText, formatDateTime, isoToLocalInput, localInputToIso } from "./format";
import { useAdminSession } from "./admin-context";
import { cn } from "@/lib/utils";

/* ------------------------------- Chip status ------------------------------- */

// Chip status inline (bukan StatusBadge pipeline) — warna fungsional per status.
const STATUS_CHIP_CLASS: Record<InterviewStatus, string> = {
  SCHEDULED:
    "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  CONFIRMED:
    "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  RESCHEDULE_REQUESTED:
    "border-orange-200 bg-orange-100 text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-400",
  COMPLETED:
    "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  NO_SHOW:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  CANCELLED:
    "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400",
};

export function InterviewStatusChip({
  status,
  className,
}: {
  status: InterviewStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        STATUS_CHIP_CLASS[status],
        className
      )}
    >
      {INTERVIEW_STATUS_LABELS[status]}
    </span>
  );
}

/* ------------------------------- Helper lokal ------------------------------ */

// Isi variabel template undangan secara manual (split/join, tanpa regex).
function fillTemplateManual(
  template: string,
  values: Record<string, string>
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template
  );
}

// URL "Tambah ke Google Calendar" — dates pakai format YYYYMMDDTHHMMSSZ.
function googleCalendarUrl(i: Interview): string {
  const start = new Date(i.scheduledAt);
  const end = new Date(start.getTime() + (i.durationMin || 45) * 60_000);
  const stamp = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const title = `Wawancara${i.positionTitle ? ` — ${i.positionTitle}` : ""}`;
  const details = [
    i.positionTitle ? `Posisi: ${i.positionTitle}` : null,
    `Mode: ${INTERVIEW_MODE_LABELS[i.mode]}`,
    i.mode === "ONSITE" && i.address ? `Alamat: ${i.address}` : null,
    i.meetingLink ? `Link meeting: ${i.meetingLink}` : null,
    i.durationMin ? `Durasi: ${i.durationMin} menit` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const location =
    i.mode === "ONSITE" ? (i.address ?? "") : (i.meetingLink ?? "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${stamp(start)}/${stamp(end)}`,
    details,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/* --------------------------------- Props ---------------------------------- */

export type InterviewCreateContext = {
  applicationId: string;
  applicationName: string;
  positionTitle: string | null;
  position: Position | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mode CREATE: wajib saat `interview` null. */
  create: InterviewCreateContext | null;
  /** Mode EDIT/DETAIL: sesi wawancara yang dibuka. */
  interview: Interview | null;
  /** Posisi terkait (untuk default mode/platform/durasi, kriteria & template). */
  position: Position | null;
  /** Pengubah key tambahan (mis. nonce) agar mode create selalu form bersih. */
  resetKey?: string | number;
  onSaved: (interview: Interview, application?: Application) => void;
  onDeleted?: (id: string) => void;
};

/* -------------------------------- Komponen -------------------------------- */

export function InterviewSessionDialog(props: Props) {
  const { interview, create, resetKey } = props;
  if (!interview && !create) return null;
  // Key memastikan state form bersih saat berganti sesi/mode tanpa
  // setState di effect (pola sama dengan dialog form posisi).
  // updatedAt menyertakan key edit agar form ikut termuat ulang saat sesi
  // berubah di server; resetKey (nonce) memuat ulang mode create tiap buka.
  return (
    <InterviewSessionDialogInner
      key={
        interview
          ? `edit-${interview.id}-${interview.updatedAt}`
          : `create-${create?.applicationId ?? "new"}-${resetKey ?? 0}`
      }
      {...props}
    />
  );
}

function InterviewSessionDialogInner({
  open,
  onOpenChange,
  create,
  interview,
  position,
  onSaved,
  onDeleted,
}: Props) {
  const { canMutate, reportError } = useAdminSession();

  const isCreate = !interview;
  const pos = position;

  // ---- Form jadwal ----
  const [mode, setMode] = useState<InterviewMode>(
    interview?.mode ?? pos?.interviewMode ?? "ONLINE"
  );
  const [platform, setPlatform] = useState<InterviewPlatform>(
    interview?.platform ?? pos?.interviewPlatform ?? "GOOGLE_MEET"
  );
  const [scheduledAtLocal, setScheduledAtLocal] = useState(
    interview ? isoToLocalInput(interview.scheduledAt) : ""
  );
  const [durationMin, setDurationMin] = useState(
    String(interview?.durationMin ?? pos?.interviewDuration ?? 45)
  );
  const [meetingLink, setMeetingLink] = useState(interview?.meetingLink ?? "");
  const [address, setAddress] = useState(interview?.address ?? "");
  const [interviewers, setInterviewers] = useState<string[]>(
    interview ? [...interview.interviewers] : []
  );
  const [interviewerInput, setInterviewerInput] = useState("");
  const [saving, setSaving] = useState(false);

  // ---- Scorecard hasil ----
  const [scoreValues, setScoreValues] = useState<Record<string, number>>(
    interview?.scores ? { ...interview.scores } : {}
  );
  const [recommendation, setRecommendation] = useState<InterviewRecommendation | "">(
    interview?.recommendation ?? ""
  );
  const [notes, setNotes] = useState(interview?.notes ?? "");
  const [recordingUrl, setRecordingUrl] = useState(interview?.recordingUrl ?? "");
  const [savingResult, setSavingResult] = useState(false);

  // ---- Autosave scorecard (debounce 1,2 detik, hanya skor rubrik) ----
  const [autosaveState, setAutosaveState] = useState<"idle" | "saving" | "saved">("idle");
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveHideRef = useRef<number | null>(null);

  // ---- Rekaman & transkrip AI ----
  const [recordingFileUrl, setRecordingFileUrl] = useState<string | null>(
    interview?.recordingUrl?.startsWith("/api/files/") ? interview.recordingUrl : null
  );
  const [transcript, setTranscript] = useState<string | null>(interview?.transcript ?? null);
  const [transcriptSummary, setTranscriptSummary] = useState<string | null>(
    interview?.transcriptSummary ?? null
  );
  const [uploadingRecording, setUploadingRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // ---- Rencana ronde berikutnya (Position.roundPlan) ----
  const [roundPlan, setRoundPlan] = useState<RoundPlanTemplate[] | null>(null);
  const [schedulingNextRound, setSchedulingNextRound] = useState<RoundPlanTemplate | null>(null);

  // ---- Aksi status & hapus ----
  const [statusWorking, setStatusWorking] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const criteria =
    pos && pos.interviewCriteria.length > 0
      ? pos.interviewCriteria
      : DEFAULT_INTERVIEW_CRITERIA;

  const applicantName = interview?.applicationName ?? create?.applicationName ?? "-";
  const positionTitle =
    interview?.positionTitle ?? create?.positionTitle ?? pos?.title ?? null;
  const trackingCode = interview?.trackingCode;

  const showLinkField = mode === "ONLINE";
  const showAddressField = mode === "ONSITE";

  /* ----------------- Efek: rencana ronde & transkrip tersimpan ----------------- */

  // Muat rencana ronde posisi (untuk tombol "Jadwalkan Ronde Berikutnya").
  // Serialisasi posisi standar tidak menyertakan roundPlan, jadi diambil dari
  // endpoint khusus GET /api/admin/interviews/round-plan.
  useEffect(() => {
    if (!interview || !position || !canMutate) return;
    let cancelled = false;
    apiGet<{ roundPlan: RoundPlanTemplate[] }>(
      `/api/admin/interviews/round-plan?positionId=${encodeURIComponent(position.id)}`
    )
      .then((res) => {
        if (!cancelled) setRoundPlan(res.roundPlan);
      })
      .catch(() => {
        if (!cancelled) setRoundPlan([]);
      });
    return () => {
      cancelled = true;
    };
  }, [interview, position, canMutate]);

  // Muat transkrip/ringkasan tersimpan bila rekamannya file lokal (serialisasi
  // daftar tidak menyertakan kolom transcript).
  useEffect(() => {
    if (!interview || !interview.recordingUrl?.startsWith("/api/files/")) return;
    let cancelled = false;
    apiGet<{ ok: boolean; transcript: string | null; transcriptSummary: string | null }>(
      `/api/admin/interviews/${interview.id}/transcribe`
    )
      .then((res) => {
        if (cancelled) return;
        setTranscript(res.transcript);
        setTranscriptSummary(res.transcriptSummary);
      })
      .catch(() => {
        // Pelengkap — panel tetap tampil tanpa transkrip.
      });
    return () => {
      cancelled = true;
    };
  }, [interview]);

  // Bersihkan timer autosave saat dialog ditutup/unmount.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      if (autosaveHideRef.current) {
        window.clearTimeout(autosaveHideRef.current);
        autosaveHideRef.current = null;
      }
    };
  }, []);

  // Template ronde berikutnya: ronde = sesi saat ini + 1 (hanya mode edit).
  const nextRoundTemplate =
    interview && roundPlan
      ? roundPlan.find((r) => r.round === interview.round + 1) ?? null
      : null;

  /* ------------------------- Pratinjau pesan undangan ------------------------ */

  const invitePreview = (() => {
    const template = pos?.interviewInviteTemplate;
    if (!template) return null;
    const iso = localInputToIso(scheduledAtLocal);
    const d = iso ? new Date(iso) : null;
    const tanggal = d
      ? d.toLocaleDateString("id-ID", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "(tanggal belum diisi)";
    const jam = d
      ? d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
      : "(jam belum diisi)";
    return fillTemplateManual(template, {
      nama: applicantName,
      posisi: positionTitle ?? "-",
      tanggal,
      jam,
      link: showLinkField ? meetingLink.trim() || "(link belum diisi)" : "(tatap muka)",
      mode: INTERVIEW_MODE_LABELS[mode],
    });
  })();

  /* ------------------------------- Pewawancara ------------------------------- */

  function addInterviewer() {
    const name = interviewerInput.trim();
    if (!name) return;
    if (interviewers.length >= 6) {
      toast.error("Maksimal 6 pewawancara.");
      return;
    }
    if (interviewers.includes(name)) {
      toast.error("Nama pewawancara sudah ditambahkan.");
      return;
    }
    setInterviewers((prev) => [...prev, name]);
    setInterviewerInput("");
  }

  function removeInterviewer(name: string) {
    setInterviewers((prev) => prev.filter((n) => n !== name));
  }

  function handleInterviewerKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      addInterviewer();
    }
  }

  /* ------------------------------ Validasi form ------------------------------ */

  function buildSchedulePayload(): Record<string, unknown> | null {
    const iso = localInputToIso(scheduledAtLocal);
    if (!iso) {
      toast.error("Pilih tanggal dan jam wawancara terlebih dahulu.");
      return null;
    }
    const duration = Number(durationMin);
    if (!Number.isInteger(duration) || duration < 10 || duration > 480) {
      toast.error("Durasi harus angka bulat 10-480 menit.");
      return null;
    }
    if (showLinkField && !/^https?:\/\//i.test(meetingLink.trim())) {
      toast.error("Link meeting harus diawali http:// atau https://.");
      return null;
    }
    if (showAddressField && !address.trim()) {
      toast.error("Alamat wajib diisi untuk wawancara onsite.");
      return null;
    }
    return {
      scheduledAt: iso,
      mode,
      platform,
      durationMin: duration,
      meetingLink: showLinkField ? meetingLink.trim() : undefined,
      address: showAddressField ? address.trim() : undefined,
      interviewers,
    };
  }

  /* --------------------------------- Aksi API -------------------------------- */

  async function handleCreate() {
    if (saving || !create) return;
    const payload = buildSchedulePayload();
    if (!payload) return;
    setSaving(true);
    try {
      const created = await apiPost<Interview>("/api/admin/interviews", {
        ...payload,
        applicationId: create.applicationId,
      });
      toast.success(`Wawancara ronde ${created.round} dijadwalkan`);
      onSaved(created);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handlePatch(
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<Interview | null> {
    if (!interview) return null;
    try {
      const res = await apiPatch<{ interview: Interview; application?: Application }>(
        `/api/admin/interviews/${interview.id}`,
        body
      );
      toast.success(successMessage);
      onSaved(res.interview, res.application);
      return res.interview;
    } catch (err) {
      reportError(err);
      return null;
    }
  }

  async function handleSaveForm() {
    if (saving || !interview) return;
    const payload = buildSchedulePayload();
    if (!payload) return;
    // scheduledAt hanya dikirim bila berubah (mengubah jadwal me-reset status).
    if (payload.scheduledAt === new Date(interview.scheduledAt).toISOString()) {
      delete payload.scheduledAt;
    }
    if (Object.keys(payload).length === 0) {
      toast.info("Tidak ada perubahan jadwal yang dikirim.");
      return;
    }
    setSaving(true);
    await handlePatch(payload, "Perubahan jadwal disimpan");
    setSaving(false);
  }

  async function handleStatus(status: InterviewStatus, message: string) {
    if (statusWorking) return;
    setStatusWorking(true);
    await handlePatch({ status }, message);
    setStatusWorking(false);
  }

  async function handleSaveResult() {
    if (savingResult || !interview) return;
    const scores = buildScoresPayload();
    // recordingUrl dari file lokal (/api/files/...) dikelola route upload — tidak
    // dikirim lewat PATCH agar tidak ditolak validasi http.
    const isLocalRecording = recordingUrl.trim().startsWith("/api/files/");
    const recordingChanged =
      !isLocalRecording && recordingUrl.trim() !== (interview.recordingUrl ?? "");
    setSavingResult(true);
    await handlePatch(
      {
        scores,
        recommendation: recommendation || null,
        notes: notes.trim() || null,
        ...(recordingChanged ? { recordingUrl: recordingUrl.trim() || null } : {}),
      },
      "Hasil wawancara disimpan"
    );
    // Simpan manual menggantikan autosave — hentikan timer yang tertunda.
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    setAutosaveState("idle");
    setSavingResult(false);
  }

  /* ------------------- Autosave scorecard (debounce 1,2 dtk) ------------------- */

  function buildScoresPayload(): Record<string, number> {
    const scores: Record<string, number> = {};
    for (const c of criteria) {
      const v = scoreValues[c];
      if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) {
        scores[c] = v;
      }
    }
    return scores;
  }

  /** Setiap perubahan skor rubrik menjadwalkan PATCH skor otomatis (debounce 1,2 detik). */
  function handleScoreSelect(criterion: string, value: number) {
    setScoreValues((prev) => ({ ...prev, [criterion]: value }));
    if (!interview || !canMutate) return;
    if (autosaveHideRef.current) {
      window.clearTimeout(autosaveHideRef.current);
      autosaveHideRef.current = null;
    }
    setAutosaveState("saving");
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      void autosaveScoresNow();
    }, 1200);
  }

  async function autosaveScoresNow() {
    if (!interview || savingResult) return;
    try {
      await apiPatch<{ interview: Interview }>(
        `/api/admin/interviews/${interview.id}`,
        { scores: buildScoresPayload() }
      );
      // Tidak memanggil onSaved — hindari remount dialog (state transkrip/unggahan
      // tetap utuh); daftar sesi di parent diperbarui via event realtime.
      setAutosaveState("saved");
      if (autosaveHideRef.current) window.clearTimeout(autosaveHideRef.current);
      autosaveHideRef.current = window.setTimeout(() => {
        autosaveHideRef.current = null;
        setAutosaveState("idle");
      }, 4000);
    } catch (err) {
      setAutosaveState("idle");
      reportError(err);
    }
  }

  /* ------------------- Rencana ronde berikutnya (roundPlan) ------------------- */

  function startNextRound() {
    if (!nextRoundTemplate) return;
    setSchedulingNextRound(nextRoundTemplate);
    setMode(nextRoundTemplate.mode ?? pos?.interviewMode ?? "ONLINE");
    setPlatform(nextRoundTemplate.platform ?? pos?.interviewPlatform ?? "GOOGLE_MEET");
    setDurationMin(String(nextRoundTemplate.durationMin ?? pos?.interviewDuration ?? 45));
    setInterviewers(nextRoundTemplate.interviewers ? [...nextRoundTemplate.interviewers] : []);
    setScheduledAtLocal("");
    toast.info(
      `Formulir diisi dari rencana "${nextRoundTemplate.name}" — pilih tanggal & jam lalu simpan.`
    );
  }

  function cancelNextRound() {
    setSchedulingNextRound(null);
    if (!interview) return;
    // Kembalikan form ke nilai sesi saat ini.
    setMode(interview.mode);
    setPlatform(interview.platform);
    setDurationMin(String(interview.durationMin));
    setInterviewers([...interview.interviewers]);
    setScheduledAtLocal(isoToLocalInput(interview.scheduledAt));
  }

  async function handleCreateNextRound() {
    if (saving || !interview || !schedulingNextRound) return;
    const payload = buildSchedulePayload();
    if (!payload) return;
    setSaving(true);
    try {
      const created = await apiPost<Interview>("/api/admin/interviews", {
        ...payload,
        applicationId: interview.applicationId,
      });
      toast.success(
        `Ronde ${created.round} (${schedulingNextRound.name}) dijadwalkan`
      );
      setSchedulingNextRound(null);
      onSaved(created);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  /* --------------------- Rekaman & transkrip AI (hasil) --------------------- */

  const RECORDING_MAX_BYTES = 25 * 1024 * 1024; // 25 MB

  async function handleRecordingUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = ""; // reset agar file yang sama bisa dipilih ulang
    if (!file || !interview) return;
    if (file.size > RECORDING_MAX_BYTES) {
      toast.error("Ukuran file maksimal 25 MB.");
      return;
    }
    setUploadingRecording(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/admin/interviews/${interview.id}/recording`, {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: unknown; recordingUrl?: unknown; error?: unknown }
        | null;
      if (!res.ok || !data || data.ok !== true || typeof data.recordingUrl !== "string") {
        const msg = typeof data?.error === "string" && data.error ? data.error : "Gagal mengunggah rekaman.";
        toast.error(msg);
        return;
      }
      const url = data.recordingUrl;
      setRecordingFileUrl(url);
      setRecordingUrl(url); // tampil di kolom URL rekaman (tanpa dikirim ulang saat simpan)
      toast.success("Rekaman terunggah — siap ditranskripsi");
    } catch {
      toast.error("Gagal mengunggah rekaman. Coba lagi nanti.");
    } finally {
      setUploadingRecording(false);
    }
  }

  async function handleTranscribe() {
    if (transcribing || !interview || !recordingFileUrl) return;
    setTranscribing(true);
    toast.info("Transkripsi berjalan — proses bisa memakan waktu beberapa menit.");
    try {
      const res = await apiPost<{
        ok: boolean;
        transcript: string | null;
        transcriptSummary: string | null;
      }>(`/api/admin/interviews/${interview.id}/transcribe`);
      setTranscript(res.transcript);
      setTranscriptSummary(res.transcriptSummary);
      toast.success("Transkrip & ringkasan AI siap");
    } catch (err) {
      reportError(err);
    } finally {
      setTranscribing(false);
    }
  }

  async function handleDelete() {
    if (deleting || !interview) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/interviews/${interview.id}`);
      toast.success("Sesi wawancara dihapus");
      onDeleted?.(interview.id);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  function handleCopyInvite(text: string) {
    void copyText(text).then((ok) => {
      if (ok) toast.success("Pesan undangan disalin ke clipboard");
      else toast.error("Gagal menyalin ke clipboard");
    });
  }

  /* --------------------------------- Render --------------------------------- */

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6 text-lg font-bold">
            {isCreate ? "Jadwalkan Wawancara" : `Detail Wawancara Ronde ${interview?.round ?? 1}`}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <span>{applicantName}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate text-muted-foreground">
              {positionTitle ?? "Tanpa posisi"}
            </span>
            {!isCreate && interview ? (
              <InterviewStatusChip status={interview.status} className="ml-1" />
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 max-h-[72vh] overflow-y-auto pr-2 nice-scrollbar">
          <div className="flex flex-col gap-4">
            {/* Info sesi (mode edit/detail) */}
            {!isCreate && interview ? (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    {interview.mode === "ONLINE" ? (
                      <Video className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    ) : (
                      <MapPin className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    )}
                    {INTERVIEW_MODE_LABELS[interview.mode]} ·{" "}
                    {INTERVIEW_PLATFORM_LABELS[interview.platform]}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateTime(interview.scheduledAt)} · {interview.durationMin} menit
                  </span>
                </div>
                {interview.mode === "ONSITE" && interview.address ? (
                  <p className="text-sm text-muted-foreground">
                    Alamat: <span className="text-foreground">{interview.address}</span>
                  </p>
                ) : null}
                {interview.interviewers.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Users className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    {interview.interviewers.map((n) => (
                      <Badge key={n} variant="secondary" className="font-normal">
                        {n}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {interview.status === "RESCHEDULE_REQUESTED" ? (
                  <div className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-2.5 text-xs text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-400">
                    <MessageSquareWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      Pelamar mengajukan ubah jadwal
                      {interview.rescheduleProposedAt
                        ? ` ke ${formatDateTime(interview.rescheduleProposedAt)}`
                        : ""}
                      {interview.rescheduleReason ? ` — "${interview.rescheduleReason}"` : ""}
                      . Proses usulan dari panel Permintaan Ubah Jadwal.
                    </span>
                  </div>
                ) : null}

                {/* Aksi cepat */}
                <div className="flex flex-wrap items-center gap-2">
                  {interview.mode === "ONLINE" && interview.meetingLink ? (
                    <Button asChild size="sm" className="h-11 sm:h-9">
                      <a
                        href={interview.meetingLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Gabung meeting online"
                      >
                        <Video className="size-4" aria-hidden="true" />
                        Gabung Meeting
                      </a>
                    </Button>
                  ) : null}
                  {trackingCode ? (
                    <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                      <a
                        href={`/api/public/interview/ics?code=${encodeURIComponent(trackingCode)}&id=${encodeURIComponent(interview.id)}`}
                        download
                        aria-label="Unduh file kalender (.ics)"
                      >
                        <Download className="size-4" aria-hidden="true" />
                        Unduh .ics
                      </a>
                    </Button>
                  ) : null}
                  <Button asChild variant="outline" size="sm" className="h-11 sm:h-9">
                    <a
                      href={googleCalendarUrl(interview)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="Tambahkan ke Google Calendar"
                    >
                      <CalendarPlus className="size-4" aria-hidden="true" />
                      Google Calendar
                    </a>
                  </Button>
                </div>
              </div>
            ) : null}

            <Separator />

            {/* Form jadwal (create & edit) */}
            <div className="flex flex-col gap-3">
              {schedulingNextRound ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    Formulir terisi dari rencana ronde{" "}
                    <strong>
                      {schedulingNextRound.round}: {schedulingNextRound.name}
                    </strong>{" "}
                    — pilih tanggal &amp; jam, lalu simpan.
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={cancelNextRound}
                    disabled={saving}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                    Batal
                  </Button>
                </div>
              ) : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>Mode</Label>
                  <Select
                    value={mode}
                    onValueChange={(v) => setMode(v as InterviewMode)}
                    disabled={!canMutate}
                  >
                    <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Mode wawancara">
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
                  <Label>Platform</Label>
                  <Select
                    value={platform}
                    onValueChange={(v) => setPlatform(v as InterviewPlatform)}
                    disabled={!canMutate}
                  >
                    <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Platform wawancara">
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

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="iv-scheduledAt">Tanggal &amp; Jam</Label>
                  <Input
                    id="iv-scheduledAt"
                    type="datetime-local"
                    value={scheduledAtLocal}
                    onChange={(e) => setScheduledAtLocal(e.target.value)}
                    disabled={!canMutate}
                    className="h-11 sm:h-10"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="iv-duration">Durasi (menit)</Label>
                  <Input
                    id="iv-duration"
                    type="number"
                    min={10}
                    max={480}
                    step={5}
                    value={durationMin}
                    onChange={(e) => setDurationMin(e.target.value)}
                    disabled={!canMutate}
                    className="h-11 sm:h-10"
                  />
                </div>
              </div>

              {showLinkField ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="iv-meetingLink">Link Meeting</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="iv-meetingLink"
                      type="url"
                      value={meetingLink}
                      onChange={(e) => setMeetingLink(e.target.value)}
                      placeholder="https://meet.google.com/xxx-xxxx-xxx"
                      disabled={!canMutate}
                      className="h-11 min-w-0 flex-1 sm:h-10"
                    />
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-11 shrink-0 sm:h-10"
                    >
                      <a
                        href="https://meet.google.com/new"
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Buka meet.google.com/new untuk membuat room baru"
                        title="Buka meet.google.com/new"
                      >
                        <ExternalLink className="size-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Buka meet.google.com/new</span>
                        <span className="sm:hidden">Room Baru</span>
                      </a>
                    </Button>
                  </div>
                </div>
              ) : null}

              {showAddressField ? (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="iv-address">Alamat Lokasi</Label>
                  <Input
                    id="iv-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="mis. Jl. Sudirman No. 10, Jakarta"
                    disabled={!canMutate}
                    className="h-11 sm:h-10"
                  />
                </div>
              ) : null}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="iv-interviewer">Pewawancara</Label>
                {interviewers.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {interviewers.map((n) => (
                      <span
                        key={n}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                      >
                        {n}
                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => removeInterviewer(n)}
                            aria-label={`Hapus pewawancara ${n}`}
                            className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            disabled={saving}
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Belum ada pewawancara (opsional, maks 6).
                  </p>
                )}
                {canMutate && interviewers.length < 6 ? (
                  <form
                    onSubmit={(e: FormEvent) => {
                      e.preventDefault();
                      addInterviewer();
                    }}
                  >
                    <Input
                      id="iv-interviewer"
                      value={interviewerInput}
                      onChange={(e) => setInterviewerInput(e.target.value)}
                      onKeyDown={handleInterviewerKeyDown}
                      placeholder="Nama pewawancara, tekan Enter untuk menambah"
                      className="h-11 sm:h-10"
                      maxLength={60}
                    />
                  </form>
                ) : null}
              </div>

              {canMutate ? (
                <Button
                  className="h-11 w-fit active:scale-[0.99] sm:h-10"
                  onClick={() =>
                    void (isCreate
                      ? handleCreate()
                      : schedulingNextRound
                        ? handleCreateNextRound()
                        : handleSaveForm())
                  }
                  disabled={saving || statusWorking || deleting || savingResult}
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Menyimpan...
                    </>
                  ) : schedulingNextRound ? (
                    `Jadwalkan Ronde ${schedulingNextRound.round}`
                  ) : isCreate ? (
                    "Jadwalkan"
                  ) : (
                    "Simpan Jadwal"
                  )}
                </Button>
              ) : null}
            </div>

            {/* Pratinjau pesan undangan */}
            {invitePreview ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Pratinjau Pesan Undangan</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-8"
                    onClick={() => handleCopyInvite(invitePreview)}
                    aria-label="Salin pesan undangan"
                  >
                    <Copy className="size-4" aria-hidden="true" />
                    Salin
                  </Button>
                </div>
                <p className="rounded-lg bg-muted/60 p-3 text-sm whitespace-pre-wrap">
                  {invitePreview}
                </p>
              </div>
            ) : null}

            {/* Scorecard (mode edit/detail, bisa mengubah) */}
            {!isCreate && interview && canMutate ? (
              <>
                <Separator />
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <ClipboardCheck className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                    <p className="text-sm font-semibold">Scorecard Hasil Wawancara</p>
                    {autosaveState !== "idle" ? (
                      <span
                        role="status"
                        className={cn(
                          "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                          autosaveState === "saved"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {autosaveState === "saved" ? (
                          <>
                            <Check className="size-3" aria-hidden="true" />
                            Tersimpan otomatis
                          </>
                        ) : (
                          <>
                            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                            Menyimpan...
                          </>
                        )}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-3">
                    {criteria.map((criterion) => {
                      const value = scoreValues[criterion];
                      return (
                        <div key={criterion} className="flex flex-col gap-1.5">
                          <p className="text-xs font-medium text-muted-foreground">
                            {criterion}
                          </p>
                          <div
                            className="flex flex-wrap items-center gap-1.5"
                            role="group"
                            aria-label={`Nilai scorecard ${criterion}`}
                          >
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                disabled={savingResult}
                                onClick={() => handleScoreSelect(criterion, n)}
                                aria-label={`${criterion}: nilai ${n} dari 5`}
                                aria-pressed={value === n}
                                className={cn(
                                  "flex size-11 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 sm:size-9",
                                  value === n
                                    ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700"
                                    : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                                )}
                              >
                                {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="iv-notes">Catatan Wawancara</Label>
                    <Textarea
                      id="iv-notes"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ringkasan jawaban, kesan, dan hal yang perlu ditindaklanjuti..."
                      rows={3}
                      maxLength={2000}
                      disabled={savingResult}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="iv-recording">URL Rekaman (opsional)</Label>
                    <Input
                      id="iv-recording"
                      type="url"
                      value={recordingUrl}
                      onChange={(e) => setRecordingUrl(e.target.value)}
                      placeholder="https://drive.google.com/..."
                      maxLength={500}
                      disabled={savingResult}
                      className="h-11 sm:h-10"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Rekomendasi</Label>
                    <Select
                      value={recommendation || "none-rec"}
                      onValueChange={(v) =>
                        setRecommendation(v === "none-rec" ? "" : (v as InterviewRecommendation))
                      }
                      disabled={savingResult}
                    >
                      <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Rekomendasi hasil wawancara">
                        <SelectValue placeholder="Pilih rekomendasi" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none-rec">-</SelectItem>
                        {(Object.keys(INTERVIEW_RECOMMENDATION_LABELS) as InterviewRecommendation[]).map(
                          (r) => (
                            <SelectItem key={r} value={r}>
                              {INTERVIEW_RECOMMENDATION_LABELS[r]}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                    {recommendation === "TOLAK" ? (
                      <p className="text-xs text-rose-600 dark:text-rose-400">
                        Menyimpan dengan rekomendasi Tolak otomatis menolak lamaran ini.
                      </p>
                    ) : null}
                    {recommendation === "CADANGAN" ? (
                      <p className="text-xs text-muted-foreground">
                        Kandidat otomatis masuk Talent Pool.
                      </p>
                    ) : null}
                  </div>

                  <Button
                    className="h-11 w-fit active:scale-[0.99] sm:h-10"
                    onClick={() => void handleSaveResult()}
                    disabled={saving || savingResult || statusWorking || deleting}
                  >
                    {savingResult ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Menyimpan...
                      </>
                    ) : (
                      "Simpan Hasil"
                    )}
                  </Button>
                </div>

                <Separator />

                {/* Aksi status & hapus */}
                <div className="flex flex-wrap items-center gap-2">
                  {interview.status !== "CONFIRMED" &&
                  interview.status !== "COMPLETED" &&
                  interview.status !== "CANCELLED" &&
                  interview.status !== "NO_SHOW" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700 sm:h-9 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      onClick={() => void handleStatus("CONFIRMED", "Kehadiran dikonfirmasi")}
                      disabled={statusWorking}
                    >
                      {statusWorking ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      Konfirmasi
                    </Button>
                  ) : null}
                  {interview.status !== "NO_SHOW" &&
                  interview.status !== "COMPLETED" &&
                  interview.status !== "CANCELLED" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 sm:h-9"
                      onClick={() => void handleStatus("NO_SHOW", "Ditandai tidak hadir")}
                      disabled={statusWorking}
                    >
                      Tandai Tidak Hadir
                    </Button>
                  ) : null}
                  {interview.status !== "CANCELLED" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 sm:h-9"
                      onClick={() => void handleStatus("CANCELLED", "Wawancara dibatalkan")}
                      disabled={statusWorking}
                    >
                      Batalkan
                    </Button>
                  ) : null}
                  <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="ml-auto h-11 sm:h-9"
                      onClick={() => setDeleteOpen(true)}
                      disabled={deleting}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Hapus
                    </Button>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Hapus sesi wawancara ini?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Ronde {interview.round} beserta scorecard-nya akan dihapus
                          permanen. Tindakan tidak bisa dibatalkan.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={(e) => {
                            e.preventDefault();
                            void handleDelete();
                          }}
                          className="bg-rose-600 text-white hover:bg-rose-700"
                          disabled={deleting}
                        >
                          {deleting ? (
                            <>
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                              Menghapus...
                            </>
                          ) : (
                            "Ya, Hapus"
                          )}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
