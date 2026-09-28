"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  BadgeCheck,
  BadgeX,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  Search,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import {
  INTERVIEW_STATUS_LABELS,
  STATUS_FLOW,
  type InterviewPlatform,
  type InterviewStatus,
  type StageKey,
  type TrackResponse,
} from "@/lib/types";
import { stageLabel } from "@/lib/stages";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLang } from "@/components/landing/lang-context";
import { Container, FadeIn, ROSE_BADGE } from "@/components/landing/primitives";
import {
  fillTemplate,
  formatDateTimeId,
  formatDateId,
  safeExternalUrl,
} from "@/components/landing/landing-utils";
import { useLiveEvent } from "@/lib/live-client";

// Debounce recheck realtime — endpoint track bisa punya rate-limit (min. 1 detik).
const LIVE_RECHECK_DEBOUNCE_MS = 1000;
// Jeda recheck setelah aksi sukses (konfirmasi/unggah/jawab offer) agar
// tidak menabrak rate-limit endpoint track.
const ACTION_RECHECK_DELAY_MS = 1100;

const DAY_MS = 86_400_000;

type StepView = { key: string; label: string; done: boolean; at: string | null };

// Label platform wawancara (nama proper — tidak diterjemahkan).
const PLATFORM_LABELS: Record<InterviewPlatform, string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  WHATSAPP: "WhatsApp Call",
  TELEPON: "Telepon",
  LAINNYA: "Lainnya",
};

// Badge status sesi wawancara — gaya border+bg-50/950 seperti box existing.
const INTERVIEW_BADGE_CLASS: Record<InterviewStatus, string> = {
  SCHEDULED:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  CONFIRMED:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  RESCHEDULE_REQUESTED:
    "border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300",
  COMPLETED:
    "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-300",
  NO_SHOW:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
  CANCELLED:
    "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-400",
};

/** Stempel UTC format Google Calendar: YYYYMMDDTHHMMSSZ. */
function toGcalStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * URL "Tambahkan ke Google Calendar" (action=TEMPLATE).
 * `dates` memakai UTC dari scheduledAt sampai +durationMin; semua parameter di-encode.
 */
function buildGoogleCalendarUrl(opts: {
  title: string;
  startIso: string;
  durationMin: number;
  details: string;
  location: string;
}): string {
  const start = new Date(opts.startIso);
  if (Number.isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + opts.durationMin * 60_000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${toGcalStamp(start)}/${toGcalStamp(end)}`,
    details: opts.details,
    location: opts.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Baris detail "Label: nilai" untuk kartu wawancara/penawaran. */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

/** Tahap terminal bawaan (label tahap kustom bisa apa saja — tak dianggap final). */
function isFinalStatus(status?: StageKey): boolean {
  return status === "ACCEPTED" || status === "REJECTED";
}

export function StatusCheckSection() {
  const { t } = useLang();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Kode yang sedang dilacak (aktif di state) — dipakai untuk recheck realtime.
  const [trackedCode, setTrackedCode] = useState("");
  const recheckTimerRef = useRef<number | null>(null);

  // Aksi sesi wawancara: loading per (interviewId:action) + form ubah jadwal.
  const [interviewBusy, setInterviewBusy] = useState<string | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<string | null>(null);
  const [proposedAt, setProposedAt] = useState("");
  const [rescheduleReason, setRescheduleReason] = useState("");
  // Aksi penawaran: ACCEPT (lewat dialog konfirmasi) / DECLINE (form alasan).
  const [offerBusy, setOfferBusy] = useState<"ACCEPT" | "DECLINE" | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  // Unggah dokumen onboarding: loading per docId.
  const [uploadingDocId, setUploadingDocId] = useState<string | null>(null);
  // Slot jadwal self-service: loading per slotId saat memilih.
  const [bookingSlotId, setBookingSlotId] = useState<string | null>(null);

  async function handleTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    // Batalkan recheck realtime yang tertunda — pelacakan manual sedang berjalan.
    if (recheckTimerRef.current) {
      window.clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
    setTrackedCode(trimmed);
    setLoading(true);
    try {
      const res = await fetch("/api/public/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as TrackResponse | null;
      if (!res.ok || !data) {
        toast.error(t.apply.errors.submitFailed);
        return;
      }
      if (!data.found) {
        setResult(null);
        setNotFound(true);
        return;
      }
      setResult(data);
      setNotFound(false);
    } catch {
      toast.error(t.apply.errors.submitFailed);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pengecekan ulang SENYAP saat broadcast realtime masuk atau setelah aksi pelamar:
   * tanpa spinner, data lama tetap tampil, dan state hanya di-swap bila isi
   * benar-benar berubah (anti-flicker). Kegagalan jaringan diabaikan diam.
   */
  async function recheckSilently(codeValue: string) {
    try {
      const res = await fetch("/api/public/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeValue }),
      });
      if (!res.ok) return; // gagal senyap — pertahankan hasil terakhir
      const data = (await res.json().catch(() => null)) as TrackResponse | null;
      if (!data || !data.found) return; // lamaran tak ditemukan lagi — biarkan tampilan lama
      setResult((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
      setNotFound(false);
    } catch {
      // senyap
    }
  }

  /**
   * Jadwalkan recheck senyap dengan SATU timer debounce bersama — dipakai
   * event realtime (applications:changed & interviews:changed) maupun
   * recheck manual setelah aksi pelamar, agar tidak menabrak rate-limit.
   */
  function scheduleSilentRecheck(delayMs = LIVE_RECHECK_DEBOUNCE_MS) {
    if (!trackedCode) return;
    if (recheckTimerRef.current) window.clearTimeout(recheckTimerRef.current);
    recheckTimerRef.current = window.setTimeout(() => {
      recheckTimerRef.current = null;
      void recheckSilently(trackedCode);
    }, delayMs);
  }

  // Realtime: lamaran ATAU sesi wawancara berubah di admin -> recheck senyap.
  useLiveEvent("applications:changed", () => {
    scheduleSilentRecheck();
  });
  useLiveEvent("interviews:changed", () => {
    scheduleSilentRecheck();
  });

  // Bersihkan timer recheck saat komponen dilepas.
  useEffect(() => {
    return () => {
      if (recheckTimerRef.current) window.clearTimeout(recheckTimerRef.current);
    };
  }, []);

  /**
   * Kirim perintah ke endpoint aksi publik (interview/offer) tanpa melempar.
   * 429 (rate-limit 1 req/detik per kode) memakai pesan sopan dari strings.
   */
  async function postAction(
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; error: string }> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown }
        | null;
      if (res.status === 429) return { ok: false, error: t.status.rateLimited };
      if (!res.ok || !data || data.ok !== true) {
        const serverError =
          typeof data?.error === "string" && data.error ? data.error : null;
        return { ok: false, error: serverError ?? t.status.actionFailed };
      }
      return { ok: true, error: "" };
    } catch {
      return { ok: false, error: t.status.actionFailed };
    }
  }

  function isInterviewBusy(interviewId: string, action: string): boolean {
    return interviewBusy === `${interviewId}:${action}`;
  }

  /** CONFIRM / RESCHEDULE / CANCEL_REQUEST satu sesi wawancara. */
  async function respondInterview(
    interviewId: string,
    action: "CONFIRM" | "RESCHEDULE" | "CANCEL_REQUEST",
    extra?: { proposedAt?: string; reason?: string },
  ) {
    setInterviewBusy(`${interviewId}:${action}`);
    const out = await postAction("/api/public/interview/respond", {
      code: trackedCode,
      interviewId,
      action,
      ...(extra ?? {}),
    });
    setInterviewBusy(null);
    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    if (action === "CONFIRM") toast.success(t.status.interview.confirmToast);
    else if (action === "RESCHEDULE") toast.success(t.status.interview.rescheduleSent);
    else toast.success(t.status.interview.cancelRequestToast);
    setRescheduleFor(null);
    setProposedAt("");
    setRescheduleReason("");
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  function submitReschedule(interviewId: string) {
    if (!proposedAt) {
      toast.error(t.status.interview.proposedRequired);
      return;
    }
    const proposed = new Date(proposedAt);
    if (Number.isNaN(proposed.getTime())) {
      toast.error(t.status.interview.proposedRequired);
      return;
    }
    void respondInterview(interviewId, "RESCHEDULE", {
      proposedAt: proposed.toISOString(),
      ...(rescheduleReason.trim() ? { reason: rescheduleReason.trim() } : {}),
    });
  }

  async function acceptOffer() {
    setOfferBusy("ACCEPT");
    const out = await postAction("/api/public/offer/respond", {
      code: trackedCode,
      action: "ACCEPT",
    });
    setOfferBusy(null);
    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    toast.success(t.status.offer.acceptToast);
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  async function declineOffer() {
    setOfferBusy("DECLINE");
    const out = await postAction("/api/public/offer/respond", {
      code: trackedCode,
      action: "DECLINE",
      ...(declineReason.trim() ? { reason: declineReason.trim() } : {}),
    });
    setOfferBusy(null);
    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    toast.success(t.status.offer.declineToast);
    setDeclineOpen(false);
    setDeclineReason("");
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  /**
   * Pilih slot jadwal wawancara (self-service). Server yang memvalidasi slot masih
   * kosong; setelah sukses halaman di-recheck senyap agar kartu wawancara baru tampil.
   */
  async function bookSlot(slotId: string) {
    if (bookingSlotId) return;
    setBookingSlotId(slotId);
    const out = await postAction("/api/public/slots/book", {
      code: trackedCode,
      slotId,
    });
    setBookingSlotId(null);
    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    toast.success("Jadwal wawancara berhasil dipilih — detail tampil di daftar wawancara.");
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  /** Unggah dokumen onboarding (multipart) langsung saat file dipilih. */
  async function uploadOnboardingDoc(docId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = ""; // reset agar file yang sama bisa dipilih ulang
    if (!file) return;
    setUploadingDocId(docId);
    try {
      const fd = new FormData();
      fd.append("code", trackedCode);
      fd.append("docId", docId);
      fd.append("file", file);
      const res = await fetch("/api/public/onboarding/upload", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown }
        | null;
      if (res.status === 429) {
        toast.error(t.status.rateLimited);
        return;
      }
      if (!res.ok || !data || data.ok !== true) {
        const serverError =
          typeof data?.error === "string" && data.error ? data.error : null;
        toast.error(serverError ?? t.status.onboarding.uploadFailed);
        return;
      }
      toast.success(t.status.onboarding.uploadedToast);
      scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
    } catch {
      toast.error(t.status.onboarding.uploadFailed);
    } finally {
      setUploadingDocId(null);
    }
  }

  const steps: StepView[] = result
    ? (result.steps ??
      STATUS_FLOW.map((key) => ({
        key,
        label: stageLabel(key),
        done: false,
        at: null,
      })))
    : [];
  const finalStatus = isFinalStatus(result?.status) ? result?.status : undefined;
  const currentKey = !finalStatus ? result?.status : undefined;
  // URL brief tes posisi (disanitasi — hanya http/https).
  const assignmentUrl = result?.assignment?.url
    ? safeExternalUrl(result.assignment.url)
    : null;
  // Sesi wawancara terurut ronde: terbaru paling menonjol (paling atas).
  const interviews = result?.interviews
    ? [...result.interviews].sort((a, b) => b.round - a.round)
    : [];
  const offer = result?.offer ?? null;
  // Sisa hari jawaban penawaran (dihitung dari now, dibulatkan ke atas, min. 0).
  let offerDaysLeft: number | null = null;
  if (offer?.deadline) {
    const deadlineMs = new Date(offer.deadline).getTime();
    if (!Number.isNaN(deadlineMs)) {
      offerDaysLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / DAY_MS));
    }
  }
  const onboarding = result?.onboarding ?? null;
  const onboardingDocs = onboarding?.docs ?? [];
  const onboardingDoneCount = onboardingDocs.filter((doc) => doc.done).length;
  // Slot jadwal self-service (dari track API — hanya ada bila tahap belum final).
  const availableSlots = result?.slots ?? [];

  return (
    <section id="status" className="scroll-mt-24 bg-muted/40 py-16 md:py-24">
      <Container>
        <FadeIn className="mx-auto flex max-w-xl flex-col items-center text-center">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.status.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.status.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.status.desc}</p>

          <Card className="mt-8 w-full rounded-2xl p-6 text-left md:p-8">
            <form onSubmit={handleTrack} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="track-code">{t.status.codeLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    id="track-code"
                    name="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder={t.status.codePh}
                    className="h-11 flex-1 font-mono uppercase"
                    autoComplete="off"
                    maxLength={24}
                  />
                  <Button type="submit" className="h-11 min-w-24" disabled={loading || !code.trim()}>
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {t.status.tracking}
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" aria-hidden="true" />
                        {t.status.track}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>

            {notFound ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              >
                {t.status.notFound}
              </div>
            ) : null}

            {result && result.found ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="mt-6 flex flex-col gap-5"
                role="status"
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  {result.positionTitle ? (
                    <p>
                      <span className="text-muted-foreground">{t.status.positionLabel}: </span>
                      <span className="font-medium">{result.positionTitle}</span>
                    </p>
                  ) : null}
                  {result.submittedAt ? (
                    <p>
                      <span className="text-muted-foreground">{t.status.submittedLabel}: </span>
                      <span className="font-medium">{formatDateTimeId(result.submittedAt)}</span>
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.status.resultTitle}
                  </p>
                  <ol className="mt-4 space-y-0">
                    {steps.map((step, index) => {
                      const isLast = index === steps.length - 1;
                      const isCurrent = step.key === currentKey && !step.done;
                      return (
                        <li key={step.key} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            {step.done ? (
                              <CheckCircle2
                                className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400"
                                aria-hidden="true"
                              />
                            ) : isCurrent ? (
                              <span
                                className="relative flex h-6 w-6 shrink-0 items-center justify-center"
                                aria-hidden="true"
                              >
                                <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/30" />
                                <span className="relative h-3 w-3 rounded-full bg-rose-500" />
                              </span>
                            ) : (
                              <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center"
                                aria-hidden="true"
                              >
                                <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/40 bg-muted" />
                              </span>
                            )}
                            {!isLast ? (
                              <span
                                aria-hidden="true"
                                className={
                                  step.done
                                    ? "my-1 w-px flex-1 bg-emerald-500/50 dark:bg-emerald-400/50"
                                    : "my-1 w-px flex-1 bg-border"
                                }
                              />
                            ) : null}
                          </div>
                          <div className={isLast ? "pb-0" : "pb-5"}>
                            <p
                              className={
                                step.done || isCurrent
                                  ? "text-sm font-medium"
                                  : "text-sm text-muted-foreground"
                              }
                            >
                              {step.label || step.key}
                            </p>
                            {step.at ? (
                              <p className="text-xs text-muted-foreground">
                                {formatDateTimeId(step.at)}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* Info tes seleksi posisi (bila posisi punya assignment) */}
                {result.assignment &&
                (result.assignment.title || result.assignment.note || result.assignment.url) ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <div className="flex items-start gap-2.5">
                      <ClipboardList
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 text-sm">
                        <p className="font-medium text-amber-800 dark:text-amber-300">
                          {t.status.assignmentTitle}
                          {result.assignment.title ? `: ${result.assignment.title}` : ""}
                        </p>
                        {result.assignment.note ? (
                          <p className="mt-1 whitespace-pre-line leading-relaxed text-amber-700/90 dark:text-amber-200/80">
                            {result.assignment.note}
                          </p>
                        ) : null}
                        {assignmentUrl ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-11 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 sm:h-9 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
                            asChild
                          >
                            <a
                              href={assignmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4" aria-hidden="true" />
                              {t.status.openBrief}
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Jadwal wawancara — sesi aktif + riwayat, ronde terbaru paling menonjol */}
                {interviews.length > 0 ? (
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {t.status.interview.title}
                    </p>
                    <div className="mt-3 flex flex-col gap-3">
                      {interviews.map((interview) => {
                        const isOnline = interview.mode === "ONLINE";
                        const platformLabel = PLATFORM_LABELS[interview.platform];
                        const meetingUrl = interview.meetingLink
                          ? safeExternalUrl(interview.meetingLink)
                          : null;
                        const icsUrl = `/api/public/interview/ics?code=${encodeURIComponent(trackedCode)}&id=${encodeURIComponent(interview.id)}`;
                        const gcalUrl = buildGoogleCalendarUrl({
                          title: `${fillTemplate(t.status.interview.round, { n: interview.round })} — Lumina Studio`,
                          startIso: interview.scheduledAt,
                          durationMin: interview.durationMin,
                          details: [
                            result.positionTitle
                              ? `${t.status.positionLabel}: ${result.positionTitle}`
                              : null,
                            isOnline
                              ? `${t.status.interview.platformLabel}: ${platformLabel}`
                              : null,
                            interview.interviewers.length > 0
                              ? `${t.status.interview.interviewersLabel}: ${interview.interviewers.join(", ")}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join("\n"),
                          location: isOnline
                            ? (meetingUrl ?? platformLabel)
                            : (interview.address ?? "Lumina Studio"),
                        });
                        const canRespond =
                          interview.status === "SCHEDULED" ||
                          interview.status === "RESCHEDULE_REQUESTED";
                        const cardBusy = interviewBusy?.startsWith(`${interview.id}:`) ?? false;
                        const rescheduleOpen = rescheduleFor === interview.id;
                        return (
                          <div
                            key={interview.id}
                            className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-500/30 dark:bg-zinc-500/5"
                          >
                            <div className="flex flex-wrap items-center gap-2.5">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                                {isOnline ? (
                                  <Video className="h-4 w-4" aria-hidden="true" />
                                ) : (
                                  <MapPin className="h-4 w-4" aria-hidden="true" />
                                )}
                              </span>
                              <h4 className="text-sm font-semibold">
                                {fillTemplate(t.status.interview.round, { n: interview.round })}
                              </h4>
                              <Badge
                                variant="outline"
                                className={INTERVIEW_BADGE_CLASS[interview.status]}
                              >
                                {INTERVIEW_STATUS_LABELS[interview.status] ?? interview.status}
                              </Badge>
                            </div>

                            <div className="mt-3 grid gap-1.5">
                              <p className="text-sm">
                                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                                  {t.status.interview.whenLabel}:{" "}
                                </span>
                                <span className="font-medium">
                                  {formatDateTimeId(interview.scheduledAt)}
                                </span>
                              </p>
                              <DetailRow
                                label={t.status.interview.durationLabel}
                                value={fillTemplate(t.status.interview.durationValue, {
                                  n: interview.durationMin,
                                })}
                              />
                              {isOnline ? (
                                <DetailRow
                                  label={t.status.interview.platformLabel}
                                  value={platformLabel}
                                />
                              ) : null}
                              {interview.interviewers.length > 0 ? (
                                <DetailRow
                                  label={t.status.interview.interviewersLabel}
                                  value={interview.interviewers.join(", ")}
                                />
                              ) : null}
                              {!isOnline && interview.address ? (
                                <DetailRow
                                  label={t.status.interview.addressLabel}
                                  value={interview.address}
                                />
                              ) : null}
                            </div>

                            {/* Link meeting & kalender (hanya ONLINE dengan link valid) */}
                            {isOnline && meetingUrl ? (
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button size="sm" className="h-11 sm:h-9" asChild>
                                  <a
                                    href={meetingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={t.status.interview.joinAria}
                                  >
                                    <Video className="h-4 w-4" aria-hidden="true" />
                                    {t.status.interview.join}
                                  </a>
                                </Button>
                                <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                                  <a href={icsUrl} download>
                                    <Download className="h-4 w-4" aria-hidden="true" />
                                    {t.status.interview.saveCalendar}
                                  </a>
                                </Button>
                                {gcalUrl ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-11 sm:h-9"
                                    asChild
                                  >
                                    <a
                                      href={gcalUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      aria-label={t.status.interview.gcalAria}
                                    >
                                      <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                                      {t.status.interview.gcal}
                                    </a>
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}

                            {/* Aksi pelamar untuk sesi SCHEDULED / RESCHEDULE_REQUESTED */}
                            {canRespond ? (
                              <div className="mt-3 flex flex-col gap-2">
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    size="sm"
                                    className="h-11 sm:h-9"
                                    disabled={cardBusy}
                                    onClick={() =>
                                      void respondInterview(interview.id, "CONFIRM")
                                    }
                                  >
                                    {isInterviewBusy(interview.id, "CONFIRM") ? (
                                      <Loader2
                                        className="h-4 w-4 animate-spin"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                                    )}
                                    {t.status.interview.confirm}
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-11 sm:h-9"
                                    disabled={cardBusy}
                                    onClick={() =>
                                      setRescheduleFor(rescheduleOpen ? null : interview.id)
                                    }
                                    aria-expanded={rescheduleOpen}
                                  >
                                    <Clock className="h-4 w-4" aria-hidden="true" />
                                    {t.status.interview.requestChange}
                                  </Button>
                                </div>

                                {interview.status === "RESCHEDULE_REQUESTED" &&
                                interview.rescheduleProposedAt ? (
                                  <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
                                    <p>
                                      {fillTemplate(t.status.interview.proposedPending, {
                                        time: formatDateTimeId(interview.rescheduleProposedAt),
                                      })}
                                    </p>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="mt-2 h-11 border-orange-300 bg-transparent text-orange-800 hover:bg-orange-100 hover:text-orange-900 sm:h-9 dark:border-orange-500/40 dark:text-orange-300 dark:hover:bg-orange-500/10 dark:hover:text-orange-200"
                                      disabled={cardBusy}
                                      onClick={() =>
                                        void respondInterview(interview.id, "CANCEL_REQUEST")
                                      }
                                    >
                                      {isInterviewBusy(interview.id, "CANCEL_REQUEST") ? (
                                        <Loader2
                                          className="h-4 w-4 animate-spin"
                                          aria-hidden="true"
                                        />
                                      ) : (
                                        <X className="h-4 w-4" aria-hidden="true" />
                                      )}
                                      {t.status.interview.cancelRequest}
                                    </Button>
                                  </div>
                                ) : null}

                                {rescheduleOpen ? (
                                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
                                    <Label
                                      htmlFor={`reschedule-at-${interview.id}`}
                                      className="text-xs font-medium text-orange-800 dark:text-orange-300"
                                    >
                                      {t.status.interview.proposedLabel}
                                    </Label>
                                    <Input
                                      id={`reschedule-at-${interview.id}`}
                                      type="datetime-local"
                                      value={proposedAt}
                                      onChange={(e) => setProposedAt(e.target.value)}
                                      className="mt-1 h-11 bg-background sm:h-9"
                                    />
                                    <Label
                                      htmlFor={`reschedule-reason-${interview.id}`}
                                      className="mt-2 text-xs font-medium text-orange-800 dark:text-orange-300"
                                    >
                                      {t.status.interview.reasonLabel}
                                    </Label>
                                    <Textarea
                                      id={`reschedule-reason-${interview.id}`}
                                      rows={2}
                                      value={rescheduleReason}
                                      onChange={(e) => setRescheduleReason(e.target.value)}
                                      placeholder={t.status.interview.reasonPh}
                                      maxLength={500}
                                      className="mt-1 bg-background text-sm"
                                    />
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      <Button
                                        size="sm"
                                        className="h-11 sm:h-9"
                                        disabled={cardBusy || !proposedAt}
                                        onClick={() => void submitReschedule(interview.id)}
                                      >
                                        {isInterviewBusy(interview.id, "RESCHEDULE") ? (
                                          <Loader2
                                            className="h-4 w-4 animate-spin"
                                            aria-hidden="true"
                                          />
                                        ) : (
                                          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                                        )}
                                        {t.status.interview.sendRequest}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-11 sm:h-9"
                                        disabled={cardBusy}
                                        onClick={() => setRescheduleFor(null)}
                                      >
                                        {t.status.formCancel}
                                      </Button>
                                    </div>
                                  </div>
                                ) : null}
                              </div>
                            ) : interview.status === "CONFIRMED" ? (
                              <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                                {t.status.interview.confirmDone}
                              </p>
                            ) : null}

                            <Collapsible className="mt-3">
                              <CollapsibleTrigger className="group flex w-fit items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                                <ChevronDown
                                  className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
                                  aria-hidden="true"
                                />
                                {isOnline
                                  ? t.status.interview.tipsTitleOnline
                                  : t.status.interview.tipsTitleOnsite}
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                                  {(isOnline
                                    ? t.status.interview.tipsOnline
                                    : t.status.interview.tipsOnsite
                                  ).map((tip) => (
                                    <li key={tip}>{tip}</li>
                                  ))}
                                </ul>
                              </CollapsibleContent>
                            </Collapsible>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Pilih jadwal wawancara — slot self-service dari admin */}
                {availableSlots.length > 0 && !finalStatus ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Pilih Jadwal Wawancara
                    </p>
                    <p className="mt-1 text-sm text-amber-800/85 dark:text-amber-200/80">
                      Tim membuka jadwal berikut — pilih satu slot untuk sesi wawancaramu:
                    </p>
                    <div className="mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto nice-scrollbar">
                      {availableSlots.map((slot) => {
                        const busy = bookingSlotId === slot.id;
                        const slotOnline = slot.mode === "ONLINE";
                        return (
                          <div
                            key={slot.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200/80 bg-background/70 p-3 dark:border-amber-500/20"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              {slotOnline ? (
                                <Video className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <MapPin className="h-4 w-4" aria-hidden="true" />
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium">
                                {formatDateTimeId(slot.scheduledAt)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {slot.durationMin} menit · {PLATFORM_LABELS[slot.platform]}
                                {slot.interviewers.length > 0
                                  ? ` · ${slot.interviewers.join(", ")}`
                                  : ""}
                                {!slotOnline && slot.address ? ` · ${slot.address}` : ""}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              className="h-11 sm:h-9"
                              disabled={bookingSlotId !== null}
                              onClick={() => void bookSlot(slot.id)}
                              aria-label={`Pilih slot ${formatDateTimeId(slot.scheduledAt)}`}
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                              )}
                              Pilih slot ini
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {/* Penawaran (offer) — disembunyikan bila tahap akhir sudah Ditolak
                    (sudah ganti tahap: kartu penawaran lama tidak relevan lagi). */}
                {offer && finalStatus !== "REJECTED" ? (
                  <div>
                    {offer.status === "PENDING" ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                          <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
                          {t.status.offer.title}
                        </p>
                        {offer.message ? (
                          <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-emerald-900/90 dark:text-emerald-200/90">
                            {offer.message}
                          </p>
                        ) : null}
                        <div className="mt-3 grid gap-1.5">
                          {offer.salary ? (
                            <DetailRow label={t.status.offer.salary} value={offer.salary} />
                          ) : null}
                          {offer.type ? (
                            <DetailRow label={t.status.offer.type} value={offer.type} />
                          ) : null}
                          {offer.startDate ? (
                            <DetailRow
                              label={t.status.offer.start}
                              value={formatDateTimeId(offer.startDate)}
                            />
                          ) : null}
                          {offer.deadline && offerDaysLeft !== null ? (
                            <p className="text-sm">
                              <span className="text-muted-foreground">
                                {t.status.offer.deadlineLabel}:{" "}
                              </span>
                              <span className="font-medium">{formatDateId(offer.deadline)}</span>{" "}
                              <span className="text-emerald-700 dark:text-emerald-400">
                                ({fillTemplate(t.status.offer.daysLeft, { n: offerDaysLeft })})
                              </span>
                            </p>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:h-9"
                                disabled={offerBusy !== null}
                              >
                                {offerBusy === "ACCEPT" ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                ) : (
                                  <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                                )}
                                {t.status.offer.accept}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>{t.status.offer.acceptTitle}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t.status.offer.acceptDesc}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel disabled={offerBusy === "ACCEPT"}>
                                  {t.status.formCancel}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                                  disabled={offerBusy === "ACCEPT"}
                                  onClick={() => void acceptOffer()}
                                >
                                  {offerBusy === "ACCEPT" ? (
                                    <Loader2
                                      className="h-4 w-4 animate-spin"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  {t.status.offer.acceptYes}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-11 sm:h-9"
                            disabled={offerBusy !== null}
                            onClick={() => setDeclineOpen((prev) => !prev)}
                            aria-expanded={declineOpen}
                          >
                            {t.status.offer.decline}
                          </Button>
                        </div>
                        {declineOpen ? (
                          <div className="mt-3 rounded-lg border border-emerald-200/80 bg-background/70 p-3 dark:border-emerald-500/20">
                            <Label
                              htmlFor="offer-decline-reason"
                              className="text-xs font-medium"
                            >
                              {t.status.offer.declineReasonLabel}
                            </Label>
                            <Textarea
                              id="offer-decline-reason"
                              rows={2}
                              value={declineReason}
                              onChange={(e) => setDeclineReason(e.target.value)}
                              placeholder={t.status.offer.declineReasonPh}
                              maxLength={500}
                              className="mt-1 text-sm"
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                className="h-11 sm:h-9"
                                disabled={offerBusy !== null}
                                onClick={() => void declineOffer()}
                              >
                                {offerBusy === "DECLINE" ? (
                                  <Loader2
                                    className="h-4 w-4 animate-spin"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <BadgeX className="h-4 w-4" aria-hidden="true" />
                                )}
                                {t.status.offer.declineSend}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-11 sm:h-9"
                                disabled={offerBusy !== null}
                                onClick={() => setDeclineOpen(false)}
                              >
                                {t.status.formCancel}
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : offer.status === "ACCEPTED" ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                        <p className="flex items-center gap-3 font-semibold text-emerald-800 dark:text-emerald-300">
                          <BadgeCheck
                            className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400"
                            aria-hidden="true"
                          />
                          {t.status.offer.acceptedTitle}
                        </p>
                        {offer.respondedAt ? (
                          <p className="mt-1 pl-8 text-emerald-700/90 dark:text-emerald-300/80">
                            {fillTemplate(t.status.offer.respondedLabel, {
                              time: formatDateTimeId(offer.respondedAt),
                            })}
                          </p>
                        ) : null}
                      </div>
                    ) : offer.status === "DECLINED" ? (
                      <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-500/30 dark:bg-zinc-500/10">
                        <p className="flex items-center gap-3 font-semibold text-zinc-700 dark:text-zinc-300">
                          <BadgeX className="h-5 w-5 shrink-0" aria-hidden="true" />
                          {t.status.offer.declinedTitle}
                        </p>
                        {offer.declineReason ? (
                          <p className="mt-1 pl-8 text-zinc-600 dark:text-zinc-400">
                            {offer.declineReason}
                          </p>
                        ) : null}
                      </div>
                    ) : offer.status === "EXPIRED" ? (
                      <div
                        role="status"
                        className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                      >
                        <Clock className="h-5 w-5 shrink-0" aria-hidden="true" />
                        {t.status.offer.expiredTitle}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Onboarding — dokumen & info bergabung (tidak tampil bila sudah ditolak) */}
                {onboarding && finalStatus !== "REJECTED" ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                    <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                      <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {t.status.onboarding.title}
                    </p>
                    {onboarding.welcomeMessage ? (
                      <p className="mt-2 whitespace-pre-line font-medium leading-relaxed text-emerald-900 dark:text-emerald-200">
                        {onboarding.welcomeMessage}
                      </p>
                    ) : null}
                    <div className="mt-2 grid gap-1 text-sm text-emerald-800/90 dark:text-emerald-300/90">
                      {onboarding.hiredAt ? (
                        <p>
                          {fillTemplate(t.status.onboarding.since, {
                            date: formatDateId(onboarding.hiredAt),
                          })}
                        </p>
                      ) : null}
                      {onboarding.probationEnd ? (
                        <p>
                          {fillTemplate(t.status.onboarding.probation, {
                            date: formatDateId(onboarding.probationEnd),
                          })}
                        </p>
                      ) : null}
                    </div>
                    {onboardingDocs.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                          {fillTemplate(t.status.onboarding.docsProgress, {
                            done: onboardingDoneCount,
                            total: onboardingDocs.length,
                          })}
                        </p>
                        <ul className="mt-2 flex flex-col gap-2">
                          {onboardingDocs.map((doc) => (
                            <li key={doc.id} className="flex flex-wrap items-center gap-2 text-sm">
                              {doc.done ? (
                                <CheckCircle2
                                  className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden="true"
                                />
                              ) : (
                                <span
                                  className="h-4 w-4 shrink-0 rounded-full border-2 border-emerald-600/40 dark:border-emerald-400/40"
                                  aria-hidden="true"
                                />
                              )}
                              <span className="font-medium text-emerald-900 dark:text-emerald-200">
                                {doc.label}
                                {doc.required ? (
                                  <>
                                    <span aria-hidden="true"> *</span>
                                    <span className="sr-only">
                                      {" "}
                                      ({t.status.onboarding.required})
                                    </span>
                                  </>
                                ) : null}
                              </span>
                              {uploadingDocId === doc.id ? (
                                <Loader2
                                  className="h-4 w-4 shrink-0 animate-spin text-emerald-600 dark:text-emerald-400"
                                  aria-hidden="true"
                                />
                              ) : null}
                              {doc.done && doc.fileId ? (
                                <a
                                  href={`/api/files/${doc.fileId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={fillTemplate(t.status.onboarding.downloadAria, {
                                    label: doc.label,
                                  })}
                                  className="inline-flex h-11 items-center gap-1 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline sm:h-auto dark:text-emerald-400"
                                >
                                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                                  {t.status.onboarding.download}
                                </a>
                              ) : null}
                              {!doc.done ? (
                                <Input
                                  type="file"
                                  accept=".pdf,.jpg,.jpeg,.png"
                                  aria-label={fillTemplate(t.status.onboarding.uploadAria, {
                                    label: doc.label,
                                  })}
                                  disabled={uploadingDocId !== null}
                                  className="h-11 w-full max-w-xs border-emerald-300 bg-background text-xs dark:border-emerald-500/40"
                                  onChange={(event) =>
                                    void uploadOnboardingDoc(doc.id, event)
                                  }
                                />
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {finalStatus === "ACCEPTED" ? (
                  <div
                    role="status"
                    className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    <BadgeCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {t.status.accepted}
                  </div>
                ) : null}
                {finalStatus === "REJECTED" ? (
                  <div
                    role="status"
                    className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm dark:border-rose-500/30 dark:bg-rose-500/10"
                  >
                    <p className="flex items-center gap-3 font-semibold text-rose-700 dark:text-rose-300">
                      <BadgeX className="h-5 w-5 shrink-0" aria-hidden="true" />
                      {t.status.rejected}
                    </p>
                    {result.rejection?.reasonLabel ? (
                      <p className="pl-8 text-rose-700/90 dark:text-rose-300/90">
                        {t.status.rejectedDetail.reasonLabel}: {result.rejection.reasonLabel}
                      </p>
                    ) : null}
                    {result.rejection?.note ? (
                      <div className="ml-8 rounded-lg border border-rose-200/80 bg-background/60 px-3 py-2 dark:border-rose-500/20">
                        <p className="font-medium text-rose-700 dark:text-rose-300">
                          {t.status.rejectedDetail.feedback}:
                        </p>
                        <p className="mt-1 whitespace-pre-line leading-relaxed text-rose-700/90 dark:text-rose-300/90">
                          {result.rejection.note}
                        </p>
                      </div>
                    ) : null}
                    <div className="pl-8">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 border-rose-300 bg-transparent text-rose-700 hover:bg-rose-100 hover:text-rose-800 sm:h-9 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                        asChild
                      >
                        <a href="#posisi">
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          {t.status.rejectedDetail.otherPositions}
                        </a>
                      </Button>
                    </div>
                  </div>
                ) : null}
              </motion.div>
            ) : null}
          </Card>
        </FadeIn>
      </Container>
    </section>
  );
}
