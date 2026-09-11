"use client";

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import type { SiteContent } from "@/lib/types";
import { apiGet, apiPost } from "./api";
import { LoginCard } from "./login-card";
import { DashboardTab } from "./dashboard-tab";
import { ApplicationsTab } from "./applications-tab";
import { PositionsTab } from "./positions-tab";
import { SettingsTab } from "./settings-tab";

type Phase = "checking" | "login" | "ready";

function FadeIn({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

export function AdminApp({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [siteName, setSiteName] = useState("");

  // Cek sesi saat mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{ authenticated: boolean }>(
          "/api/admin/session"
        );
        if (!cancelled) setPhase(data.authenticated ? "ready" : "login");
      } catch {
        if (!cancelled) setPhase("login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Ambil siteName untuk header setelah autentikasi.
  useEffect(() => {
    if (phase !== "ready") return;
    let cancelled = false;
    apiGet<{ site: SiteContent }>("/api/admin/settings")
      .then((data) => {
        if (!cancelled && data?.site?.siteName) setSiteName(data.site.siteName);
      })
      .catch(() => {
        // Header tetap tampil tanpa siteName.
      });
    return () => {
      cancelled = true;
    };
  }, [phase]);

  async function handleLogout() {
    try {
      await apiPost<{ ok: boolean }>("/api/admin/logout");
      toast.success("Anda telah keluar");
    } catch {
      // Tetap kembali ke layar login meski logout gagal di server.
    }
    setPhase("login");
  }

  if (phase === "checking") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50">
        <Loader2 className="size-8 animate-spin text-rose-600" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Memeriksa sesi...</p>
      </div>
    );
  }

  if (phase === "login") {
    return <LoginCard onSuccess={() => setPhase("ready")} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-600 to-amber-500 p-2">
              <LayoutDashboard className="size-5 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="leading-tight font-bold">Panel Admin</p>
              <p className="truncate text-xs text-muted-foreground">
                {siteName || "\u00A0"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Button
              variant="outline"
              className="h-10"
              onClick={onExit}
              aria-label="Lihat halaman publik"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              <span className="hidden md:inline">Lihat Halaman Publik</span>
              <span className="md:hidden">Publik</span>
            </Button>
            <Button
              variant="ghost"
              className="h-10"
              onClick={() => void handleLogout()}
              aria-label="Keluar dari panel admin"
            >
              <LogOut className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Keluar</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-10 sm:px-6">
        <Tabs defaultValue="dashboard" className="gap-4">
          <div className="overflow-x-auto nice-scrollbar">
            <TabsList className="h-10 w-fit" aria-label="Navigasi panel admin">
              <TabsTrigger value="dashboard" className="h-full px-3 sm:px-4">
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="applications" className="h-full px-3 sm:px-4">
                Pelamar
              </TabsTrigger>
              <TabsTrigger value="positions" className="h-full px-3 sm:px-4">
                Posisi
              </TabsTrigger>
              <TabsTrigger value="settings" className="h-full px-3 sm:px-4">
                Pengaturan
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="dashboard">
            <FadeIn>
              <DashboardTab />
            </FadeIn>
          </TabsContent>
          <TabsContent value="applications">
            <FadeIn>
              <ApplicationsTab />
            </FadeIn>
          </TabsContent>
          <TabsContent value="positions">
            <FadeIn>
              <PositionsTab />
            </FadeIn>
          </TabsContent>
          <TabsContent value="settings">
            <FadeIn>
              <SettingsTab />
            </FadeIn>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
