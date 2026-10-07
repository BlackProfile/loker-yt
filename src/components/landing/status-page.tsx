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
//
// NR-18-a: file ini kini orchestrator tipis — memegang seluruh state utama
// (sesi, seen, changes, lamaran terpilih, dst.) dan menyusun komponen daun dari
// folder ./status/ via props eksplisit. Logika & urutan efek dipertahankan
// verbatim; satu-satunya perubahan UI adalah organisasi collapsible (Bagian 2).

import { useCallback, useEffect, useRef, useState, useId } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowLeft,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Download,
  ExternalLink,
  Hourglass,
  IdCard,
  ListChecks,
  Loader2,
  LogOut,
  Reply,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  EMPLOYEE_CARD_STATUS_LABELS,
  STATUS_FLOW,
  STATUS_LABELS,
  type EmployeeCardDto,
  type EmployeeCardStatus,
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toPng } from "html-to-image";
import { EmployeeIdCard } from "@/components/employee-id-card";
import { LangProvider, useLang } from "@/components/landing/lang-context";
import { Container } from "@/components/landing/primitives";
import { fillTemplate, safeExternalUrl } from "@/components/landing/landing-utils";
import { useLiveEvent } from "@/lib/live-client";
import { StatusLoginPanel } from "./status/status-login";
import { RecentChangesPanel } from "./status/status-changes-panel";
import { AppsSwitcher, type StatusChipInfo } from "./status/status-apps-switcher";
import { StatusHero } from "./status/status-hero";
import { StatusTimeline } from "./status/status-timeline";
import { InterviewsSection } from "./status/status-interviews";
import { OfferCard } from "./status/status-offer";
import { OfferLetterOverlay } from "./status/status-offer-letter";
import { StartDateCard } from "./status/status-start-date";
import { CvUpdatePanel } from "./status/status-cv-panel";
import { QaPanel } from "./status/status-qa-panel";
import { OnboardingPanel } from "./status/status-onboarding";
import { AcceptedNotice, RejectedNotice } from "./status/status-final-banners";
import { SurveyCard } from "./status/status-survey-card";
import { FadeInSlide } from "./status/status-shared";
import {
  ACTION_RECHECK_DELAY_MS,
  CV_MAX_BYTES,
  DAY_MS,
  LIVE_RECHECK_DEBOUNCE_MS,
  type StepView,
  isFinalStatus,
  readAllSeen,
} from "./status/status-types";

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
  // NR-41 H17 — unduh salinan data milik pelamar (track-export).
  const [exportBusy, setExportBusy] = useState(false);

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

  async function acceptOffer(signatureName: string) {
    if (!selectedCode) return;
    setOfferBusy("ACCEPT");
    const out = await postAction("/api/public/offer/respond", {
      code: selectedCode,
      action: "ACCEPT",
      // NR-41 K30 — e-signature: nama lengkap yang diketik pelamar.
      signatureName,
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

  /**
   * NR-41 H17 — unduh salinan data pelamar dari /api/public/track-export
   * (kredensial sesi yang sama seperti endpoint track lain: email + kode).
   * Hasil diunduh sebagai file JSON "data-saya.json" (blob + a.download).
   */
  async function downloadMyData() {
    if (!session || !selectedCode || exportBusy) return;
    setExportBusy(true);
    try {
      const params = new URLSearchParams({
        code: selectedCode,
        email: session.email,
      });
      const res = await fetch(`/api/public/track-export?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: unknown }
          | null;
        const serverError =
          data && typeof data.error === "string" && data.error ? data.error : null;
        toast.error(serverError ?? t.status.actionFailed);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "data-saya.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success("Salinan data Anda sedang diunduh.");
    } catch {
      toast.error(t.status.actionFailed);
    } finally {
      setExportBusy(false);
    }
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

  /**
   * Chip status untuk hero & daftar lamaran: warna per kelompok tahap
   * (emerald diterima / rose ditolak / zinc ditarik / amber wawancara / netral lainnya).
   */
  function statusChip(
    status: string | undefined,
    rejectionReason: string | null | undefined,
  ): StatusChipInfo {
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

  /* ---------- PL-2b (butir 14): aksi yang diminta dari pelamar ----------
   * Dihitung murni dari TrackResponse yang sudah ada (tanpa endpoint baru).
   * Panel hanya ringkasan + navigasi — logika aksi asli tidak diubah.
   * Item (e) assignment DILEWATI: TrackResponse tidak menyediakan status
   * pengumpulan tugas, jadi tidak ada penanda yang bisa diandalkan.
   */
  const requiredActions: RequiredActionItem[] = [];
  if (offer && offer.status === "PENDING") {
    const deadlineMs = offer.deadline ? new Date(offer.deadline).getTime() : NaN;
    const deadlineText = Number.isNaN(deadlineMs)
      ? null
      : new Date(offer.deadline as string).toLocaleDateString("id-ID", { dateStyle: "long" });
    requiredActions.push({
      key: "offer-pending",
      tone: "rose",
      icon: Reply,
      text: deadlineText
        ? `Jawab penawaran sebelum ${deadlineText}`
        : "Jawab penawaran yang menunggu respons kamu",
      targetId: "bagian-penawaran",
    });
  }
  const upcomingInterview = interviews
    .filter((iv) => iv.status === "SCHEDULED" && new Date(iv.scheduledAt).getTime() > nowMs)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
  if (upcomingInterview) {
    const when = new Date(upcomingInterview.scheduledAt);
    const dateText = when.toLocaleDateString("id-ID", { dateStyle: "long" });
    const timeText = when.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
    requiredActions.push({
      key: "interview-confirm",
      tone: "amber",
      icon: CalendarClock,
      text: `Konfirmasi kehadiran wawancara ${dateText} pukul ${timeText}`,
      targetId: "bagian-wawancara",
    });
  }
  if (interviews.some((iv) => iv.status === "RESCHEDULE_REQUESTED")) {
    requiredActions.push({
      key: "interview-reschedule",
      tone: "zinc",
      icon: Hourglass,
      text: "Menunggu konfirmasi jadwal baru",
      targetId: "bagian-wawancara",
    });
  }
  const missingDocsCount = onboardingDocs.filter((doc) => doc.required && !doc.done).length;
  if (missingDocsCount > 0) {
    requiredActions.push({
      key: "onboarding-docs",
      tone: "amber",
      icon: Upload,
      text: `Unggah ${missingDocsCount} dokumen onboarding`,
      targetId: "bagian-onboarding",
    });
  }
  if (
    offer?.status === "ACCEPTED" &&
    candidateStart &&
    !candidateStart.confirmedAt &&
    !candidateStart.proposedAt
  ) {
    requiredActions.push({
      key: "start-date",
      tone: "amber",
      icon: CalendarCheck,
      text: "Konfirmasi tanggal mulai kerja",
      targetId: "bagian-tanggal-mulai",
    });
  }

  /** Gulir halus ke bagian aksi terkait; hormati prefers-reduced-motion. */
  function scrollToSection(targetId: string) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

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
              <StatusLoginPanel
                p={p}
                t={t}
                loginEmail={loginEmail}
                onLoginEmailChange={setLoginEmail}
                loginCode={loginCode}
                onLoginCodeChange={setLoginCode}
                showCode={showCode}
                onToggleShowCode={() => setShowCode((prev) => !prev)}
                remember={remember}
                onRememberChange={setRemember}
                loginBusy={loginBusy}
                loginError={loginError}
                onLoginSubmit={handleLogin}
                resendEmail={resendEmail}
                onResendEmailChange={setResendEmail}
                resendBusy={resendBusy}
                resendMsg={resendMsg}
                onResendSubmit={submitResendCode}
                onBrowseJobs={goBrowseJobs}
              />
            </FadeInSlide>
          ) : (
            <div className="flex flex-col gap-6">
              {/* ---------- NR-15 (idea 4): panel "Apa yang Berubah" sejak kunjungan terakhir ---------- */}
              {recentChanges.length > 0 ? (
                <RecentChangesPanel
                  changes={recentChanges}
                  nowMs={nowMs}
                  p={p}
                  onDismiss={dismissChanges}
                />
              ) : null}

              {/* ---------- Daftar multi-lamaran (bila lebih dari satu) ---------- */}
              {apps.length > 1 ? (
                <AppsSwitcher
                  apps={apps}
                  selectedCode={selectedCode}
                  p={p}
                  chipFor={statusChip}
                  onSelectApp={selectApp}
                />
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
                  <StatusHero
                    detail={detail}
                    selectedCode={selectedCode}
                    heroChip={heroChip}
                    celebrate={celebrate}
                    p={p}
                    t={t}
                    onCopyCode={() => void copyCode()}
                    onCopyStatusLink={() => void copyStatusLink()}
                    canWithdraw={canWithdraw}
                    withdrawOpen={withdrawOpen}
                    setWithdrawOpen={setWithdrawOpen}
                    withdrawReason={withdrawReason}
                    setWithdrawReason={setWithdrawReason}
                    withdrawBusy={withdrawBusy}
                    onWithdraw={() => void withdrawApplication()}
                  />

                  {/* PL-2b (butir 14): ringkasan aksi yang diminta dari pelamar —
                      hanya dirender bila ada >= 1 aksi, murni ringkasan + navigasi */}
                  {requiredActions.length > 0 ? (
                    <RequiredActionsPanel
                      actions={requiredActions}
                      onGoTo={(targetId) => scrollToSection(targetId)}
                    />
                  ) : null}

                  {/* Timeline progres (stepper vertikal penuh) */}
                  <StatusTimeline
                    steps={steps}
                    currentKey={currentKey}
                    stageHistoryAt={stageHistoryAt}
                    stageNote={detail.stageNote}
                    openNoteKey={openNoteKey}
                    setOpenNoteKey={setOpenNoteKey}
                    currentEstimateDays={currentEstimateDays}
                    nowMs={nowMs}
                    lang={lang}
                    p={p}
                  />

                  {/* Info tes seleksi posisi (bila posisi punya assignment) */}
                  {detail.assignment &&
                  (detail.assignment.title || detail.assignment.note || detail.assignment.url) ? (
                    <div id="bagian-tes-seleksi" className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
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

                  {/* Jadwal wawancara + slot self-service */}
                  <div id="bagian-wawancara">
                    <InterviewsSection
                    t={t}
                    detail={detail}
                    selectedCode={selectedCode}
                    interviews={interviews}
                    availableSlots={availableSlots}
                    finalStatus={finalStatus}
                    interviewBusy={interviewBusy}
                    isInterviewBusy={isInterviewBusy}
                    rescheduleFor={rescheduleFor}
                    setRescheduleFor={setRescheduleFor}
                    proposedAt={proposedAt}
                    setProposedAt={setProposedAt}
                    rescheduleReason={rescheduleReason}
                    setRescheduleReason={setRescheduleReason}
                    slotPanelFor={slotPanelFor}
                    slotsLoading={slotsLoading}
                    slotsList={slotsList}
                    slotsError={slotsError}
                    pendingSlotId={pendingSlotId}
                    setPendingSlotId={setPendingSlotId}
                    bookingSlotId={bookingSlotId}
                    cancelOpenFor={cancelOpenFor}
                    setCancelOpenFor={setCancelOpenFor}
                    cancelError={cancelError}
                    setCancelError={setCancelError}
                    respondInterview={respondInterview}
                    submitReschedule={submitReschedule}
                    openSlotPanel={openSlotPanel}
                    closeSlotPanel={closeSlotPanel}
                    loadOpenSlots={loadOpenSlots}
                    moveInterviewToSlot={moveInterviewToSlot}
                    cancelAttendance={cancelAttendance}
                    bookSlot={bookSlot}
                    />
                  </div>

                  {/* Penawaran (offer) — disembunyikan bila tahap akhir sudah Ditolak
                      (sudah ganti tahap: kartu penawaran lama tidak relevan lagi). */}
                  {offer && finalStatus !== "REJECTED" ? (
                    <div id="bagian-penawaran">
                      <OfferCard
                        offer={offer}
                        offerDaysLeft={offerDaysLeft}
                        t={t}
                        applicantName={detail.applicantName}
                        offerBusy={offerBusy}
                        declineOpen={declineOpen}
                        setDeclineOpen={setDeclineOpen}
                        declineReason={declineReason}
                        setDeclineReason={setDeclineReason}
                        onAccept={acceptOffer}
                        onDecline={declineOffer}
                        onOpenLetter={() => setLetterOpen(true)}
                      />
                    </div>
                  ) : null}

                  {/* NR-15 (idea 13): kartu Tanggal Mulai — hanya bila status diterima */}
                  {candidateStart ? (
                    <div id="bagian-tanggal-mulai">
                      <StartDateCard
                        candidateStart={candidateStart}
                        startBusy={startBusy}
                        startProposeOpen={startProposeOpen}
                        setStartProposeOpen={setStartProposeOpen}
                        startDateValue={startDateValue}
                        setStartDateValue={setStartDateValue}
                        startNoteValue={startNoteValue}
                        setStartNoteValue={setStartNoteValue}
                        onSubmitStartDate={submitStartDate}
                        lang={lang}
                        p={p}
                        t={t}
                      />
                    </div>
                  ) : null}

                  {/* NR-15 (idea 11): panel Perbarui CV — collapsible, default tertutup */}
                  {detail && !finalStatus ? (
                    <CvUpdatePanel
                      cvFileName={detail.cvFileName}
                      cvFile={cvFile}
                      onSelectCvFile={selectCvFile}
                      cvUploading={cvUploading}
                      onSubmitCvUpdate={submitCvUpdate}
                      p={p}
                    />
                  ) : null}

                  {/* NR-15 (idea 10): panel Tanya Tim Rekrutmen — collapsible
                      (default terbuka bila thread ada pesan, tertutup bila kosong) */}
                  {detail && finalStatus !== "REJECTED" ? (
                    <QaPanel
                      questions={questions}
                      qaText={qaText}
                      setQaText={setQaText}
                      qaBusy={qaBusy}
                      onSubmitQuestion={submitQuestion}
                      p={p}
                    />
                  ) : null}

                  {/* Onboarding — dokumen & info bergabung (tidak tampil bila sudah ditolak);
                      collapsible, default terbuka bila ada dokumen diminta */}
                  {onboarding && finalStatus !== "REJECTED" ? (
                    <div id="bagian-onboarding">
                      <OnboardingPanel
                        onboarding={onboarding}
                        onboardingDocs={onboardingDocs}
                        onboardingDoneCount={onboardingDoneCount}
                        uploadingDocId={uploadingDocId}
                        onUploadDoc={uploadOnboardingDoc}
                        t={t}
                      />
                    </div>
                  ) : null}

                  {finalStatus === "ACCEPTED" ? <AcceptedNotice t={t} /> : null}
                  {/* NR-39: kartu karyawan milik pelamar — bila status diterima */}
                  {finalStatus === "ACCEPTED" && selectedCode ? (
                    <MyCardSection trackingCode={selectedCode} />
                  ) : null}
                  {finalStatus === "REJECTED" ? (
                    <RejectedNotice
                      detail={detail}
                      p={p}
                      t={t}
                      onBrowseJobs={goBrowseJobs}
                    />
                  ) : null}

                  {/* NR-15 (idea 17): kartu feedback pengalaman — bila ada token survei */}
                  {detail.surveyToken ? (
                    <SurveyCard surveyToken={detail.surveyToken} p={p} />
                  ) : null}

                  {/* NR-41 H17 — portabilitas data: unduh salinan data milik pelamar */}
                  <section
                    aria-label="Pengaturan data"
                    className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-800"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Pengaturan data</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Unduh salinan data lamaran Anda dalam format JSON
                          (portabilitas data).
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 shrink-0 gap-2 sm:h-9"
                        onClick={() => void downloadMyData()}
                        disabled={exportBusy}
                      >
                        {exportBusy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="h-4 w-4" aria-hidden="true" />
                        )}
                        Unduh data saya
                      </Button>
                    </div>
                  </section>
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
      <OfferLetterOverlay
        offer={offer}
        positionTitle={detail?.positionTitle}
        sessionEmail={session?.email ?? null}
        lang={lang}
        p={p}
        t={t}
        onClose={() => setLetterOpen(false)}
      />
    ) : null}
    </>
  );
}

/* ---------------------------------------------------------------------------
 * PL-2b (butir 14): panel "Aksi yang Diminta dari Anda" — ringkasan aksi yang
 * ditunggu dari pelamar, dihitung klien dari TrackResponse. Murni ringkasan +
 * navigasi (tombol menggulir halus ke bagian terkait); logika aksi asli tidak
 * diubah. Palet rose (mendesak) / amber (segera) / zinc (info), tanpa biru.
 * ------------------------------------------------------------------------- */

type RequiredActionItem = {
  key: string;
  tone: "rose" | "amber" | "zinc";
  icon: LucideIcon;
  text: string;
  targetId: string | null;
};

const ACTION_TONE_STYLES: Record<RequiredActionItem["tone"], { row: string; icon: string }> = {
  rose: {
    row: "border-rose-200 bg-rose-50 dark:border-rose-500/30 dark:bg-rose-500/10",
    icon: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400",
  },
  amber: {
    row: "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
    icon: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400",
  },
  zinc: {
    row: "border-zinc-200 bg-zinc-50 dark:border-zinc-500/30 dark:bg-zinc-500/5",
    icon: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  },
};

function RequiredActionsPanel({
  actions,
  onGoTo,
}: {
  actions: RequiredActionItem[];
  onGoTo: (targetId: string) => void;
}) {
  return (
    <section
      aria-label="Aksi yang Diminta dari Anda"
      className="rounded-2xl border border-zinc-200 bg-card p-4 dark:border-zinc-800"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
          <ListChecks className="size-4" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-bold">Aksi yang Diminta dari Anda</h3>
          <p className="text-xs text-muted-foreground">
            Hal yang masih menunggu tindakan kamu pada lamaran ini.
          </p>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {actions.map((action) => {
          const tone = ACTION_TONE_STYLES[action.tone];
          const Icon = action.icon;
          return (
            <li
              key={action.key}
              className={`flex flex-wrap items-center gap-2.5 rounded-xl border p-3 ${tone.row}`}
            >
              <span
                className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <p className="min-w-0 flex-1 text-sm font-medium">{action.text}</p>
              {action.targetId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 shrink-0 sm:h-9"
                  onClick={() => onGoTo(action.targetId as string)}
                  aria-label={`Ke bagian terkait: ${action.text}`}
                >
                  Ke bagian ini
                  <ArrowDown className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * NR-39: Kartu Karyawanku — tampil hanya bila status lamaran DITERIMA.
 * Mengambil kartu milik pelamar via kode pelacakan (endpoint publik my-card;
 * server otomatis menerbitkan kartu bila belum ada). 404/gagal -> bagian ini
 * tidak dirender sama sekali (diam). Data kartu hanya milik pelamar itu sendiri.
 * ------------------------------------------------------------------------- */

type MyEmployeeCard = EmployeeCardDto & { verifyToken: string | null };

// Warna badge status kartu (emerald/amber/zinc/rose — tanpa biru).
const MY_CARD_STATUS_BADGE: Record<EmployeeCardStatus, string> = {
  PENDING:
    "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  PROBATION:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  ACTIVE:
    "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
  LEAVE:
    "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
  SUSPENDED:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300",
  REVOKED:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300",
};

function MyCardSection({ trackingCode }: { trackingCode: string }) {
  const [card, setCard] = useState<MyEmployeeCard | null>(null);
  const [siteName, setSiteName] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Id unik untuk node yang diekspor ke PNG (sanitize karakter khas useId).
  const pngNodeId = `my-card-png-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // Kartu milik pelamar ini — 404 -> bagian tidak dirender (senyap).
  useEffect(() => {
    let alive = true;
    setCard(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/public/my-card?kode=${encodeURIComponent(trackingCode)}`,
          { cache: "no-store" }
        );
        if (res.status === 404) return;
        const data = (await res.json().catch(() => null)) as
          | { card?: MyEmployeeCard }
          | null;
        if (alive && res.ok && data?.card) setCard(data.card);
      } catch {
        // Senyap — bagian kartu bersifat opsional.
      }
    })();
    return () => {
      alive = false;
    };
  }, [trackingCode]);

  // Nama studio untuk header kartu (opsional; gagal -> default komponen kartu).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/public/content", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { site?: { siteName?: string } }
          | null;
        if (alive && data?.site?.siteName) setSiteName(data.site.siteName);
      } catch {
        // Biarkan default.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Ekspor node kartu (ber-id unik) menjadi PNG lalu unduh otomatis. */
  const savePng = useCallback(async () => {
    const node = document.getElementById(pngNodeId);
    if (!node || !card) return;
    setSaving(true);
    try {
      const dataUrl = await toPng(node, { pixelRatio: 3, backgroundColor: "#ffffff" });
      const link = document.createElement("a");
      link.download = `kartu-karyawan-${card.cardNumber}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("Kartu tersimpan sebagai PNG.");
    } catch {
      toast.error("Gagal menyimpan gambar. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }, [pngNodeId, card]);

  if (!card) return null;

  const verifyUrl = card.verifyToken
    ? `${window.location.origin}/#verifikasi?t=${card.verifyToken}`
    : "";

  return (
    <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/70 to-transparent p-5 dark:border-emerald-500/20 dark:from-emerald-500/5 dark:to-transparent">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
            <IdCard className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-bold">Kartu Karyawanku</h3>
            <p className="mt-0.5 font-mono text-xs tracking-wider text-muted-foreground">
              {card.cardNumber}
            </p>
          </div>
        </div>
        <Badge variant="outline" className={MY_CARD_STATUS_BADGE[card.status]}>
          {EMPLOYEE_CARD_STATUS_LABELS[card.status]}
        </Badge>
      </div>
      <div className="mt-4">
        <Button className="min-h-11 w-full sm:w-auto" onClick={() => setDialogOpen(true)}>
          <IdCard className="size-4" aria-hidden="true" />
          Lihat & Unduh Kartu
        </Button>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Kartu juga tercetak di sisi belakang dengan QR verifikasi.
      </p>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Kartu Karyawan</DialogTitle>
            <DialogDescription>
              Tunjukkan kartu ini bila diminta, atau simpan sebagai gambar.
            </DialogDescription>
          </DialogHeader>
          {/* Wrapper putih — latar konsisten saat diekspor ke PNG (juga di mode gelap). */}
          <div id={pngNodeId} className="rounded-2xl bg-white p-2">
            <EmployeeIdCard
              cardNumber={card.cardNumber}
              name={card.name}
              positionTitle={card.positionTitle}
              status={card.status}
              issuedAt={card.issuedAt}
              probationUntil={card.probationUntil}
              nikMasked={card.nikMasked}
              verifyUrl={verifyUrl}
              siteName={siteName ?? undefined}
            />
          </div>
          <Button
            className="min-h-11 w-full"
            onClick={() => void savePng()}
            disabled={saving || !card.verifyToken}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
            Simpan PNG
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
