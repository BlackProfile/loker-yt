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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgeCheck,
  BadgeX,
  CalendarCheck,
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
  FileUp,
  HelpCircle,
  KeyRound,
  Link2,
  Loader2,
  LogOut,
  Mail,
  MapPin,
  MessageCircle,
  Printer,
  RefreshCw,
  Send,
  Sparkles,
  Star,
  Upload,
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
  type TrackChangeInfo,
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
import type { Dict, Lang } from "@/components/landing/strings";
import { useLiveEvent } from "@/lib/live-client";

// Debounce recheck realtime — endpoint track punya throttle (min. ~0,4 detik).
const LIVE_RECHECK_DEBOUNCE_MS = 1000;
// Jeda recheck setelah aksi sukses agar tidak menabrak throttle endpoint.
const ACTION_RECHECK_DELAY_MS = 1100;

const DAY_MS = 86_400_000;

// Batas ukuran unggah CV (PDF) — sama dengan validasi server /api/public/cv/update.
const CV_MAX_BYTES = 10 * 1024 * 1024;
// Batas panjang teks pertanyaan pelamar — sama dengan /api/public/question.
const QUESTION_MAX_LENGTH = 500;

/**
 * Peta "terakhir dilihat" lengkap dari localStorage — key sama dengan SEEN_KEY
 * di src/lib/status-session.ts (file lib tidak diubah, hanya nilainya dibaca).
 * Dipakai untuk header "x-lumina-seen" saat login track-auth: server menghitung
 * "Apa yang Berubah" per kode sejak epoch ms yang dikirim (kode tanpa nilai / 0
 * diabaikan server, jadi aman mengirim seluruh peta yang tersimpan).
 */
const SEEN_STORAGE_KEY = "lumina.status.seen";
function readAllSeen(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

// Format tanggal ringkas timeline (NR-15 idea 1): "12 Mei" / "12 May",
// versi berjam untuk kejadian dalam 24 jam terakhir.
const SHORT_DATE_FMT: Record<Lang, Intl.DateTimeFormat> = {
  id: new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }),
  en: new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }),
};
const SHORT_DATETIME_FMT: Record<Lang, Intl.DateTimeFormat> = {
  id: new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
  en: new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }),
};

/** Tanggal ringkas; menyertakan jam bila kejadiannya dalam 24 jam terakhir. */
function formatShortDate(iso: string, lang: Lang, nowMs: number): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const age = nowMs - ms;
  const fmt = age >= 0 && age < DAY_MS ? SHORT_DATETIME_FMT[lang] : SHORT_DATE_FMT[lang];
  return fmt.format(new Date(iso));
}

/** Tanggal panjang mengikuti bahasa aktif (kartu tanggal mulai & surat offer). */
function formatLongDate(iso: string, lang: Lang): string {
  try {
    return new Intl.DateTimeFormat(lang === "en" ? "en-US" : "id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Waktu relatif ringkas untuk daftar "Apa yang Berubah". */
function relativeTime(iso: string, nowMs: number, page: Dict["status"]["page"]): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Math.max(0, nowMs - ms);
  if (diff < 60_000) return page.relNow;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return fillTemplate(page.relMin, { n: minutes });
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return fillTemplate(page.relHour, { n: hours });
  return fillTemplate(page.relDay, { n: Math.floor(diff / DAY_MS) });
}

/** Palet confetti perayaan diterima (NR-15 idea 16) — tanpa biru/ungu, tanpa emoji. */
const CONFETTI_COLORS = ["#f43f5e", "#fbbf24", "#10b981", "#18181b"];

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

export function StatusPageView({
  onExit,
  initialCode,
}: {
  onExit: () => void;
  initialCode?: string | null;
}) {
  return (
    <LangProvider>
      <StatusPageInner onExit={onExit} initialCode={initialCode ?? null} />
    </LangProvider>
  );
}

function StatusPageInner({
  onExit,
  initialCode,
}: {
  onExit: () => void;
  initialCode: string | null;
}) {
  const { t, lang } = useLang();
  const p = t.status.page;

  // ---------- Sesi & boot ----------
  const [booting, setBooting] = useState(true);
  const [session, setSession] = useState<{ email: string; code: string } | null>(null);

  // ---------- Form login ----------
  const [loginEmail, setLoginEmail] = useState("");
  // Prefill kode dari tautan berbagi "#status?code=XXX" (hanya relevan bila belum ada sesi —
  // form login memang hanya tampil saat tidak ada sesi).
  const [loginCode, setLoginCode] = useState(initialCode ? initialCode.toUpperCase() : "");
  const initialCodeRef = useRef(initialCode);
  initialCodeRef.current = initialCode;
  const [showCode, setShowCode] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // ---------- Daftar lamaran & detail ----------
  const [apps, setApps] = useState<TrackSummary[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrackResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ---------- NR-15-c: "Apa yang Berubah" sejak kunjungan terakhir ----------
  const [recentChanges, setRecentChanges] = useState<TrackChangeInfo[]>([]);

  // ---------- NR-15-c: catatan tahap timeline (satu terbuka pada satu waktu) ----------
  const [openNoteKey, setOpenNoteKey] = useState<string | null>(null);

  // ---------- NR-15-c: tanya tim rekrutmen ----------
  const [qaText, setQaText] = useState("");
  const [qaBusy, setQaBusy] = useState(false);

  // ---------- NR-15-c: perbarui CV ----------
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [cvUploading, setCvUploading] = useState(false);

  // ---------- NR-15-c: overlay cetak surat offer ----------
  const [letterOpen, setLetterOpen] = useState(false);

  // ---------- NR-15-c: konfirmasi tanggal mulai ----------
  const [startBusy, setStartBusy] = useState<"confirm" | "propose" | null>(null);
  const [startProposeOpen, setStartProposeOpen] = useState(false);
  const [startDateValue, setStartDateValue] = useState("");
  const [startNoteValue, setStartNoteValue] = useState("");

  // ---------- NR-15-c: perayaan diterima (confetti sekali per kode per sesi) ----------
  const [celebrate, setCelebrate] = useState(false);
  const celebratedCodesRef = useRef<Set<string>>(new Set());

  // ---------- NR-15-c: kirim ulang kode (form bantuan login) ----------
  const [resendEmail, setResendEmail] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const [resendMsg, setResendMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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
    setLoginCode(initialCodeRef.current ? initialCodeRef.current.toUpperCase() : "");
    setLoginError(null);
    setRecentChanges([]);
    setOpenNoteKey(null);
    setQaText("");
    setCvFile(null);
    setLetterOpen(false);
    setStartProposeOpen(false);
    setStartDateValue("");
    setStartNoteValue("");
    setResendMsg(null);
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
        // NR-15 (idea 16): confetti perayaan saat pelamar melihat status Diterima
        // untuk pertama kalinya (sekali per kode per sesi — recheck senyap tidak
        // melewati loadDetail, jadi tidak memicu ulang).
        if (data.status === "ACCEPTED" && !celebratedCodesRef.current.has(code)) {
          celebratedCodesRef.current.add(code);
          setCelebrate(true);
          window.setTimeout(() => setCelebrate(false), 2600);
        }
      } catch {
        toast.error(t.apply.errors.submitFailed);
      } finally {
        setDetailLoading(false);
      }
    },
    [p.authFailed, resetToLogin, t.apply.errors.submitFailed, t.status.rateLimited],
  );

  /**
   * Login / verifikasi sesi: cocokkan email+kode, ambil daftar lamaran email tsb.
   * NR-15 (idea 4): kirim header "x-lumina-seen" berisi peta terakhir-dilihat
   * agar respons menyertakan ringkasan "Apa yang Berubah" per kode sejak
   * kunjungan terakhir pelamar.
   */
  const authenticate = useCallback(
    async (
      email: string,
      code: string,
    ): Promise<{
      apps: TrackSummary[];
      changes: Record<string, TrackChangeInfo[]>;
    } | null> => {
      try {
        const res = await fetch("/api/public/track-auth", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-lumina-seen": JSON.stringify(readAllSeen()),
          },
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
        return {
          apps: data.applications.filter((app) => app.trackingCode),
          changes: data.changes ?? {},
        };
      } catch {
        setLoginError(t.status.actionFailed);
        return null;
      }
    },
    [p.authFailed, p.locked, p.tooFast, t.status.actionFailed],
  );

  /**
   * Susun daftar perubahan lintas lamaran (terbaru di atas) untuk panel
   * "Apa yang Berubah" — hanya kode dengan perubahan non-kosong.
   */
  function collectChanges(
    list: TrackSummary[],
    changes: Record<string, TrackChangeInfo[]>,
  ): TrackChangeInfo[] {
    const items: TrackChangeInfo[] = [];
    for (const app of list) {
      const perCode = changes[app.trackingCode];
      if (Array.isArray(perCode)) items.push(...perCode);
    }
    items.sort((a, b) => b.at.localeCompare(a.at));
    return items;
  }

  /** Tutup panel "Apa yang Berubah" + tandai semua lamaran sudah dilihat. */
  function dismissChanges() {
    setRecentChanges([]);
    for (const app of apps) markSeen(app.trackingCode);
    if (selectedCode) markSeen(selectedCode);
  }

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
      // Reset panel NR-15-c agar keadaan tidak bocor antar lamaran.
      setOpenNoteKey(null);
      setQaText("");
      setCvFile(null);
      setStartProposeOpen(false);
      setStartDateValue("");
      setStartNoteValue("");
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
      const auth = await authenticate(stored.email, stored.code);
      if (cancelled) return;
      if (!auth || auth.apps.length === 0) {
        clearSession();
        setBooting(false);
        return;
      }
      setSession({ email: stored.email, code: stored.code });
      setApps(auth.apps);
      // NR-15 (idea 4): ringkasan "Apa yang Berubah" sejak kunjungan terakhir.
      setRecentChanges(collectChanges(auth.apps, auth.changes));
      // Badge pembaruan sejak kunjungan terakhir (sebelum seen diperbarui).
      const hasUpdate = auth.apps.some(
        (app) => new Date(app.statusUpdatedAt).getTime() > loadSeenAt(app.trackingCode),
      );
      if (hasUpdate) toast.info(p.updatedBadge);
      setBooting(false);
      const preferred =
        auth.apps.find((app) => app.trackingCode === stored.code)?.trackingCode ??
        auth.apps[0]?.trackingCode ??
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
    const auth = await authenticate(email, code);
    setLoginBusy(false);
    if (!auth || auth.apps.length === 0) return;
    saveSession({ email, code }, remember);
    setSession({ email, code });
    setApps(auth.apps);
    setRecentChanges(collectChanges(auth.apps, auth.changes));
    const preferred =
      auth.apps.find((app) => app.trackingCode === code)?.trackingCode ??
      auth.apps[0]?.trackingCode ??
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

  /**
   * Salin tautan halaman status lamaran aktif (NR-15 idea 9) — dibuka di perangkat
   * lain, form login terisi kode otomatis lewat "#status?code=XXX".
   */
  async function copyStatusLink() {
    if (!selectedCode) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/#status?code=${encodeURIComponent(selectedCode)}`,
      );
      toast.success(p.copyLinkToast);
    } catch {
      toast.error(t.positions.salinGagal);
    }
  }

  /** Kirim pertanyaan pelamar ke tim rekrutmen (NR-15 idea 10). */
  async function submitQuestion() {
    const text = qaText.trim();
    if (!session || !selectedCode || !text || qaBusy) return;
    setQaBusy(true);
    const out = await postAction("/api/public/question", {
      code: selectedCode,
      email: session.email,
      text,
    });
    setQaBusy(false);
    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    toast.success(p.qaToast);
    setQaText("");
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  /** Pilih berkas CV baru (validasi klien: PDF, maks 10 MB). */
  function selectCvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = ""; // reset agar file yang sama bisa dipilih ulang
    if (!file) return;
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      toast.error(p.cvInvalidType);
      return;
    }
    if (file.size > CV_MAX_BYTES) {
      toast.error(p.cvTooBig);
      return;
    }
    setCvFile(file);
  }

  /** Unggah CV baru (NR-15 idea 11) — server menolak bila lamaran sudah final (409). */
  async function submitCvUpdate() {
    const file = cvFile;
    if (!session || !selectedCode || !file || cvUploading) return;
    setCvUploading(true);
    try {
      const fd = new FormData();
      fd.append("code", selectedCode);
      fd.append("email", session.email);
      fd.append("file", file);
      const res = await fetch("/api/public/cv/update", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: unknown; error?: unknown; fileName?: unknown }
        | null;
      if (res.status === 429) {
        toast.error(t.status.rateLimited);
        return;
      }
      if (res.status === 409) {
        toast.error(p.cvFinal);
        return;
      }
      if (!res.ok || !data || data.ok !== true) {
        const serverError =
          typeof data?.error === "string" && data.error ? data.error : null;
        toast.error(serverError ?? t.status.actionFailed);
        return;
      }
      toast.success(p.cvToast);
      setCvFile(null);
      scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
    } catch {
      toast.error(t.status.actionFailed);
    } finally {
      setCvUploading(false);
    }
  }

  /** Konfirmasi / usul ulang tanggal mulai kerja (NR-15 idea 13). */
  async function submitStartDate(action: "confirm" | "propose") {
    if (!session || !selectedCode || startBusy) return;
    if (action === "propose") {
      const parsed = startDateValue ? new Date(`${startDateValue}T00:00:00`) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        toast.error(t.status.interview.proposedRequired);
        return;
      }
    }
    setStartBusy(action);
    const out = await postAction("/api/public/start-date", {
      code: selectedCode,
      email: session.email,
      action,
      ...(action === "propose"
        ? {
            date: new Date(`${startDateValue}T00:00:00`).toISOString(),
            ...(startNoteValue.trim() ? { note: startNoteValue.trim().slice(0, 300) } : {}),
          }
        : {}),
    });
    setStartBusy(null);
    if (!out.ok) {
      toast.error(out.error);
      return;
    }
    if (action === "confirm") {
      toast.success(p.startDateConfirmToast);
    } else {
      toast.success(p.startDateProposeToast);
      setStartProposeOpen(false);
      setStartDateValue("");
      setStartNoteValue("");
    }
    scheduleSilentRecheck(ACTION_RECHECK_DELAY_MS);
  }

  /**
   * Kirim ulang kode pelacakan ke email (NR-15 idea 8). Respons endpoint selalu
   * generik ({ok:true}) — pesan sukses selalu sama tanpa membocorkan keberadaan
   * email; hanya kegagalan jaringan yang ditampilkan sebagai error.
   */
  async function submitResendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = resendEmail.trim().toLowerCase();
    if (!email || resendBusy) return;
    setResendBusy(true);
    setResendMsg(null);
    try {
      await fetch("/api/public/resend-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResendMsg({ type: "ok", text: p.resendOk });
    } catch {
      setResendMsg({ type: "err", text: p.resendFail });
    } finally {
      setResendBusy(false);
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
      const auth = await authenticate(session.email, session.code);
      if (auth) setApps(auth.apps);
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
  const nowMs = Date.now();
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
  // NR-15 (idea 1): peta tahap → tanggal dari stageHistory (match by key).
  const stageHistoryAt: Record<string, string> = {};
  for (const item of detail?.stageHistory ?? []) {
    if (item?.key && item.at) stageHistoryAt[item.key] = item.at;
  }
  // NR-15 (idea 10): pertanyaan pelamar — terbaru di atas.
  const questions = [...(detail?.questions ?? [])].sort((a, b) =>
    b.askedAt.localeCompare(a.askedAt),
  );
  // NR-15 (idea 13): tanggal mulai kerja (ada bila status diterima).
  const candidateStart = detail?.candidateStart ?? null;
  // NR-15 (idea 3): estimasi hari di tahap aktif (median historis).
  const currentEstimateRaw =
    currentKey && detail?.stageEstimates ? detail.stageEstimates[currentKey] : undefined;
  const currentEstimateDays =
    typeof currentEstimateRaw === "number" && Number.isFinite(currentEstimateRaw)
      ? Math.max(1, Math.round(currentEstimateRaw))
      : null;
  // NR-15 (idea 16): partikel confetti stabil selama animasi (useMemo per burst).
  const confettiParticles = useMemo(() => {
    if (!celebrate) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: `${Math.round(((i * 97) % 100) + Math.random() * 4)}%`,
      size: 6 + Math.random() * 7,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.round(Math.random() * 40) / 100,
      spin: 360 + Math.round(Math.random() * 360),
      drift: Math.round((Math.random() - 0.5) * 120),
    }));
  }, [celebrate]);

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
    <>
    <div className="flex min-h-screen flex-col bg-background print:hidden">
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
                    {/* NR-15 (idea 8): kirim ulang kode ke email */}
                    <form
                      className="mt-3 border-t pt-3"
                      onSubmit={submitResendCode}
                    >
                      <Label htmlFor="resend-email" className="text-sm font-medium">
                        {p.emailLabel}
                      </Label>
                      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                        <Input
                          id="resend-email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          value={resendEmail}
                          onChange={(e) => setResendEmail(e.target.value)}
                          placeholder={p.emailPh}
                          className="h-11 flex-1"
                          maxLength={120}
                          required
                        />
                        <Button
                          type="submit"
                          variant="outline"
                          className="h-11 shrink-0 gap-2"
                          disabled={resendBusy || !resendEmail.trim()}
                        >
                          {resendBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Mail className="h-4 w-4" aria-hidden="true" />
                          )}
                          {resendBusy ? p.resendSending : p.resendBtn}
                        </Button>
                      </div>
                      {resendMsg ? (
                        <div
                          role={resendMsg.type === "err" ? "alert" : "status"}
                          className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                            resendMsg.type === "ok"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                              : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                          }`}
                        >
                          {resendMsg.text}
                        </div>
                      ) : null}
                    </form>
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
              {/* ---------- NR-15 (idea 4): panel "Apa yang Berubah" sejak kunjungan terakhir ---------- */}
              {recentChanges.length > 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-950/40">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
                      {p.changesTitle}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 sm:h-9 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
                      onClick={dismissChanges}
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {p.changesMarkRead}
                    </Button>
                  </div>
                  <ul className="mt-3 flex flex-col gap-2">
                    {recentChanges.slice(0, 10).map((change, index) => (
                      <li
                        key={`${change.at}-${index}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-amber-200/70 bg-background/60 px-3 py-2 dark:border-amber-500/20"
                      >
                        <span className="text-sm text-amber-900 dark:text-amber-100">
                          {change.text}
                        </span>
                        <span className="shrink-0 text-xs text-amber-700/80 dark:text-amber-300/70">
                          {relativeTime(change.at, nowMs, p)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

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
                  {/* HERO status berwarna (+ confetti perayaan diterima, NR-15 idea 16) */}
                  <Card className="relative overflow-hidden rounded-2xl p-5 md:p-6">
                    {celebrate && confettiParticles.length > 0 ? (
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
                      >
                        {confettiParticles.map((particle) => (
                          <motion.span
                            key={particle.id}
                            className="absolute top-0 block rounded-[2px]"
                            style={{
                              left: particle.left,
                              width: particle.size,
                              height: particle.size * 0.6,
                              backgroundColor: particle.color,
                            }}
                            initial={{ y: -24, x: 0, rotate: 0, opacity: 1 }}
                            animate={{ y: 360, x: particle.drift, rotate: particle.spin, opacity: 0 }}
                            transition={{
                              duration: 2.2,
                              delay: particle.delay,
                              ease: "easeIn",
                            }}
                          />
                        ))}
                      </div>
                    ) : null}
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
                        <div className="inline-flex items-center">
                          <button
                            type="button"
                            onClick={() => void copyCode()}
                            className="inline-flex h-8 items-center gap-1.5 rounded-l-md border px-2.5 font-mono text-xs font-medium hover:bg-muted"
                            aria-label={p.copyCodeAria}
                            title={p.copyCode}
                          >
                            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                            {selectedCode}
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyStatusLink()}
                            className="inline-flex h-8 items-center rounded-r-md border border-l-0 px-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label={p.copyLinkAria}
                            title={p.copyLink}
                          >
                            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
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
                        // NR-15 (idea 1): tanggal tahap dari stageHistory (match by key).
                        const stepDateIso = stageHistoryAt[step.key] ?? step.at ?? null;
                        // NR-15 (idea 2): penjelasan tahap (default collapsed, satu terbuka).
                        const noteText = detail?.stageNote?.[step.key] ?? null;
                        const noteOpen = openNoteKey === step.key;
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
                                {/* NR-15 (idea 3): estimasi hari di tahap aktif (hanya current step) */}
                                {isCurrent && currentEstimateDays !== null ? (
                                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                    <Clock className="h-3 w-3" aria-hidden="true" />
                                    {fillTemplate(p.estimateChip, { n: currentEstimateDays })}
                                  </span>
                                ) : null}
                              </div>
                              {step.done && stepDateIso ? (
                                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                  {formatShortDate(stepDateIso, lang, nowMs)}
                                </p>
                              ) : stepDateIso && isCurrent ? (
                                <p className="text-xs text-muted-foreground">
                                  {formatDateTimeId(stepDateIso)}
                                </p>
                              ) : null}
                              {/* NR-15 (idea 2): tombol expandable "Apa yang terjadi di tahap ini?" */}
                              {noteText ? (
                                <div className="mt-1.5">
                                  <button
                                    type="button"
                                    onClick={() => setOpenNoteKey(noteOpen ? null : step.key)}
                                    aria-expanded={noteOpen}
                                    className="group inline-flex min-h-11 items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:min-h-0"
                                  >
                                    <ChevronDown
                                      className={`h-3.5 w-3.5 transition-transform ${
                                        noteOpen ? "rotate-180" : ""
                                      }`}
                                      aria-hidden="true"
                                    />
                                    {p.stageNoteHint}
                                  </button>
                                  {noteOpen ? (
                                    <p className="mt-1.5 max-w-md rounded-lg border bg-muted/40 p-2.5 text-xs leading-relaxed text-muted-foreground">
                                      {noteText}
                                    </p>
                                  ) : null}
                                </div>
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

                          {/* NR-15 (idea 12): unduh / cetak surat offer */}
                          <div className="mt-3 border-t border-emerald-200/70 pt-3 dark:border-emerald-500/20">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 sm:h-9"
                              onClick={() => setLetterOpen(true)}
                            >
                              <Download className="h-4 w-4" aria-hidden="true" />
                              {p.letterDownload}
                            </Button>
                          </div>
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
                          <div className="mt-3 pl-8">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 sm:h-9"
                              onClick={() => setLetterOpen(true)}
                            >
                              <Download className="h-4 w-4" aria-hidden="true" />
                              {p.letterDownload}
                            </Button>
                          </div>
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

                  {/* NR-15 (idea 13): kartu Tanggal Mulai — hanya bila status diterima */}
                  {candidateStart ? (
                    <Card className="rounded-2xl p-5 md:p-6">
                      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                        {p.startDateTitle}
                      </p>
                      {candidateStart.startDate ? (
                        <p className="mt-2 text-sm">
                          <span className="text-muted-foreground">{p.startDateLabel}: </span>
                          <span className="font-medium">
                            {formatLongDate(candidateStart.startDate, lang)}
                          </span>
                        </p>
                      ) : null}
                      {candidateStart.confirmedAt ? (
                        <p className="mt-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {fillTemplate(p.startDateConfirmed, {
                              date: formatLongDate(candidateStart.startDate ?? candidateStart.confirmedAt, lang),
                            })}
                          </span>
                        </p>
                      ) : candidateStart.proposedAt ? (
                        <div className="mt-3 flex flex-col gap-1.5">
                          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                            {fillTemplate(p.startDateProposed, {
                              date: formatLongDate(candidateStart.proposedAt, lang),
                            })}
                          </span>
                          {candidateStart.note ? (
                            <p className="whitespace-pre-line text-xs text-muted-foreground">
                              {candidateStart.note}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 sm:h-9"
                              disabled={startBusy !== null}
                              onClick={() => void submitStartDate("confirm")}
                            >
                              {startBusy === "confirm" ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <CalendarCheck className="h-4 w-4" aria-hidden="true" />
                              )}
                              {p.startDateConfirmBtn}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 sm:h-9"
                              disabled={startBusy !== null}
                              onClick={() => setStartProposeOpen((prev) => !prev)}
                              aria-expanded={startProposeOpen}
                            >
                              <CalendarClock className="h-4 w-4" aria-hidden="true" />
                              {p.startDateProposeToggle}
                            </Button>
                          </div>
                          {startProposeOpen ? (
                            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                              <Label
                                htmlFor="start-propose-date"
                                className="text-xs font-medium text-amber-800 dark:text-amber-300"
                              >
                                {p.startDateProposeDateLabel}
                              </Label>
                              <Input
                                id="start-propose-date"
                                type="date"
                                value={startDateValue}
                                onChange={(e) => setStartDateValue(e.target.value)}
                                className="mt-1 h-11 bg-background sm:h-9"
                              />
                              <Label
                                htmlFor="start-propose-note"
                                className="mt-2 text-xs font-medium text-amber-800 dark:text-amber-300"
                              >
                                {p.startDateProposeNoteLabel}
                              </Label>
                              <Textarea
                                id="start-propose-note"
                                rows={2}
                                value={startNoteValue}
                                onChange={(e) => setStartNoteValue(e.target.value)}
                                placeholder={p.startDateProposeNotePh}
                                maxLength={300}
                                className="mt-1 bg-background text-sm"
                              />
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  className="h-11 sm:h-9"
                                  disabled={startBusy !== null || !startDateValue}
                                  onClick={() => void submitStartDate("propose")}
                                >
                                  {startBusy === "propose" ? (
                                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Send className="h-4 w-4" aria-hidden="true" />
                                  )}
                                  {p.startDateProposeSend}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-11 sm:h-9"
                                  disabled={startBusy !== null}
                                  onClick={() => setStartProposeOpen(false)}
                                >
                                  {t.status.formCancel}
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}
                    </Card>
                  ) : null}

                  {/* NR-15 (idea 11): panel Perbarui CV — tersembunyi bila lamaran final */}
                  {detail && !finalStatus ? (
                    <Card className="rounded-2xl p-5 md:p-6">
                      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        <FileUp className="h-4 w-4" aria-hidden="true" />
                        {p.cvTitle}
                      </p>
                      {detail.cvFileName ? (
                        <p className="mt-2 text-sm">
                          <span className="text-muted-foreground">
                            {fillTemplate(p.cvCurrent, { name: detail.cvFileName })}
                          </span>
                        </p>
                      ) : (
                        <p className="mt-2 text-sm text-muted-foreground">{p.cvNone}</p>
                      )}
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          type="file"
                          accept=".pdf,application/pdf"
                          aria-label={p.cvAria}
                          disabled={cvUploading}
                          className="h-11 w-full text-xs sm:max-w-xs"
                          onChange={selectCvFile}
                        />
                        <Button
                          size="sm"
                          className="h-11 sm:h-9"
                          disabled={!cvFile || cvUploading}
                          onClick={() => void submitCvUpdate()}
                        >
                          {cvUploading ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                              {p.cvUploading}
                            </>
                          ) : (
                            <>
                              <Upload className="h-4 w-4" aria-hidden="true" />
                              {p.cvUpload}
                            </>
                          )}
                        </Button>
                      </div>
                      {cvFile ? (
                        <p className="mt-2 text-xs text-muted-foreground">{cvFile.name}</p>
                      ) : null}
                    </Card>
                  ) : null}

                  {/* NR-15 (idea 10): panel Tanya Tim Rekrutmen — disembunyikan bila final ditolak/ditarik */}
                  {detail && finalStatus !== "REJECTED" ? (
                    <Card className="rounded-2xl p-5 md:p-6">
                      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        <MessageCircle className="h-4 w-4" aria-hidden="true" />
                        {p.qaTitle}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">{p.qaDesc}</p>

                      {/* Thread pertanyaan-jawaban (terbaru di atas) */}
                      {questions.length > 0 ? (
                        <ul className="nice-scrollbar mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
                          {questions.map((item) => (
                            <li
                              key={item.id}
                              className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-500/30 dark:bg-zinc-500/5"
                            >
                              <p className="text-xs font-medium text-muted-foreground">
                                {p.qaYou} · {formatDateTimeId(item.askedAt)}
                              </p>
                              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">
                                {item.question}
                              </p>
                              {item.answer ? (
                                <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                    {p.qaTeam}
                                    {item.answeredAt
                                      ? ` · ${formatDateTimeId(item.answeredAt)}`
                                      : ""}
                                  </p>
                                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
                                    {item.answer}
                                  </p>
                                </div>
                              ) : (
                                <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                                  <Clock className="h-3 w-3" aria-hidden="true" />
                                  {p.qaPending}
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 text-sm text-muted-foreground">{p.qaEmpty}</p>
                      )}

                      {/* Form pertanyaan baru */}
                      <form
                        className="mt-4 border-t pt-4"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void submitQuestion();
                        }}
                      >
                        <Label htmlFor="qa-new-question" className="text-sm font-medium">
                          {p.qaFormLabel}
                        </Label>
                        <Textarea
                          id="qa-new-question"
                          rows={3}
                          value={qaText}
                          onChange={(e) => setQaText(e.target.value)}
                          placeholder={p.qaPh}
                          maxLength={QUESTION_MAX_LENGTH}
                          className="mt-1.5"
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">
                            {fillTemplate(p.qaCounter, {
                              used: qaText.length,
                              max: QUESTION_MAX_LENGTH,
                            })}
                          </span>
                          <Button
                            type="submit"
                            size="sm"
                            className="h-11 sm:h-9"
                            disabled={qaBusy || !qaText.trim()}
                          >
                            {qaBusy ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                {p.qaSending}
                              </>
                            ) : (
                              <>
                                <Send className="h-4 w-4" aria-hidden="true" />
                                {p.qaSend}
                              </>
                            )}
                          </Button>
                        </div>
                      </form>
                    </Card>
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

                  {/* NR-15 (idea 17): kartu feedback pengalaman — bila ada token survei */}
                  {detail.surveyToken ? (
                    <Card className="rounded-2xl p-5 md:p-6">
                      <p className="flex items-center gap-2 text-sm font-semibold">
                        <Star className="h-4 w-4 text-amber-500" aria-hidden="true" />
                        {p.fbTitle}
                      </p>
                      <p className="mt-1.5 text-sm text-muted-foreground">{p.fbDesc}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-11 sm:h-9"
                        onClick={() =>
                          window.open(
                            `/?survei=${encodeURIComponent(detail.surveyToken ?? "")}`,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        {p.fbButton}
                      </Button>
                    </Card>
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

    {/* NR-15 (idea 12): overlay cetak surat offer — sengaja di luar wrapper utama
        yang print:hidden, sehingga saat mencetak hanya surat yang tampil di kertas. */}
    {letterOpen && offer ? (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={p.letterTitle}
        className="fixed inset-0 z-[60] overflow-y-auto bg-zinc-950/60 p-4 backdrop-blur-sm print:static print:overflow-visible print:bg-transparent print:p-0 print:backdrop-blur-none"
      >
        <div className="mx-auto my-6 w-full max-w-2xl print:my-0">
          <div className="rounded-2xl border bg-white p-6 text-zinc-900 shadow-xl sm:p-8 print:rounded-none print:border-0 print:shadow-none">
            <p className="text-center text-2xl font-bold tracking-tight">Lumina Studio</p>
            <hr className="my-5 border-zinc-300" />
            <p className="text-sm">
              {fillTemplate(p.letterTo, { email: session?.email ?? "-" })}
            </p>
            <h2 className="mt-4 text-lg font-bold">{p.letterTitle}</h2>
            <div className="mt-3 grid gap-1.5 text-sm">
              {detail?.positionTitle ? (
                <p>
                  <span className="text-muted-foreground">{t.status.positionLabel}: </span>
                  <span className="font-medium">{detail.positionTitle}</span>
                </p>
              ) : null}
              {offer.salary ? (
                <p>
                  <span className="text-muted-foreground">{t.status.offer.salary}: </span>
                  <span className="font-medium">{offer.salary}</span>
                </p>
              ) : null}
              {offer.type ? (
                <p>
                  <span className="text-muted-foreground">{t.status.offer.type}: </span>
                  <span className="font-medium">{offer.type}</span>
                </p>
              ) : null}
              {offer.startDate ? (
                <p>
                  <span className="text-muted-foreground">{t.status.offer.start}: </span>
                  <span className="font-medium">{formatLongDate(offer.startDate, lang)}</span>
                </p>
              ) : null}
              {offer.deadline ? (
                <p>
                  <span className="text-muted-foreground">{t.status.offer.deadlineLabel}: </span>
                  <span className="font-medium">{formatDateId(offer.deadline)}</span>
                </p>
              ) : null}
            </div>
            {offer.message ? (
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-700">
                {offer.message}
              </p>
            ) : null}
            <p className="mt-6 text-xs text-zinc-500">
              {fillTemplate(p.letterPrintedOn, {
                date: formatLongDate(new Date().toISOString(), lang),
              })}
            </p>
            <div className="mt-10 max-w-60">
              <div className="h-14 border-b border-zinc-400" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium">{p.letterSignName}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2 print:hidden">
            <Button className="h-11 gap-2" onClick={() => window.print()}>
              <Printer className="h-4 w-4" aria-hidden="true" />
              {p.letterPrint}
            </Button>
            <Button variant="outline" className="h-11 gap-2" onClick={() => setLetterOpen(false)}>
              <X className="h-4 w-4" aria-hidden="true" />
              {p.letterClose}
            </Button>
          </div>
        </div>
      </div>
    ) : null}
    </>
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
