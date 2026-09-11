"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart3,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  LogOut,
  Moon,
  Sun,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  ROLE_LABELS,
  type AdminSession,
  type Application,
  type Role,
  type SiteContent,
} from "@/lib/types";
import { useRealtimeConnected } from "@/lib/live-client";
import { cn } from "@/lib/utils";
import { ApiError, apiGet, apiPost } from "./api";
import { roleBadgeClass } from "./format";
import { useLiveRefresh } from "./use-live-refresh";
import { AdminSessionProvider } from "./admin-context";
import { Reveal } from "./motion-primitives";
import { LoginCard } from "./login-card";
import { DashboardTab } from "./dashboard-tab";
import { ApplicationsTab } from "./applications-tab";
import { InterviewTab } from "./interview-tab";
import { AnalyticsTab } from "./analytics-tab";
import { LogsTab } from "./logs-tab";
import { PositionsTab } from "./positions-tab";
import { UsersTab } from "./users-tab";
import { SettingsTab } from "./settings-tab";

type Phase = "checking" | "login" | "ready";

// Konten tab masuk dengan fade + slide horizontal halus (x: 12, 0.2s).
// Radix Tabs melepas konten nonaktif, sehingga animasi berjalan tiap pergantian tab.
function TabReveal({ children }: { children: ReactNode }) {
  return (
    <Reveal slideX={12} duration={0.2}>
      {children}
    </Reveal>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 sm:size-9"
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

// Indikator kecil status koneksi realtime di header: titik hijau + "Live"
// saat socket tersambung, abu-abu + "Offline" saat tidak.
function RealtimeIndicator() {
  const connected = useRealtimeConnected();
  return (
    <span
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
        connected
          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
          : "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
      )}
      role="status"
      aria-label={
        connected
          ? "Koneksi realtime aktif"
          : "Koneksi realtime terputus"
      }
    >
      {connected ? (
        <Wifi className="size-3" aria-hidden="true" />
      ) : (
        <WifiOff className="size-3" aria-hidden="true" />
      )}
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connected
            ? "animate-pulse bg-emerald-500"
            : "bg-zinc-400 dark:bg-zinc-600"
        )}
        aria-hidden="true"
      />
      <span className="hidden sm:inline">
        {connected ? "Live" : "Offline"}
      </span>
    </span>
  );
}

// Toast "Lamaran baru masuk": membandingkan jumlah lamaran antar event
// realtime. Hanya toast saat jumlah BERTAMBAH (perubahan status atau hapus
// oleh admin tidak), maksimal 1 toast per 8 detik, dan tidak pada muatan
// pertama (baseline). Aksi admin yang sudah punya toastnya sendiri tidak
// mengubah jumlah, sehingga tidak memicu toast ganda.
function NewApplicationToaster() {
  const lastCountRef = useRef<number | null>(null);
  const lastToastAtRef = useRef(0);

  const checkCount = useCallback(async () => {
    try {
      const data = await apiGet<Application[]>("/api/admin/applications");
      const count = Array.isArray(data) ? data.length : 0;
      const prev = lastCountRef.current;
      if (prev === null) {
        // Muatan pertama: simpan baseline saja, tanpa toast.
        lastCountRef.current = count;
        return;
      }
      if (count <= prev) {
        lastCountRef.current = count;
        return;
      }
      // Bertambah: hormati jendela 8 detik. Baseline sengaja ditahan agar
      // kenaikan yang tersembur tidak terlewat oleh event berikutnya.
      const now = Date.now();
      if (now - lastToastAtRef.current < 8000) return;
      lastToastAtRef.current = now;
      lastCountRef.current = count;
      toast.info("Lamaran baru masuk", {
        description: `${count - prev} lamaran baru menunggu ditinjau.`,
      });
    } catch {
      // Pemuatan latar belakang senyap; coba lagi pada event berikutnya.
    }
  }, []);

  // Baseline awal (tanpa toast) saat panel admin siap.
  useEffect(() => {
    void checkCount();
  }, [checkCount]);

  useLiveRefresh("applications:changed", () => {
    void checkCount();
  });

  return null;
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

  // Saat pengaturan situs disimpan di tempat lain (event site:changed),
  // segarkan nama situs di header secara senyap.
  useLiveRefresh("site:changed", () => {
    if (phase !== "ready") return;
    apiGet<{ site: SiteContent }>("/api/admin/settings")
      .then((data) => {
        if (data?.site?.siteName) setSiteName(data.site.siteName);
      })
      .catch(() => {
        // Header tetap menampilkan nama sebelumnya.
      });
  });

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
      <NewApplicationToaster />
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
              <RealtimeIndicator />
              <ThemeToggle />
              <Button
                variant="outline"
                className="h-11 active:scale-[0.99] sm:h-10"
                onClick={onExit}
                aria-label="Lihat halaman publik"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                <span className="hidden md:inline">Lihat Halaman Publik</span>
                <span className="md:hidden">Publik</span>
              </Button>
              <Button
                variant="ghost"
                className="h-11 sm:h-10"
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
                <TabsTrigger value="analytics" className="h-full px-3 sm:px-4">
                  <BarChart3 className="size-4" aria-hidden="true" />
                  Analitik
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
              <TabReveal>
                <DashboardTab />
              </TabReveal>
            </TabsContent>
            <TabsContent value="applications">
              <TabReveal>
                <ApplicationsTab />
              </TabReveal>
            </TabsContent>
            <TabsContent value="interview">
              <TabReveal>
                <InterviewTab />
              </TabReveal>
            </TabsContent>
            <TabsContent value="analytics">
              <TabReveal>
                <AnalyticsTab />
              </TabReveal>
            </TabsContent>
            <TabsContent value="logs">
              <TabReveal>
                <LogsTab />
              </TabReveal>
            </TabsContent>
            {isOwnerOrHr ? (
              <TabsContent value="positions">
                <TabReveal>
                  <PositionsTab />
                </TabReveal>
              </TabsContent>
            ) : null}
            {isOwner ? (
              <TabsContent value="users">
                <TabReveal>
                  <UsersTab />
                </TabReveal>
              </TabsContent>
            ) : null}
            {isOwner ? (
              <TabsContent value="settings">
                <TabReveal>
                  <SettingsTab />
                </TabReveal>
              </TabsContent>
            ) : null}
          </Tabs>
        </main>
      </div>
    </AdminSessionProvider>
  );
}
