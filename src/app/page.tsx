"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, RefreshCcw } from "lucide-react";
import type { PublicContentResponse } from "@/lib/types";
import { LandingPage } from "@/components/landing/landing-page";
import { AdminApp } from "@/components/admin/admin-app";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * View publik: mengambil konten situs + posisi aktif lalu merender landing page.
 */
function LandingView({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const [data, setData] = useState<PublicContentResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/public/content", { cache: "no-store" });
      if (!res.ok) throw new Error("gagal memuat konten");
      const json = (await res.json()) as PublicContentResponse;
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        {/* Skeleton navbar */}
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
        {/* Skeleton hero */}
        <div className="bg-zinc-950">
          <div className="mx-auto max-w-6xl space-y-6 px-4 py-20 sm:px-6 md:py-28">
            <Skeleton className="h-7 w-64 rounded-full" />
            <Skeleton className="h-12 w-full max-w-3xl" />
            <Skeleton className="h-12 w-2/3 max-w-2xl" />
            <Skeleton className="h-5 w-full max-w-xl" />
            <div className="flex gap-4 pt-2">
              <Skeleton className="h-11 w-40 rounded-md" />
              <Skeleton className="h-11 w-36 rounded-md" />
            </div>
          </div>
        </div>
        {/* Skeleton konten */}
        <div className="mx-auto max-w-6xl space-y-8 px-4 py-16 sm:px-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-full rounded-2xl" />
            ))}
          </div>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Memuat halaman rekrutmen...
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
            <AlertCircle className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-lg font-semibold">Gagal memuat halaman</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Terjadi kendala saat mengambil data rekrutmen. Periksa koneksi lalu coba lagi.
          </p>
          <Button className="mt-6" onClick={() => void load()}>
            <RefreshCcw className="mr-2 h-4 w-4" aria-hidden />
            Coba Lagi
          </Button>
        </div>
      </div>
    );
  }

  return (
    <LandingPage
      content={data.site}
      positions={data.positions}
      stats={data.stats}
      onOpenAdmin={onOpenAdmin}
    />
  );
}

/**
 * Halaman utama: switching antara landing publik dan panel admin.
 * Panel admin dapat diakses melalui hash #admin atau tombol Admin di footer.
 */
export default function Home() {
  const [view, setView] = useState<"landing" | "admin">("landing");

  useEffect(() => {
    const sync = () => setView(window.location.hash === "#admin" ? "admin" : "landing");
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const openAdmin = useCallback(() => {
    if (window.location.hash !== "#admin") {
      window.location.hash = "admin";
    }
    setView("admin");
  }, []);

  const exitAdmin = useCallback(() => {
    if (window.location.hash === "#admin") {
      history.replaceState(null, "", window.location.pathname);
    }
    setView("landing");
  }, []);

  return view === "admin" ? (
    <AdminApp onExit={exitAdmin} />
  ) : (
    <LandingView onOpenAdmin={openAdmin} />
  );
}
