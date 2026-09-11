"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { toast } from "sonner";
import {
  ROLE_LABELS,
  type AdminSession,
  type Role,
  type SiteContent,
} from "@/lib/types";
import { ApiError, apiGet, apiPost } from "./api";
import { roleBadgeClass } from "./format";
import { AdminSessionProvider } from "./admin-context";
import { LoginCard } from "./login-card";
import { DashboardTab } from "./dashboard-tab";
import { ApplicationsTab } from "./applications-tab";
import { InterviewTab } from "./interview-tab";
import { LogsTab } from "./logs-tab";
import { PositionsTab } from "./positions-tab";
import { UsersTab } from "./users-tab";
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

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-10 sm:size-9"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Aktifkan mode terang" : "Aktifkan mode gelap"}
    >
      {isDark ? (
        <Sun className="size-4" aria-hidden="true" />
      ) : (
        <Moon className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}

export function AdminApp({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [siteName, setSiteName] = useState("");

  // Cek sesi saat mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<{
          authenticated: boolean;
          session: AdminSession | null;
        }>("/api/admin/session");
        if (cancelled) return;
        if (data.authenticated && data.session) {
          setSession(data.session);
          setPhase("ready");
        } else {
          setPhase("login");
        }
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

  const role: Role = session?.role ?? "VIEWER";
  const canMutate = role !== "VIEWER";
  const isOwner = role === "OWNER";
  const isOwnerOrHr = role === "OWNER" || role === "HR";

  const onUnauthorized = useCallback(() => {
    setSession(null);
    setPhase("login");
  }, []);

  // Penanganan error terpusat: 401 -> login, 403 -> toast akses, lainnya -> pesan.
  const reportError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          toast.error("Sesi Anda berakhir. Silakan login kembali.");
          onUnauthorized();
          return;
        }
        if (err.status === 403) {
          toast.error("Anda tidak memiliki akses untuk aksi ini.");
          return;
        }
      }
      toast.error(
        err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi."
      );
    },
    [onUnauthorized]
  );

  const sessionContextValue = useMemo(
    () => ({ session: session as AdminSession, role, canMutate, reportError }),
    [session, role, canMutate, reportError]
  );

  async function handleLogout() {
    try {
      await apiPost<{ ok: boolean }>("/api/admin/logout");
      toast.success("Anda telah keluar");
    } catch {
      // Tetap kembali ke layar login meski logout gagal di server.
    }
    setSession(null);
    setPhase("login");
  }

  if (phase === "checking") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-zinc-50 dark:bg-background">
        <Loader2 className="size-8 animate-spin text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">Memeriksa sesi...</p>
      </div>
    );
  }

  if (phase === "login" || !session) {
    return (
      <LoginCard
        onSuccess={(s) => {
          setSession(s);
          setPhase("ready");
        }}
      />
    );
  }

  return (
    <AdminSessionProvider value={sessionContextValue}>
      <div className="flex min-h-screen flex-col bg-zinc-50 dark:bg-background">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-600 to-amber-500 p-2">
                <LayoutDashboard className="size-5 text-white" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="leading-tight font-bold">Panel Admin</p>
                  <Badge
                    variant="outline"
                    className={`hidden sm:inline-flex ${roleBadgeClass(role)}`}
                  >
                    {ROLE_LABELS[role]}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {siteName || "\u00A0"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <ThemeToggle />
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

        {role === "VIEWER" ? (
          <div className="border-b border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
            <p className="mx-auto w-full max-w-6xl px-4 py-2 text-xs font-medium text-amber-700 dark:text-amber-400 sm:px-6">
              Mode Pengamat — hanya lihat. Semua tombol perubahan dinonaktifkan.
            </p>
          </div>
        ) : null}

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
                <TabsTrigger value="interview" className="h-full px-3 sm:px-4">
                  Wawancara
                </TabsTrigger>
                <TabsTrigger value="logs" className="h-full px-3 sm:px-4">
                  Log
                </TabsTrigger>
                {isOwnerOrHr ? (
                  <TabsTrigger value="positions" className="h-full px-3 sm:px-4">
                    Posisi
                  </TabsTrigger>
                ) : null}
                {isOwner ? (
                  <TabsTrigger value="users" className="h-full px-3 sm:px-4">
                    Pengguna
                  </TabsTrigger>
                ) : null}
                {isOwner ? (
                  <TabsTrigger value="settings" className="h-full px-3 sm:px-4">
                    Pengaturan
                  </TabsTrigger>
                ) : null}
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
            <TabsContent value="interview">
              <FadeIn>
                <InterviewTab />
              </FadeIn>
            </TabsContent>
            <TabsContent value="logs">
              <FadeIn>
                <LogsTab />
              </FadeIn>
            </TabsContent>
            {isOwnerOrHr ? (
              <TabsContent value="positions">
                <FadeIn>
                  <PositionsTab />
                </FadeIn>
              </TabsContent>
            ) : null}
            {isOwner ? (
              <TabsContent value="users">
                <FadeIn>
                  <UsersTab />
                </FadeIn>
              </TabsContent>
            ) : null}
            {isOwner ? (
              <TabsContent value="settings">
                <FadeIn>
                  <SettingsTab />
                </FadeIn>
              </TabsContent>
            ) : null}
          </Tabs>
        </main>
      </div>
    </AdminSessionProvider>
  );
}
