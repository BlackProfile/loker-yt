"use client";

import {
  Component,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AlertCircle, Loader2, RefreshCcw } from "lucide-react";
import type { PublicContentResponse } from "@/lib/types";
import { useLiveResource, useRealtimeConnected } from "@/lib/live-client";
import { LandingPage } from "@/components/landing/landing-page";
import { EmbedJobs } from "@/components/landing/embed-jobs";
import { PositionDetailView } from "@/components/landing/position-detail";
import { AdminApp } from "@/components/admin/admin-app";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type View = "landing" | "detail" | "admin" | "embed";

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

function readLocation(): { view: View; slug: string | null } {
  const params = new URLSearchParams(window.location.search);
  // "#admin" dan sub-halamannya (mis. "#admin/posisi/<id>") masuk ke panel admin.
  if (window.location.hash.startsWith("#admin")) return { view: "admin", slug: null };
  if (params.get("embed") === "1") return { view: "embed", slug: null };
  const slug = params.get("posisi");
  if (slug) return { view: "detail", slug: slug.slice(0, 80) };
  return { view: "landing", slug: null };
}

// ---------------------------------------------------------------------------
// View: landing
// ---------------------------------------------------------------------------

function LandingView({
  data,
  refreshing,
  onOpenPosition,
}: {
  data: PublicContentResponse;
  refreshing: boolean;
  onOpenPosition: (slug: string) => void;
}) {
  return (
    <LandingPage
      content={data.site}
      positions={data.positions}
      stats={data.stats}
      positionStats={data.positionStats ?? {}}
      refreshing={refreshing}
      onOpenPosition={onOpenPosition}
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
 */
export function HomeView({ initialPosisiSlug }: { initialPosisiSlug: string | null }) {
  const [view, setView] = useState<View>("landing");
  const [slug, setSlug] = useState<string | null>(initialPosisiSlug);

  const { data, error, loading, refreshing, refresh } = usePublicContent();
  const realtimeUp = useRealtimeConnected();

  useEffect(() => {
    const sync = () => {
      const next = readLocation();
      setView(next.view);
      setSlug(next.slug);
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

  const resetKey = `${view}:${slug ?? ""}`;

  // Layar pemeriksaan pertama (hanya saat benar-benar belum ada data).
  if (loading && !data) {
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
      ) : view === "embed" ? (
        <EmbedView data={data} />
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
