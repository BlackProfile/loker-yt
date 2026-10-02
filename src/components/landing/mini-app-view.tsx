"use client";

/**
 * MiniAppView — panel admin versi ringkas untuk Telegram Mini App (?mini=1).
 * Berdiri sendiri: latar gelap tetap (tidak mengikuti tema landing), tanpa
 * header/footer landing. Autentikasi memakai initData asli dari webview
 * Telegram yang divalidasi server di POST /api/telegram/miniapp.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  BadgeCheck,
  Briefcase,
  CalendarClock,
  Inbox,
  MailCheck,
  RefreshCcw,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Tipe lokal (ketat, tanpa any)
// ---------------------------------------------------------------------------

type MiniAppStats = {
  newToday: number;
  unreviewed: number;
  interviewsToday: number;
  pendingOffers: number;
  activePositions: number;
  acceptedTotal: number;
};

type MiniAppUser = {
  id: number;
  first_name: string;
  username: string | null;
};

type MiniAppResponse =
  | { ok: true; user: MiniAppUser | null; stats: MiniAppStats }
  | { ok: false; error: string };

/** Subset API Telegram WebApp yang dipakai ( Hindari tipe global — pakai cast lokal). */
type TelegramWebAppLite = {
  initData?: string;
  ready?: () => void;
};

type Phase = "loading" | "ready" | "no-telegram" | "error";

type StatCardDef = {
  key: keyof MiniAppStats;
  label: string;
  icon: LucideIcon;
};

const STAT_CARDS: StatCardDef[] = [
  { key: "newToday", label: "Lamaran Baru Hari Ini", icon: UserPlus },
  { key: "unreviewed", label: "Belum Ditinjau", icon: Inbox },
  { key: "interviewsToday", label: "Wawancara Hari Ini", icon: CalendarClock },
  { key: "pendingOffers", label: "Offer Menunggu", icon: MailCheck },
  { key: "activePositions", label: "Lowongan Aktif", icon: Briefcase },
  { key: "acceptedTotal", label: "Total Diterima", icon: BadgeCheck },
];

function getTelegramWebApp(): TelegramWebAppLite | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebAppLite } }).Telegram?.WebApp;
}

// ---------------------------------------------------------------------------
// Permintaan verifikasi ke server (murni — hasil dikembalikan, tanpa setState
// agar aman dipanggil dari effect maupun event handler).
// ---------------------------------------------------------------------------

type VerifyOutcome =
  | { kind: "no-telegram" }
  | { kind: "error"; message: string }
  | { kind: "ok"; stats: MiniAppStats; firstName: string | null };

async function requestMiniApp(): Promise<VerifyOutcome> {
  const initData = getTelegramWebApp()?.initData;
  if (!initData || initData.length === 0) return { kind: "no-telegram" };
  try {
    const res = await fetch("/api/telegram/miniapp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ initData }),
    });
    const json = (await res.json().catch(() => null)) as MiniAppResponse | null;
    if (!res.ok || !json || json.ok === false) {
      return {
        kind: "error",
        message:
          json && json.ok === false && json.error === "unauthorized"
            ? "Verifikasi Telegram gagal. Buka kembali melalui tombol di bot Telegram."
            : "Terjadi gangguan saat memuat ringkasan. Coba lagi.",
      };
    }
    return {
      kind: "ok",
      stats: json.stats,
      firstName: json.user?.first_name ? json.user.first_name : null,
    };
  } catch {
    return {
      kind: "error",
      message: "Terjadi gangguan jaringan. Periksa koneksi lalu coba lagi.",
    };
  }
}

// ---------------------------------------------------------------------------
// Skeleton kartu statistik (pulse, senada tema gelap)
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="h-9 w-9 animate-pulse rounded-xl bg-zinc-800" />
      <div className="mt-3 h-7 w-14 animate-pulse rounded-md bg-zinc-800" />
      <div className="mt-2 h-3 w-24 animate-pulse rounded bg-zinc-800" />
    </div>
  );
}

export function MiniAppView() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [stats, setStats] = useState<MiniAppStats | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Pemeriksaan awal saat webview Telegram membuka Mini App.
  useEffect(() => {
    let active = true;
    const tg = getTelegramWebApp();
    try {
      tg?.ready?.();
    } catch {
      // ready() opsional — abaikan bila webview lama.
    }
    const initData = tg?.initData;

    // Bukan webview Telegram (atau initData kosong) — jangan coba validasi.
    // setState ditunda via timer agar tidak berjalan sinkron di body effect.
    if (!initData || initData.length === 0) {
      const timer = window.setTimeout(() => {
        if (active) setPhase("no-telegram");
      }, 0);
      return () => {
        active = false;
        window.clearTimeout(timer);
      };
    }

    void requestMiniApp().then((outcome) => {
      if (!active || outcome.kind === "no-telegram") return;
      if (outcome.kind === "error") {
        setErrorMsg(outcome.message);
        setPhase("error");
        return;
      }
      setStats(outcome.stats);
      setFirstName(outcome.firstName);
      setPhase("ready");
    });

    return () => {
      active = false;
    };
  }, []);

  /** Coba lagi dari tombol error state (event handler — setState bebas). */
  const retry = useCallback(async () => {
    setPhase("loading");
    setErrorMsg("");
    const outcome = await requestMiniApp();
    if (outcome.kind === "error") {
      setErrorMsg(outcome.message);
      setPhase("error");
      return;
    }
    if (outcome.kind === "no-telegram") {
      setPhase("no-telegram");
      return;
    }
    setStats(outcome.stats);
    setFirstName(outcome.firstName);
    setPhase("ready");
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400"
              aria-hidden="true"
            >
              <Briefcase className="size-4.5" />
            </span>
            <h1 className="truncate text-sm font-bold tracking-tight">
              Lumina Studio <span className="font-medium text-zinc-500">— Mini</span>
            </h1>
          </div>
          {firstName ? (
            <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs font-medium text-zinc-300">
              {firstName}
            </span>
          ) : null}
        </div>
      </header>

      {/* Konten */}
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        {phase === "loading" ? (
          <div className="grid grid-cols-2 gap-3" aria-busy="true" aria-label="Memuat ringkasan">
            {STAT_CARDS.map((card) => (
              <StatCardSkeleton key={card.key} />
            ))}
          </div>
        ) : phase === "no-telegram" ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-center">
            <span
              className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-400"
              aria-hidden="true"
            >
              <AlertCircle className="size-6" />
            </span>
            <h2 className="mt-3 text-sm font-semibold text-zinc-100">Akses terbatas</h2>
            <p className="mt-1 text-sm text-zinc-400">
              Buka halaman ini melalui tombol di bot Telegram.
            </p>
            <Button
              asChild
              className="mt-5 min-h-11 w-full bg-rose-500 text-white hover:bg-rose-600"
            >
              <a href="/">Kembali ke Beranda</a>
            </Button>
          </div>
        ) : phase === "error" ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-400" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-rose-300">Gagal memuat ringkasan</p>
                <p className="mt-1 text-sm text-rose-200/80">{errorMsg}</p>
              </div>
            </div>
            <Button
              onClick={() => void retry()}
              variant="outline"
              className="mt-4 min-h-11 w-full border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-rose-400"
            >
              <RefreshCcw className="size-4" aria-hidden="true" />
              Coba Lagi
            </Button>
          </div>
        ) : stats ? (
          <>
            <p className="text-sm text-zinc-400">Ringkasan rekrutmen hari ini.</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {STAT_CARDS.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.key}
                    className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 transition-colors hover:border-zinc-700"
                  >
                    <span
                      className="flex size-9 items-center justify-center rounded-xl bg-zinc-800 text-rose-400"
                      aria-hidden="true"
                    >
                      <Icon className="size-4.5" />
                    </span>
                    <p className="mt-3 text-2xl font-bold text-rose-400" aria-label={card.label}>
                      {stats[card.key]}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">{card.label}</p>
                  </div>
                );
              })}
            </div>
          </>
        ) : null}
      </main>

      {/* Footer — menempel di bawah saat konten pendek */}
      <footer className="mt-auto border-t border-zinc-800 px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">Lumina Studio — Panel versi ringkas</p>
          <Button
            asChild
            variant="outline"
            size="sm"
            className="min-h-9 shrink-0 border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800 hover:text-rose-400"
          >
            <a href="/#admin" target="_blank" rel="noreferrer">
              Buka Panel Lengkap
            </a>
          </Button>
        </div>
      </footer>
    </div>
  );
}
