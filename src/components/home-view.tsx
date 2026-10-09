"use client";

import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, Loader2, RefreshCcw } from "lucide-react";
import type { MaintenancePublicInfo, PublicContentResponse } from "@/lib/types";
import { useLiveResource, useRealtimeConnected } from "@/lib/live-client";
import { LandingPage, MaintenanceScreen } from "@/components/landing/landing-page";
import { EmbedJobs } from "@/components/landing/embed-jobs";
import { PositionDetailView } from "@/components/landing/position-detail";
import { SurveyView } from "@/components/landing/survey-view";
import { StatusPageView } from "@/components/landing/status-page";
import { VerifyCardView } from "@/components/landing/verify-card-view";
import { AdminApp } from "@/components/admin/admin-app";
import { MiniAppView } from "@/components/landing/mini-app-view";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type View =
  | "landing"
  | "detail"
  | "admin"
  | "embed"
  | "survei"
  | "status"
  | "mini"
  | "verifikasi";

// Hasil pembacaan URL: view aktif + slug posisi (jika ada) + kode pelacakan
// dari hash "#status?code=XXX" (tautan "salin tautan status" halaman Cek Status)
// + token QR verifikasi dari hash "#verifikasi?t=..." (kartu karyawan).
type LocationInfo = {
  view: View;
  slug: string | null;
  statusCode: string | null;
  verifyToken: string | null;
};

// ---------------------------------------------------------------------------
// Sumber data publik bersama (realtime + anti-flicker).
// Satu sumber untuk semua view — pindah landing <-> detail TIDAK memuat ulang,
// dan perubahan posisi/lamaran/konten dari panel admin otomatis mengalir masuk.
// ---------------------------------------------------------------------------

const PUBLIC_EVENTS = ["positions:changed", "site:changed"] as const;

function usePublicContent() {
  return useLiveResource<PublicContentResponse>("/api/public/content", {
    events: [...PUBLIC_EVENTS],
  });
}

// ---------------------------------------------------------------------------
// Error boundary — satu error render tidak pernah membuat layar putih total.
// ---------------------------------------------------------------------------

class ViewErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="w-full max-w-md rounded-2xl border p-8 text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
              <AlertCircle className="size-7" aria-hidden="true" />
            </span>
            <h1 className="mt-4 text-lg font-bold">Terjadi kesalahan</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Ada gangguan saat menampilkan halaman ini. Coba muat ulang.
            </p>
            <Button className="mt-6 min-h-11" onClick={() => window.location.reload()}>
              <RefreshCcw className="size-4" aria-hidden="true" />
              Muat Ulang
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// URL <-> view sync
// ---------------------------------------------------------------------------

function readLocation(): LocationInfo {
  const params = new URLSearchParams(window.location.search);
  // "#admin" dan sub-halamannya (mis. "#admin/posisi/<id>") masuk ke panel admin.
  if (window.location.hash.startsWith("#admin"))
    return { view: "admin", slug: null, statusCode: null, verifyToken: null };
  // "#verifikasi" — halaman publik verifikasi kartu karyawan (tanpa login).
  // Hash bisa membawa token QR: "#verifikasi?t=<token>.<hmac>" (link di kartu).
  if (window.location.hash.startsWith("#verifikasi")) {
    const hashQuery = window.location.hash.slice("#verifikasi".length);
    let verifyToken: string | null = null;
    if (hashQuery.startsWith("?")) {
      const raw = new URLSearchParams(hashQuery.slice(1)).get("t");
      if (raw && raw.trim()) verifyToken = raw.trim().slice(0, 128);
    }
    return { view: "verifikasi", slug: null, statusCode: null, verifyToken };
  }
  // "#status" — halaman Cek Status pelamar (login email + kode pelacakan).
  // Hash bisa membawa query: "#status?code=LM-XXXXXX" (tautan berbagi) —
  // kode dipakai untuk prefill form login bila belum ada sesi tersimpan.
  if (window.location.hash.startsWith("#status")) {
    const hashQuery = window.location.hash.slice("#status".length);
    let statusCode: string | null = null;
    if (hashQuery.startsWith("?")) {
      const raw = new URLSearchParams(hashQuery.slice(1)).get("code");
      if (raw && raw.trim()) statusCode = raw.trim().toUpperCase().slice(0, 24);
    }
    return { view: "status", slug: null, statusCode, verifyToken: null };
  }
  // Mini App Telegram (?mini=1) — panel versi ringkas di webview bot.
  if (params.get("mini") === "1") return { view: "mini", slug: null, statusCode: null, verifyToken: null };
  if (params.get("embed") === "1") return { view: "embed", slug: null, statusCode: null, verifyToken: null };
  // Survei pengalaman kandidat (?survei=token) — dikirim via email status final.
  const surveiToken = params.get("survei");
  if (surveiToken) return { view: "survei", slug: surveiToken.slice(0, 64), statusCode: null, verifyToken: null };
  const slug = params.get("posisi");
  if (slug) return { view: "detail", slug: slug.slice(0, 80), statusCode: null, verifyToken: null };
  return { view: "landing", slug: null, statusCode: null, verifyToken: null };
}

// ---------------------------------------------------------------------------
// View: landing
// ---------------------------------------------------------------------------

function LandingView({
  data,
  refreshing,
  onOpenPosition,
  maintenance,
}: {
  data: PublicContentResponse;
  refreshing: boolean;
  onOpenPosition: (slug: string) => void;
  /** NR45 — mode perawatan: dari konten publik, fallback ke data server awal. */
  maintenance?: MaintenancePublicInfo;
}) {
  return (
    <LandingPage
      content={data.site}
      positions={data.positions}
      stats={data.stats}
      positionStats={data.positionStats ?? {}}
      refreshing={refreshing}
      onOpenPosition={onOpenPosition}
      maintenance={maintenance}
    />
  );
}

/**
 * View embed: widget ringkas daftar lowongan untuk di-iframe di situs lain (?embed=1).
 * Mendukung filter per posisi (?embed=1&posisi=slug).
 */
function EmbedView({ data }: { data: PublicContentResponse }) {
  return <EmbedJobs content={data.site} positions={data.positions} />;
}

/**
 * Kontainer view utama (client): landing publik, detail per lowongan
 * (?posisi=slug), panel admin (#admin), dan widget embed (?embed=1).
 * Metadata SEO per posisi ditangani server di src/app/page.tsx.
 * NR45 — initialMaintenance: snapshot mode perawatan yang dibaca server
 * (Setting "maintenance") sebelum konten publik siap, agar situs yang ditutup
 * FULL tidak berkedip terbuka saat pemuatan pertama.
 */
export function HomeView({
  initialPosisiSlug,
  initialMaintenance,
}: {
  initialPosisiSlug: string | null;
  initialMaintenance?: MaintenancePublicInfo;
}) {
  const [view, setView] = useState<View>("landing");
  const [slug, setSlug] = useState<string | null>(initialPosisiSlug);
  // Kode pelacakan dari "#status?code=XXX" — prefill form login Cek Status.
  const [statusCode, setStatusCode] = useState<string | null>(null);
  // Token QR verifikasi kartu dari "#verifikasi?t=..." — dipakai view verifikasi.
  const [verifyToken, setVerifyToken] = useState<string | null>(null);

  const { data, error, loading, refreshing, refresh } = usePublicContent();
  const realtimeUp = useRealtimeConnected();

  useEffect(() => {
    const sync = () => {
      const next = readLocation();
      setView(next.view);
      setSlug(next.slug);
      setStatusCode(next.statusCode);
      setVerifyToken(next.verifyToken);
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    window.addEventListener("app:navigate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
      window.removeEventListener("app:navigate", sync);
    };
  }, []);

  /** Buka halaman detail lowongan (URL berubah menjadi ?posisi=slug — bisa dibagikan). */
  const openPosition = useCallback((positionSlug: string) => {
    const clean = positionSlug.slice(0, 80);
    history.pushState(null, "", `/?posisi=${encodeURIComponent(clean)}`);
    window.dispatchEvent(new Event("app:navigate"));
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  /** Tutup detail dan kembali ke landing (mendukung tombol back browser). */
  const closePosition = useCallback(() => {
    if (new URLSearchParams(window.location.search).get("posisi")) {
      history.pushState(null, "", window.location.pathname);
      window.dispatchEvent(new Event("app:navigate"));
    } else {
      setView("landing");
      setSlug(null);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  const exitAdmin = useCallback(() => {
    if (window.location.hash.startsWith("#admin")) {
      history.replaceState(null, "", window.location.pathname);
    }
    setView("landing");
    setSlug(null);
  }, []);

  /** Tutup halaman Cek Status dan kembali ke landing. */
  const exitStatus = useCallback(() => {
    if (window.location.hash.startsWith("#status")) {
      history.replaceState(null, "", window.location.pathname);
    }
    setView("landing");
    setSlug(null);
    setStatusCode(null);
  }, []);

  // View Mini App Telegram: mandiri (tanpa konten publik, tanpa header/footer
  // landing) — early return agar tampil langsung tanpa menunggu fetch konten.
  if (view === "mini") {
    return <MiniAppView />;
  }

  // View verifikasi kartu: mandiri (tanpa konten publik) — early return agar
  // halaman verifikasi publik tidak tertahan blok loading konten landing.
  if (view === "verifikasi") {
    return <VerifyCardView initialToken={verifyToken} />;
  }

  const resetKey = `${view}:${slug ?? ""}`;

  // NR45 — situs ditutup penuh (mode perawatan FULL): layar perawatan tampil
  // sejak pemuatan pertama / gagal muat, tanpa berkedip menampilkan situs.
  // Panel admin tetap bisa masuk lewat #admin (view "admin" di bawah).
  const fullMaintenance =
    initialMaintenance?.enabled && initialMaintenance.level === "FULL"
      ? initialMaintenance
      : null;

  // Layar pemeriksaan pertama (hanya saat benar-benar belum ada data).
  if (loading && !data) {
    if (fullMaintenance) {
      return (
        <MaintenanceScreen
          siteName="Lumina Studio"
          message={fullMaintenance.message}
        />
      );
    }
    return (
      <div className="min-h-screen bg-background">
        <div className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-xl" />
              <Skeleton className="h-5 w-36" />
            </div>
            <div className="hidden items-center gap-6 md:flex">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-12" />
            </div>
            <Skeleton className="h-9 w-32 rounded-md" />
          </div>
        </div>
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <Skeleton className="h-64 w-full rounded-3xl" />
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
            <Skeleton className="h-48 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  // Gagal total (tidak ada data & realtime/fokus pun belum berhasil) → tombol coba lagi.
  if (error || !data) {
    if (fullMaintenance) {
      return (
        <MaintenanceScreen
          siteName="Lumina Studio"
          message={fullMaintenance.message}
        />
      );
    }
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-4 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
          <AlertCircle className="size-7" aria-hidden="true" />
        </span>
        <div>
          <p className="text-lg font-bold">Gagal memuat konten</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Periksa koneksi internetmu, lalu coba lagi.
          </p>
        </div>
        <Button className="min-h-11" onClick={() => void refresh()}>
          <RefreshCcw className="size-4" aria-hidden="true" />
          Coba Lagi
        </Button>
      </div>
    );
  }

  return (
    <ViewErrorBoundary resetKey={resetKey}>
      {view === "admin" ? (
        <AdminApp onExit={exitAdmin} />
      ) : view === "status" ? (
        <StatusPageView onExit={exitStatus} initialCode={statusCode} />
      ) : view === "embed" ? (
        <EmbedView data={data} />
      ) : view === "survei" && slug ? (
        <SurveyView token={slug} />
      ) : view === "detail" && slug ? (
        <PositionDetailView
          key={slug}
          slug={slug}
          content={data.site}
          positions={data.positions}
          positionStats={data.positionStats ?? {}}
          refreshing={refreshing}
          onBack={closePosition}
        />
      ) : (
        <LandingView
          data={data}
          refreshing={refreshing}
          onOpenPosition={openPosition}
          // NR45 — konten publik boleh membawa maintenance terbaru (live);
          // fallback ke snapshot server agar tetap tertutup bila field belum ada.
          maintenance={data.maintenance ?? initialMaintenance}
        />
      )}
      {/* Indikator kecil status realtime saat offline (anti-bingung tanpa mengganggu). */}
      {!realtimeUp && view !== "admin" ? (
        <div className="pointer-events-none fixed bottom-3 left-1/2 z-40 -translate-x-1/2">
          <span className="rounded-full border bg-background/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
            Mode hemat — pembaruan otomatis terbatas
          </span>
        </div>
      ) : null}
    </ViewErrorBoundary>
  );
}
