"use client";

// Halaman Cek Status (#status) — view khusus pelamar (pengganti section inline).
// Alur:
// 1. Login ganda: email + kode pelacakan (kode berperan sebagai kata sandi).
//    Endpoint: POST /api/public/track-auth — gagal 5x dalam 15 menit terkunci.
// 2. Sesi opsional tersimpan di perangkat ("Ingat saya"): localStorage vs sessionStorage
//    (src/lib/status-session.ts) — auto-masuk saat kembali, tombol Keluar tersedia.
// 3. Multi-lamaran: satu email bisa punya beberapa lamaran — daftar kartu ringkas
//    dengan badge "Ada pembaruan" (bandingkan statusUpdatedAt vs waktu terakhir dilihat).
// 4. Detail per lamaran: hero status berwarna + tombol salin kode + tarik lamaran
//    (self-service), timeline progres, aksi wawancara (konfirmasi/ubah/pindah slot/
//    tidak hadir), penawaran (terima/tolak), dan unggah dokumen onboarding.
// 5. Realtime: perubahan di admin memicu recheck senyap tanpa reload (anti-flicker).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  BadgeX,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Loader2,
  LogOut,
  MapPin,
  Mail,
  RefreshCw,
  Sparkles,
  Video,
  X,
  XCircle,
} from "lucide-react";
import {
  INTERVIEW_STATUS_LABELS,
  STATUS_FLOW,
  STATUS_LABELS,
  type InterviewPlatform,
  type InterviewStatus,
  type StageKey,
  type TrackAuthResponse,
  type TrackResponse,
  type TrackSlotInfo,
  type TrackSummary,
} from "@/lib/types";
import { stageLabel } from "@/lib/stages";
import {
  clearSession,
  loadSeenAt,
  loadSession,
  markSeen,
  saveSession,
} from "@/lib/status-session";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LangProvider, useLang } from "@/components/landing/lang-context";
import { Container } from "@/components/landing/primitives";
import {
  fillTemplate,
  formatDateTimeId,
  formatDateId,
  safeExternalUrl,
} from "@/components/landing/landing-utils";
import { useLiveEvent } from "@/lib/live-client";

// Debounce recheck realtime — endpoint track punya throttle (min. ~0,4 detik).
const LIVE_RECHECK_DEBOUNCE_MS = 1000;
// Jeda recheck setelah aksi sukses agar tidak menabrak throttle endpoint.
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

export function StatusPageView({ onExit }: { onExit: () => void }) {
  return (
    <LangProvider>
      <StatusPageInner onExit={onExit} />
    </LangProvider>
  );
}

function StatusPageInner({ onExit }: { onExit: () => void }) {
  const { t } = useLang();
  const p = t.status.page;

  // ---------- Sesi & boot ----------
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<{ email: string; code: string } | null>(null);

  // ---------- Form login ----------
  const [loginEmail, setLoginEmail] = useState("");
  const [loginCode, setLoginCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // ---------- Daftar lamaran & detail ----------
  const [apps, setApps] = useState<TrackSummary[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrackResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ---------- Tarik lamaran ----------
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  // ---------- Aksi sesi wawancara: loading per (interviewId:action) + form ubah jadwal ----------
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
  // Pindah jadwal mandiri: panel slot inline per sesi + daftar slot terbuka.
  const [slotPanelFor, setSlotPanelFor] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsList, setSlotsList] = useState<TrackSlotInfo[]>([]);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null);
  // Tidak bisa hadir: konfirmasi inline per sesi.
  const [cancelOpenFor, setCancelOpenFor] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const recheckTimerRef = useRef<number | null>(null);
  const selectedCodeRef = useRef<string | null>(null);
  selectedCodeRef.current = selectedCode;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const resetToLogin = useCallback(() => {
    clearSession();
    setSession(null);
    setApps([]);
    setSelectedCode(null);
    setDetail(null);
    setLoginEmail("");
    setLoginCode("");
    setLoginError(null);
  }, []);

  /** Muat detail satu lamaran (email + kode wajib cocok di server). */
  const loadDetail = useCallback(
    async (email: string, code: string) => {
      setDetailLoading(true);
      try {
        const res = await fetch("/api/public/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code }),
        });
        if (res.status === 429) {
          toast.error(t.status.rateLimited);
          return;
        }
        const data = (await res.json().catch(() => null)) as TrackResponse | null;
        if (!res.ok || !data) {
          toast.error(t.apply.errors.submitFailed);
          return;
        }
        if (!data.found) {
          // Pasangan email+kode tidak valid lagi (mis. lamaran dihapus) — paksa login ulang.
          toast.error(p.authFailed);
          resetToLogin();
          return;
        }
        setDetail(data);
        markSeen(code);
      } catch {
        toast.error(t.apply.errors.submitFailed);
      } finally {
        setDetailLoading(false);
      }
    },
    [p.authFailed, resetToLogin, t.apply.errors.submitFailed, t.status.rateLimited],
  );

  /** Login / verifikasi sesi: cocokkan email+kode, ambil daftar lamaran email tsb. */
  const authenticate = useCallback(
    async (email: string, code: string): Promise<TrackSummary[] | null> => {
      try {
        const res = await fetch("/api/public/track-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, code }),
        });
        const data = (await res.json().catch(() => null)) as TrackAuthResponse | null;
        if (res.status === 429) {
          if (data?.lockedForSec && data.lockedForSec > 0) {
            setLoginError(
              fillTemplate(p.locked, { minutes: String(Math.ceil(data.lockedForSec / 60)) }),
            );
          } else {
            setLoginError(p.tooFast);
          }
          return null;
        }
        if (!res.ok || !data || data.ok !== true || !Array.isArray(data.applications)) {
          setLoginError(p.authFailed);
          return null;
        }
        setLoginError(null);
        return data.applications.filter((app) => app.trackingCode);
      } catch {
        setLoginError(t.status.actionFailed);
        return null;
      }
    },
    [p.authFailed, p.locked, p.tooFast, t.status.actionFailed],
  );

  /** Pilih lamaran aktif dari daftar + muat detailnya. */
  const selectApp = useCallback(
    async (code: string) => {
      setSelectedCode(code);
      setDetail(null);
      // Tutup semua panel aksi saat pindah lamaran.
      setRescheduleFor(null);
      setSlotPanelFor(null);
      setCancelOpenFor(null);
      setDeclineOpen(false);
      setWithdrawOpen(false);
      const current = sessionRef.current;
      if (!current) return;
      await loadDetail(current.email, code);
    },
    [loadDetail],
  );

  // Boot: cek sesi tersimpan → auto-masuk; gagal → bersihkan & tampilkan login.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadSession();
      if (!stored) {
        setBooting(false);
        return;
      }
      const list = await authenticate(stored.email, stored.code);
      if (cancelled) return;
      if (!list || list.length === 0) {
        clearSession();
        setBooting(false);
        return;
      }
      setSession({ email: stored.email, code: stored.code });
      setApps(list);
      // Badge pembaruan sejak kunjungan terakhir (sebelum seen diperbarui).
      const hasUpdate = list.some(
        (app) => new Date(app.statusUpdatedAt).getTime() > loadSeenAt(app.trackingCode),
      );
      if (hasUpdate) toast.info(p.updatedBadge);
      setBooting(false);
      const preferred =
        list.find((app) => app.trackingCode === stored.code)?.trackingCode ??
        list[0]?.trackingCode ??
        null;
      if (preferred) {
        setSelectedCode(preferred);
        await loadDetail(stored.email, preferred);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Halaman khusus: selalu mulai dari atas saat dibuka (nav anchor #status).
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  /**
   * Pengecekan ulang SENYAP saat broadcast realtime masuk atau setelah aksi pelamar:
   * tanpa spinner, data lama tetap tampil, dan state hanya di-swap bila isi
   * benar-benar berubah (anti-flicker). Kegagalan jaringan diabaikan diam.
   */
  async function recheckSilently(codeValue: string) {
    const current = sessionRef.current;
    if (!current) return;
    try {
      const res = await fetch("/api/public/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: current.email, code: codeValue }),
      });
      if (!res.ok) return; // gagal senyap — pertahankan hasil terakhir
      const data = (await res.json().catch(() => null)) as TrackResponse | null;
      if (!data || !data.found) return; // lamaran tak ditemukan lagi — biarkan tampilan lama
      setDetail((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
      markSeen(codeValue);
    } catch {
      // senyap
    }
  }

  /**
   * Jadwalkan recheck senyap dengan SATU timer debounce bersama — dipakai
   * event realtime (applications:changed & interviews:changed) maupun
   * recheck manual setelah aksi pelamar, agar tidak menabrak throttle.
   */
  function scheduleSilentRecheck(delayMs = LIVE_RECHECK_DEBOUNCE_MS) {
    const code = selectedCodeRef.current;
    if (!code) return;
    if (recheckTimerRef.current) window.clearTimeout(recheckTimerRef.current);
    recheckTimerRef.current = window.setTimeout(() => {
      recheckTimerRef.current = null;
      void recheckSilently(code);
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

  /** Submit form login. */
  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const code = loginCode.trim().toUpperCase();
    if (!email || !code || loginBusy) return;
    setLoginBusy(true);
    const list = await authenticate(email, code);
    setLoginBusy(false);
    if (!list || list.length === 0) return;
    saveSession({ email, code }, remember);
    setSession({ email, code });
    setApps(list);
    const preferred =
      list.find((app) => app.trackingCode === code)?.trackingCode ??
      list[0]?.trackingCode ??
      null;
    if (preferred) {
      setSelectedCode(preferred);
      await loadDetail(email, preferred);
    }
  }

  function logout() {
    if (recheckTimerRef.current) {
      window.clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
    resetToLogin();
  }

  function goBrowseJobs() {
    onExit();
    window.setTimeout(() => {
      document.getElementById("posisi")?.scrollIntoView({ behavior: "smooth" });
    }, 120);
  }

  /** Salin kode pelacakan lamaran aktif. */
  async function copyCode() {
    if (!selectedCode) return;
    try {
      await navigator.clipboard.writeText(selectedCode);
      toast.success(p.copiedToast);
    } catch {
      toast.error(t.positions.salinGagal);
    }
  }

  /** Tarik lamaran (self-service) — konfirmasi via AlertDialog di hero. */
  async function withdrawApplication() {
    if (!session || !selectedCode || withdrawBusy) return;
    setWithdrawBusy(true);
    try {
      const res = await fetch("/api/public/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: session.email,
          code: selectedCode,
          ...(withdrawReason.trim() ? { reason: withdrawReason.trim() } : {}),
        }),
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
        toast.error(serverError ?? t.status.actionFailed);
        return;
      }
      toast.success(p.withdrawToast);
      setWithdrawOpen(false);
      setWithdrawReason("");
      // Segarkan daftar lamaran (status berubah) + detail via recheck senyap.
      const list = await authenticate(session.email, session.code);
      if (list) setApps(list);
      scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
    } catch {
      toast.error(t.status.actionFailed);
    } finally {
      setWithdrawBusy(false);
    }
  }

  /**
   * Kirim perintah ke endpoint aksi publik (interview/offer) tanpa melempar.
   * 429 (throttle per IP) memakai pesan sopan dari strings.
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
    if (!selectedCode) return;
    setInterviewBusy(`${interviewId}:${action}`);
    const out = await postAction("/api/public/interview/respond", {
      code: selectedCode,
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
    if (!selectedCode) return;
    setOfferBusy("ACCEPT");
    const out = await postAction("/api/public/offer/respond", {
      code: selectedCode,
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
    if (!selectedCode) return;
    setOfferBusy("DECLINE");
    const out = await postAction("/api/public/offer/respond", {
      code: selectedCode,
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
    if (!selectedCode || bookingSlotId) return;
    setBookingSlotId(slotId);
    const out = await postAction("/api/public/slots/book", {
      code: selectedCode,
      slotId,
    });
    setBookingSlotId(null);
    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    toast.success(t.status.interview.slotBookedToast);
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  /** Muat daftar slot terbuka dari API publik (dipakai panel pindah jadwal). */
  async function loadOpenSlots() {
    if (!selectedCode || slotsLoading) return;
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const res = await fetch(`/api/public/slots?code=${encodeURIComponent(selectedCode)}`);
      const data = (await res.json().catch(() => null)) as
        | { ok?: unknown; slots?: unknown; error?: unknown }
        | null;
      if (!res.ok || !data) {
        const serverError =
          typeof data?.error === "string" && data.error ? data.error : null;
        setSlotsError(serverError ?? t.status.actionFailed);
        setSlotsList([]);
        return;
      }
      setSlotsList(Array.isArray(data.slots) ? (data.slots as TrackSlotInfo[]) : []);
    } catch {
      setSlotsError(t.status.actionFailed);
    } finally {
      setSlotsLoading(false);
    }
  }

  /** Buka panel pindah jadwal untuk satu sesi + muat slot terbuka. */
  async function openSlotPanel(interviewId: string) {
    setRescheduleFor(null);
    setCancelOpenFor(null);
    setCancelError(null);
    setSlotPanelFor(interviewId);
    setPendingSlotId(null);
    await loadOpenSlots();
  }

  function closeSlotPanel() {
    setSlotPanelFor(null);
    setPendingSlotId(null);
    setSlotsError(null);
  }

  /**
   * Eksekusi pindah jadwal ke slot terpilih (setelah konfirmasi inline).
   * Error API ditampilkan apa adanya di panel; sukses memicu recheck senyap.
   */
  async function moveInterviewToSlot(interviewId: string, slotId: string) {
    if (!selectedCode || isInterviewBusy(interviewId, "RESLOT")) return;
    setSlotsError(null);
    setInterviewBusy(`${interviewId}:RESLOT`);
    const out = await postAction("/api/public/interview/reschedule-slot", {
      code: selectedCode,
      interviewId,
      slotId,
    });
    setInterviewBusy(null);
    if (!out.ok) {
      setSlotsError(out.error);
      setPendingSlotId(null);
      return;
    }
    toast.success(t.status.interview.slotMovedToast);
    closeSlotPanel();
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  /**
   * Eksekusi pembatalan kehadiran (setelah konfirmasi inline).
   * Error API ditampilkan apa adanya di kotak konfirmasi.
   */
  async function cancelAttendance(interviewId: string) {
    if (!selectedCode || isInterviewBusy(interviewId, "CANCEL_ATTENDANCE")) return;
    setCancelError(null);
    setInterviewBusy(`${interviewId}:CANCEL_ATTENDANCE`);
    const out = await postAction("/api/public/interview/cancel-attendance", {
      code: selectedCode,
      interviewId,
    });
    setInterviewBusy(null);
    if (!out.ok) {
      setCancelError(out.error);
      return;
    }
    toast.success(t.status.interview.attendanceCancelledToast);
    setCancelOpenFor(null);
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  /** Unggah dokumen onboarding (multipart) langsung saat file dipilih. */
  async function uploadOnboardingDoc(docId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = ""; // reset agar file yang sama bisa dipilih ulang
    if (!file || !selectedCode) return;
    setUploadingDocId(docId);
    try {
      const fd = new FormData();
      fd.append("code", selectedCode);
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

  // ---------- Turunan untuk tampilan detail ----------
  const steps: StepView[] = detail
    ? (detail.steps ??
      STATUS_FLOW.map((key) => ({
        key,
        label: stageLabel(key),
        done: false,
        at: null,
      })))
    : [];
  const finalStatus = isFinalStatus(detail?.status) ? detail?.status : undefined;
  const currentKey = !finalStatus ? detail?.status : undefined;

  /**
   * Chip status untuk hero & daftar lamaran: warna per kelompok tahap
   * (emerald diterima / rose ditolak / zinc ditarik / amber wawancara / netral lainnya).
   */
  function statusChip(
    status: string | undefined,
    rejectionReason: string | null | undefined,
  ): { label: string; cls: string } {
    if (status === "ACCEPTED") {
      return {
        label: t.status.accepted,
        cls: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
      };
    }
    if (status === "REJECTED" && rejectionReason === "MENARIK_DIRI") {
      return {
        label: p.statusWithdrawn,
        cls: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-300",
      };
    }
    if (status === "REJECTED") {
      return {
        label: t.status.rejected,
        cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300",
      };
    }
    if (status === "INTERVIEW") {
      return {
        label: STATUS_LABELS.INTERVIEW,
        cls: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
      };
    }
    if (status === "NEW" || status === "REVIEWED") {
      return {
        label: status === "NEW" ? "Menunggu Ditinjau" : STATUS_LABELS.REVIEWED,
        cls: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-300",
      };
    }
    // Tahap kustom per posisi — tampilkan apa adanya.
    return {
      label: status ? stageLabel(status) : "-",
      cls: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-500/30 dark:bg-zinc-500/10 dark:text-zinc-300",
    };
  }

  // URL brief tes posisi (disanitasi — hanya http/https).
  const assignmentUrl = detail?.assignment?.url
    ? safeExternalUrl(detail.assignment.url)
    : null;
  // Sesi wawancara terurut ronde: terbaru paling menonjol (paling atas).
  const interviews = detail?.interviews
    ? [...detail.interviews].sort((a, b) => b.round - a.round)
    : [];
  const offer = detail?.offer ?? null;
  // Sisa hari jawaban penawaran (dihitung dari now, dibulatkan ke atas, min. 0).
  let offerDaysLeft: number | null = null;
  if (offer?.deadline) {
    const deadlineMs = new Date(offer.deadline).getTime();
    if (!Number.isNaN(deadlineMs)) {
      offerDaysLeft = Math.max(0, Math.ceil((deadlineMs - Date.now()) / DAY_MS));
    }
  }
  const onboarding = detail?.onboarding ?? null;
  const onboardingDocs = onboarding?.docs ?? [];
  const onboardingDoneCount = onboardingDocs.filter((doc) => doc.done).length;
  // Slot jadwal self-service (dari track API — hanya ada bila tahap belum final).
  const availableSlots = detail?.slots ?? [];
  const heroChip = statusChip(detail?.status, detail?.rejectionReason);
  const canWithdraw =
    !!detail && detail.found && !!detail.status && !isFinalStatus(detail.status);

  // ---------- Render ----------
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Bilah atas: kembali ke beranda + sesi */}
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
        <Container className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
          <Button variant="ghost" className="h-11 gap-2" onClick={onExit}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {p.backHome}
          </Button>
          {session ? (
            <div className="flex items-center gap-2">
              <span className="hidden max-w-56 truncate text-xs text-muted-foreground sm:inline">
                {fillTemplate(p.loggedInAs, { email: session.email })}
              </span>
              <Button
                variant="outline"
                className="h-11 gap-2"
                onClick={logout}
                aria-label={p.logout}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                {p.logout}
              </Button>
            </div>
          ) : null}
        </Container>
      </header>

      <main className="flex-1">
        <Container className="max-w-3xl px-4 py-10 sm:px-6 md:py-14">
          {booting ? (
            <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
              <p className="text-sm">{p.loggingIn}</p>
            </div>
          ) : !session ? (
            /* ---------- Login: email + kode pelacakan ---------- */
            <FadeInSlide>
              <Card className="mx-auto w-full max-w-md rounded-2xl p-6 text-left md:p-8">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                    <KeyRound className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h1 className="text-xl font-bold tracking-tight">{p.loginTitle}</h1>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.loginDesc}</p>

                <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4" noValidate>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="status-email">{p.emailLabel}</Label>
                    <div className="relative">
                      <Mail
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        id="status-email"
                        name="email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder={p.emailPh}
                        className="h-11 pl-9"
                        maxLength={120}
                        required
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="status-code">{t.status.codeLabel}</Label>
                    <div className="relative">
                      <Input
                        id="status-code"
                        name="code"
                        type={showCode ? "text" : "password"}
                        value={loginCode}
                        onChange={(e) => setLoginCode(e.target.value.toUpperCase())}
                        placeholder={t.status.codePh}
                        className="h-11 pr-20 font-mono uppercase"
                        autoComplete="off"
                        maxLength={24}
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowCode((prev) => !prev)}
                        className="absolute right-2 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                        aria-label={showCode ? p.hideCode : p.showCode}
                      >
                        {showCode ? (
                          <EyeOff className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Eye className="h-4 w-4" aria-hidden="true" />
                        )}
                        {showCode ? p.hideCode : p.showCode}
                      </button>
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <Checkbox
                      checked={remember}
                      onCheckedChange={(checked) => setRemember(checked === true)}
                      aria-label={p.remember}
                    />
                    {p.remember}
                  </label>

                  {loginError ? (
                    <div
                      role="alert"
                      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                    >
                      {loginError}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    className="h-12 w-full"
                    disabled={loginBusy || !loginEmail.trim() || !loginCode.trim()}
                  >
                    {loginBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {p.loggingIn}
                      </>
                    ) : (
                      <>
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                        {p.login}
                      </>
                    )}
                  </Button>
                </form>
              </Card>

              {/* Bantuan: kehilangan kode pelacakan */}
              <Collapsible className="mx-auto mt-4 w-full max-w-md">
                <Card className="rounded-2xl p-4">
                  <CollapsibleTrigger className="group flex w-full items-center gap-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <HelpCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    {p.lostCodeTitle}
                    <ChevronDown
                      className="ml-auto h-4 w-4 transition-transform group-data-[state=open]:rotate-180"
                      aria-hidden="true"
                    />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                      <li>{p.lostCodeEmail}</li>
                      <li>{p.lostCodeWa}</li>
                    </ul>
                    <Button
                      variant="outline"
                      className="mt-3 h-11 w-full gap-2"
                      onClick={goBrowseJobs}
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      {p.browseJobs}
                    </Button>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </FadeInSlide>
          ) : (
            <div className="flex flex-col gap-6">
              {/* ---------- Daftar multi-lamaran (bila lebih dari satu) ---------- */}
              {apps.length > 1 ? (
                <Card className="rounded-2xl p-4 text-left md:p-5">
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {fillTemplate(p.myApps, { n: String(apps.length) })}
                  </p>
                  <div className="mt-3 grid gap-2">
                    {apps.map((app) => {
                      const selected = app.trackingCode === selectedCode;
                      const hasUpdate =
                        !selected &&
                        new Date(app.statusUpdatedAt).getTime() > loadSeenAt(app.trackingCode);
                      const chip = statusChip(app.status, null);
                      return (
                        <button
                          key={app.trackingCode}
                          type="button"
                          onClick={() => void selectApp(app.trackingCode)}
                          aria-label={fillTemplate(p.selectAppAria, {
                            title: app.positionTitle ?? app.trackingCode,
                          })}
                          aria-current={selected ? "true" : undefined}
                          className={`rounded-xl border p-3.5 text-left transition-colors ${
                            selected
                              ? "border-rose-600/50 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/10"
                              : "border-border bg-background hover:border-rose-600/30 hover:bg-muted/50"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {app.positionTitle ?? "—"}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatDateId(app.submittedAt)} ·{" "}
                                <span className="font-mono">{app.trackingCode}</span>
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {hasUpdate ? (
                                <Badge className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300" variant="outline">
                                  {p.updatedBadge}
                                </Badge>
                              ) : null}
                              <Badge variant="outline" className={chip.cls}>
                                {chip.label}
                              </Badge>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </Card>
              ) : null}

              {/* ---------- Detail lamaran ---------- */}
              {detailLoading && !detail ? (
                <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
                  <p className="text-sm">{t.status.tracking}</p>
                </div>
              ) : detail && detail.found ? (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="flex flex-col gap-5"
                  role="status"
                >
                  {/* HERO status berwarna */}
                  <Card className="rounded-2xl p-5 md:p-6">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {p.currentStatus}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-3">
                      <Badge variant="outline" className={`px-3 py-1.5 text-sm font-semibold ${heroChip.cls}`}>
                        {heroChip.label}
                      </Badge>
                      {detail.positionTitle ? (
                        <p className="text-base font-bold tracking-tight">
                          {detail.positionTitle}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
                      {detail.submittedAt ? (
                        <p>
                          <span className="text-muted-foreground">{t.status.submittedLabel}: </span>
                          <span className="font-medium">{formatDateTimeId(detail.submittedAt)}</span>
                        </p>
                      ) : null}
                      {detail.updatedAt ? (
                        <p className="text-muted-foreground">
                          {fillTemplate(p.lastUpdated, {
                            time: formatDateTimeId(detail.updatedAt),
                          })}
                        </p>
                      ) : null}
                      {selectedCode ? (
                        <button
                          type="button"
                          onClick={() => void copyCode()}
                          className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 font-mono text-xs font-medium hover:bg-muted"
                          aria-label={p.copyCodeAria}
                          title={p.copyCode}
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          {selectedCode}
                        </button>
                      ) : null}
                    </div>

                    {/* Tarik lamaran (self-service, tahap belum final) */}
                    {canWithdraw ? (
                      <div className="mt-4 border-t pt-4">
                        <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 border-rose-200 bg-transparent text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:h-9 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                              disabled={withdrawBusy}
                            >
                              <XCircle className="h-4 w-4" aria-hidden="true" />
                              {p.withdraw}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{p.withdrawTitle}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {fillTemplate(p.withdrawDesc, {
                                  position: detail.positionTitle ?? "—",
                                })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="grid gap-2">
                              <Label htmlFor="withdraw-reason" className="text-sm font-medium">
                                {p.withdrawReasonLabel}
                              </Label>
                              <Textarea
                                id="withdraw-reason"
                                rows={2}
                                value={withdrawReason}
                                onChange={(e) => setWithdrawReason(e.target.value)}
                                placeholder={p.withdrawReasonPh}
                                maxLength={500}
                              />
                            </div>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={withdrawBusy}>
                                {t.status.formCancel}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                className="bg-rose-600 text-white hover:bg-rose-700"
                                disabled={withdrawBusy}
                                onClick={(event) => {
                                  event.preventDefault();
                                  void withdrawApplication();
                                }}
                              >
                                {withdrawBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                ) : (
                                  <XCircle className="h-4 w-4" aria-hidden="true" />
                                )}
                                {p.withdrawConfirm}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ) : null}
                  </Card>

                  {/* Timeline progres (stepper vertikal penuh) */}
                  <Card className="rounded-2xl p-5 md:p-6">
                    <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                      {p.timelineTitle}
                    </p>
                    <ol className="mt-4 space-y-0">
                      {steps.map((step, index) => {
                        const isLast = index === steps.length - 1;
                        const isCurrent = step.key === currentKey && !step.done;
                        return (
                          <li key={`${step.key}-${index}`} className="flex gap-3">
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
                              <div className="flex flex-wrap items-center gap-2">
                                <p
                                  className={
                                    step.done || isCurrent
                                      ? "text-sm font-medium"
                                      : "text-sm text-muted-foreground"
                                  }
                                >
                                  {step.label || step.key}
                                </p>
                                {isCurrent ? (
                                  <Badge
                                    variant="outline"
                                    className="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                                  >
                                    {p.currentStepBadge}
                                  </Badge>
                                ) : null}
                              </div>
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
                  </Card>

                  {/* Info tes seleksi posisi (bila posisi punya assignment) */}
                  {detail.assignment &&
                  (detail.assignment.title || detail.assignment.note || detail.assignment.url) ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                      <div className="flex items-start gap-2.5">
                        <ClipboardList
                          className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-hidden="true"
                        />
                        <div className="min-w-0 text-sm">
                          <p className="font-medium text-amber-800 dark:text-amber-300">
                            {t.status.assignmentTitle}
                            {detail.assignment.title ? `: ${detail.assignment.title}` : ""}
                          </p>
                          {detail.assignment.note ? (
                            <p className="mt-1 whitespace-pre-line leading-relaxed text-amber-700/90 dark:text-amber-200/80">
                              {detail.assignment.note}
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
                          const icsUrl = `/api/public/interview/ics?code=${encodeURIComponent(selectedCode ?? "")}&id=${encodeURIComponent(interview.id)}`;
                          const gcalUrl = buildGoogleCalendarUrl({
                            title: `${fillTemplate(t.status.interview.round, { n: interview.round })} — Lumina Studio`,
                            startIso: interview.scheduledAt,
                            durationMin: interview.durationMin,
                            details: [
                              detail.positionTitle
                                ? `${t.status.positionLabel}: ${detail.positionTitle}`
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
                          // Sesi mendatang yang masih aktif: boleh pindah slot / tidak bisa hadir.
                          const selfServiceUpcoming =
                            new Date(interview.scheduledAt).getTime() > Date.now() &&
                            (interview.status === "SCHEDULED" ||
                              interview.status === "CONFIRMED" ||
                              interview.status === "RESCHEDULE_REQUESTED");
                          const slotPanelOpen = slotPanelFor === interview.id;
                          const cancelConfirmOpen = cancelOpenFor === interview.id;
                          const moveBusy = isInterviewBusy(interview.id, "RESLOT");
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
                                      onClick={() => {
                                        setRescheduleFor(rescheduleOpen ? null : interview.id);
                                        closeSlotPanel();
                                        setCancelOpenFor(null);
                                      }}
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

                              {/* Aksi mandiri tambahan: pindah jadwal via slot terbuka & tidak bisa hadir */}
                              {selfServiceUpcoming ? (
                                <div className="mt-3 flex flex-col gap-2">
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-11 sm:h-9"
                                      disabled={cardBusy}
                                      onClick={() =>
                                        slotPanelOpen
                                          ? closeSlotPanel()
                                          : void openSlotPanel(interview.id)
                                      }
                                      aria-expanded={slotPanelOpen}
                                    >
                                      <CalendarClock className="h-4 w-4" aria-hidden="true" />
                                      {t.status.interview.moveSlot}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-11 border-rose-200 bg-transparent text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:h-9 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                                      disabled={cardBusy}
                                      onClick={() => {
                                        closeSlotPanel();
                                        setCancelOpenFor(cancelConfirmOpen ? null : interview.id);
                                        setCancelError(null);
                                      }}
                                      aria-expanded={cancelConfirmOpen}
                                    >
                                      <XCircle className="h-4 w-4" aria-hidden="true" />
                                      {t.status.interview.cannotAttend}
                                    </Button>
                                  </div>

                                  {slotPanelOpen ? (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                                          {t.status.interview.slotPanelTitle}
                                        </p>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-8 px-2 text-xs text-amber-800 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
                                          disabled={slotsLoading || moveBusy}
                                          onClick={() => void loadOpenSlots()}
                                        >
                                          {slotsLoading ? (
                                            <Loader2
                                              className="h-3.5 w-3.5 animate-spin"
                                              aria-hidden="true"
                                            />
                                          ) : (
                                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                                          )}
                                          {t.status.interview.reload}
                                        </Button>
                                      </div>

                                      {slotsError ? (
                                        <div
                                          role="alert"
                                          className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                                        >
                                          {slotsError}
                                        </div>
                                      ) : null}

                                      {slotsLoading ? (
                                        <p className="mt-2 flex items-center gap-2 text-xs text-amber-800/85 dark:text-amber-200/80">
                                          <Loader2
                                            className="h-3.5 w-3.5 animate-spin"
                                            aria-hidden="true"
                                          />
                                          {t.status.interview.loadingSlots}
                                        </p>
                                      ) : !slotsError && slotsList.length === 0 ? (
                                        <p className="mt-2 text-xs text-amber-800/85 dark:text-amber-200/80">
                                          {t.status.interview.noSlots}
                                        </p>
                                      ) : null}

                                      {slotsList.length > 0 ? (
                                        <div className="nice-scrollbar mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
                                          {slotsList.map((slot) => {
                                            const confirming = pendingSlotId === slot.id;
                                            const slotOnline = slot.mode === "ONLINE";
                                            return (
                                              <div
                                                key={slot.id}
                                                className="rounded-md border border-amber-200/80 bg-background/70 p-2.5 dark:border-amber-500/20"
                                              >
                                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                                    {slotOnline ? (
                                                      <Video className="h-3.5 w-3.5" aria-hidden="true" />
                                                    ) : (
                                                      <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                                                    )}
                                                  </span>
                                                  <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-medium">
                                                      {formatDateTimeId(slot.scheduledAt)}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                      {fillTemplate(t.status.interview.durationValue, {
                                                        n: slot.durationMin,
                                                      })}
                                                      · {PLATFORM_LABELS[slot.platform]}
                                                      {slot.interviewers.length > 0
                                                        ? ` · ${slot.interviewers.join(", ")}`
                                                        : ""}
                                                      {!slotOnline && slot.address
                                                        ? ` · ${slot.address}`
                                                        : ""}
                                                    </p>
                                                  </div>
                                                  {!confirming ? (
                                                    <Button
                                                      variant="outline"
                                                      size="sm"
                                                      className="h-11 sm:h-8"
                                                      disabled={moveBusy || pendingSlotId !== null}
                                                      onClick={() => setPendingSlotId(slot.id)}
                                                    >
                                                      <CalendarClock
                                                        className="h-4 w-4"
                                                        aria-hidden="true"
                                                      />
                                                      {t.status.interview.moveToHere}
                                                    </Button>
                                                  ) : null}
                                                </div>
                                                {confirming ? (
                                                  <div className="mt-2 rounded-md border border-amber-300/80 bg-amber-50 p-2.5 dark:border-amber-500/40 dark:bg-amber-500/10">
                                                    <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                                                      {fillTemplate(t.status.interview.moveConfirm, {
                                                        time: formatDateTimeId(slot.scheduledAt),
                                                      })}
                                                    </p>
                                                    <div className="mt-2 flex flex-wrap gap-2">
                                                      <Button
                                                        size="sm"
                                                        className="h-11 sm:h-8"
                                                        disabled={moveBusy}
                                                        onClick={() =>
                                                          void moveInterviewToSlot(
                                                            interview.id,
                                                            slot.id,
                                                          )
                                                        }
                                                      >
                                                        {moveBusy ? (
                                                          <Loader2
                                                            className="h-4 w-4 animate-spin"
                                                            aria-hidden="true"
                                                          />
                                                        ) : (
                                                          <CheckCircle2
                                                            className="h-4 w-4"
                                                            aria-hidden="true"
                                                          />
                                                        )}
                                                        {t.status.interview.moveYes}
                                                      </Button>
                                                      <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-11 sm:h-8"
                                                        disabled={moveBusy}
                                                        onClick={() => setPendingSlotId(null)}
                                                      >
                                                        {t.status.formCancel}
                                                      </Button>
                                                    </div>
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : null}

                                      {!slotsError && slotsList.length > 0 ? (
                                        <p className="mt-2 text-[11px] leading-relaxed text-amber-800/70 dark:text-amber-200/70">
                                          {t.status.interview.slotsNote}
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : null}

                                  {cancelConfirmOpen ? (
                                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                                      <p className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                                        {t.status.interview.cancelConfirmTitle}
                                      </p>
                                      <p className="mt-1 text-xs leading-relaxed text-rose-800/90 dark:text-rose-200/80">
                                        {fillTemplate(t.status.interview.cancelConfirmDesc, {
                                          n: String(interview.round),
                                          time: formatDateTimeId(interview.scheduledAt),
                                        })}
                                      </p>
                                      {cancelError ? (
                                        <div
                                          role="alert"
                                          className="mt-2 rounded-md border border-rose-200 bg-background/70 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:text-rose-300"
                                        >
                                          {cancelError}
                                        </div>
                                      ) : null}
                                      <div className="mt-2 flex flex-wrap gap-2">
                                        <Button
                                          size="sm"
                                          className="h-11 bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
                                          disabled={cardBusy}
                                          onClick={() => void cancelAttendance(interview.id)}
                                        >
                                          {isInterviewBusy(interview.id, "CANCEL_ATTENDANCE") ? (
                                            <Loader2
                                              className="h-4 w-4 animate-spin"
                                              aria-hidden="true"
                                            />
                                          ) : (
                                            <XCircle className="h-4 w-4" aria-hidden="true" />
                                          )}
                                          {t.status.interview.cancelYes}
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="h-11 sm:h-9"
                                          disabled={cardBusy}
                                          onClick={() => {
                                            setCancelOpenFor(null);
                                            setCancelError(null);
                                          }}
                                        >
                                          {t.status.formCancel}
                                        </Button>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
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
                        {t.status.interview.slotBookTitle}
                      </p>
                      <p className="mt-1 text-sm text-amber-800/85 dark:text-amber-200/80">
                        {t.status.interview.slotBookDesc}
                      </p>
                      <div className="nice-scrollbar mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto">
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
                                  {fillTemplate(t.status.interview.durationValue, {
                                    n: slot.durationMin,
                                  })}{" "}
                                  · {PLATFORM_LABELS[slot.platform]}
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
                                aria-label={fillTemplate(t.status.interview.pickSlotAria, {
                                  time: formatDateTimeId(slot.scheduledAt),
                                })}
                              >
                                {busy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                ) : (
                                  <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                                )}
                                {t.status.interview.pickSlot}
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
                        {detail.rejectionReason === "MENARIK_DIRI"
                          ? p.statusWithdrawn
                          : t.status.rejected}
                      </p>
                      {detail.rejection?.reasonLabel &&
                      detail.rejectionReason !== "MENARIK_DIRI" ? (
                        <p className="pl-8 text-rose-700/90 dark:text-rose-300/90">
                          {t.status.rejectedDetail.reasonLabel}: {detail.rejection.reasonLabel}
                        </p>
                      ) : null}
                      {detail.rejection?.note && detail.rejectionReason !== "MENARIK_DIRI" ? (
                        <div className="ml-8 rounded-lg border border-rose-200/80 bg-background/60 px-3 py-2 dark:border-rose-500/20">
                          <p className="font-medium text-rose-700 dark:text-rose-300">
                            {t.status.rejectedDetail.feedback}:
                          </p>
                          <p className="mt-1 whitespace-pre-line leading-relaxed text-rose-700/90 dark:text-rose-300/90">
                            {detail.rejection.note}
                          </p>
                        </div>
                      ) : null}
                      <div className="pl-8">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 border-rose-300 bg-transparent text-rose-700 hover:bg-rose-100 hover:text-rose-800 sm:h-9 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                          onClick={goBrowseJobs}
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          {t.status.rejectedDetail.otherPositions}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </motion.div>
              ) : detail && !detail.found ? (
                /* Pasangan sesi tidak valid lagi (lamaran dihapus dsb.) — minta login ulang */
                <Card className="rounded-2xl p-8 text-center">
                  <p className="text-sm text-muted-foreground">{p.authFailed}</p>
                  <Button className="mt-4 h-11" onClick={logout}>
                    {p.login}
                  </Button>
                </Card>
              ) : null}
            </div>
          )}
        </Container>
      </main>
    </div>
  );
}

/**
 * FadeIn lokal: slide lembut untuk kartu login (varian ringan dari primitives
 * tanpa IntersectionObserver — halaman status memakai mount-effect scrollTo).
 */
function FadeInSlide({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
