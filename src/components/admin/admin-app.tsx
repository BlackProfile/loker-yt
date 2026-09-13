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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  BarChart3,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Database,
  ExternalLink,
  FileBarChart,
  FileText,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ScrollText,
  Settings,
  Sun,
  UserCog,
  Users,
  Wifi,
  WifiOff,
  Workflow,
  X,
  type LucideIcon,
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
import { PipelineTab } from "./pipeline-tab";
import { ApplicationsTab } from "./applications-tab";
import { InterviewTab } from "./interview-tab";
import { AnalyticsTab } from "./analytics-tab";
import { LogsTab } from "./logs-tab";
import { PositionsTab } from "./positions-tab";
import { UsersTab } from "./users-tab";
import { SettingsTab } from "./settings-tab";
import { TasksTab } from "./tasks-tab";
import { CalendarTab } from "./calendar-tab";
import { HireTab } from "./hire-tab";
import { ReportsTab } from "./reports-tab";
import { TemplatesTab } from "./templates-tab";
import { DataTab } from "./data-tab";
import { NotificationBell } from "./notification-bell";
import { AdminAskWidget } from "./admin-ask-widget";

type Phase = "checking" | "login" | "ready";

// ---------------------------------------------------------------------------
// Navigasi sidebar: item dikelompokkan per peran. Tab "roles" tanpa daftar
// berarti tampil untuk semua peran; nilai `value` harus tetap sama dengan
// kunci konten agar seluruh tab lama tetap berfungsi tanpa perubahan.
// ---------------------------------------------------------------------------

type NavItemDef = {
  value: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
};

type NavGroupDef = { title: string; items: NavItemDef[] };

const NAV_GROUPS: NavGroupDef[] = [
  {
    title: "Utama",
    items: [
      { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { value: "tasks", label: "Tugas", icon: ListChecks },
      { value: "pipeline", label: "Pipeline", icon: Workflow },
      { value: "applications", label: "Pelamar", icon: Users },
      { value: "interview", label: "Wawancara", icon: CalendarClock },
      { value: "calendar", label: "Kalender", icon: CalendarDays },
    ],
  },
  {
    title: "Analisa",
    items: [
      { value: "analytics", label: "Analitik", icon: BarChart3 },
      { value: "reports", label: "Laporan", icon: FileBarChart },
      { value: "logs", label: "Log Aktivitas", icon: ScrollText },
    ],
  },
  {
    title: "Kelola",
    items: [
      {
        value: "positions",
        label: "Posisi",
        icon: Briefcase,
        roles: ["OWNER", "HR"],
      },
      { value: "hire", label: "Karyawan", icon: Handshake },
      { value: "templates", label: "Template", icon: FileText },
      {
        value: "data",
        label: "Data",
        icon: Database,
        roles: ["OWNER"],
      },
      { value: "users", label: "Pengguna", icon: UserCog, roles: ["OWNER"] },
      {
        value: "settings",
        label: "Pengaturan",
        icon: Settings,
        roles: ["OWNER"],
      },
    ],
  },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

// Konten tab masuk dengan fade + slide horizontal halus (x: 12, 0.2s).
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

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function SidebarNavItem({
  item,
  active,
  collapsed,
  onSelect,
}: {
  item: NavItemDef;
  active: boolean;
  collapsed: boolean;
  onSelect: (value: string) => void;
}) {
  const button = (
    <button
      type="button"
      onClick={() => onSelect(item.value)}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-rose-600 text-white shadow-sm hover:bg-rose-700"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
        collapsed && "lg:justify-center lg:px-0",
      )}
    >
      <item.icon className="size-4 shrink-0" aria-hidden="true" />
      <span className={cn("min-w-0 truncate", collapsed && "lg:hidden")}>
        {item.label}
      </span>
    </button>
  );

  // Saat mode ciut (desktop), label disembunyikan — ganti dengan tooltip.
  if (!collapsed) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

function SidebarShell({
  siteName,
  session,
  role,
  activeTab,
  collapsed,
  onNavigate,
  onToggleCollapse,
  onCloseMobile,
  onLogout,
  variant,
}: {
  siteName: string;
  session: AdminSession;
  role: Role;
  activeTab: string;
  collapsed: boolean;
  onNavigate: (value: string) => void;
  onToggleCollapse?: () => void;
  onCloseMobile: () => void;
  onLogout: () => void;
  variant: "desktop" | "mobile";
}) {
  // Drawer seluler selalu lebar; mode ciut hanya berlaku di desktop.
  const isCollapsed = variant === "desktop" && collapsed;

  const initials =
    (session.name ?? "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase())
      .join("") || "?";

  const roleBadge = (
    <Badge variant="outline" className={cn("mt-0.5", roleBadgeClass(role))}>
      {ROLE_LABELS[role]}
    </Badge>
  );

  const avatar = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-600 to-amber-500 text-xs font-bold text-white">
          {initials}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right">{session.name}</TooltipContent>
    </Tooltip>
  );
  return (
    <>
      {/* Brand */}
      <div
        className={cn(
          "flex items-center gap-3 border-b px-4 py-4",
          isCollapsed && "lg:justify-center lg:px-2",
        )}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-600 to-amber-500 p-2">
          <LayoutDashboard className="size-5 text-white" aria-hidden="true" />
        </div>
        <div className={cn("min-w-0 flex-1", isCollapsed && "lg:hidden")}>
          <p className="truncate font-bold leading-tight">Panel Admin</p>
          <p className="truncate text-xs text-muted-foreground">
            {siteName || "\u00A0"}
          </p>
        </div>
        {variant === "mobile" ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0"
            onClick={onCloseMobile}
            aria-label="Tutup menu navigasi"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {/* Navigasi berkelompok */}
      <nav
        aria-label="Navigasi panel admin"
        className="nice-scrollbar flex-1 overflow-y-auto px-3 pb-3"
      >
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter(
            (item) => !item.roles || item.roles.includes(role),
          );
          if (items.length === 0) return null;
          return (
            <div key={group.title}>
              {isCollapsed ? (
                <div
                  className="mx-auto my-2 h-px w-6 bg-border"
                  role="presentation"
                />
              ) : (
                <p
                  className={cn(
                    "px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase",
                    variant === "mobile" ? "pt-4" : "pt-3",
                  )}
                >
                  {group.title}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <SidebarNavItem
                    key={item.value}
                    item={item}
                    active={item.value === activeTab}
                    collapsed={isCollapsed}
                    onSelect={onNavigate}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Kaki sidebar: tombol ciutkan (desktop) + kartu pengguna */}
      <div className="border-t px-3 py-3">
        {variant === "desktop" ? (
          isCollapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="mx-auto flex size-10"
                  onClick={onToggleCollapse}
                  aria-label="Perluas sidebar"
                >
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Perluas sidebar</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              variant="ghost"
              className="h-10 w-full justify-start gap-3 px-3 text-sm text-muted-foreground"
              onClick={onToggleCollapse}
            >
              <PanelLeftClose className="size-4 shrink-0" aria-hidden="true" />
              Ciutkan
            </Button>
          )
        ) : null}

        <div
          className={cn(
            "mt-2 flex items-center gap-3",
            isCollapsed && "flex-col items-center gap-2",
          )}
        >
          {isCollapsed ? (
            avatar
          ) : (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-600 to-amber-500 text-xs font-bold text-white">
              {initials}
            </span>
          )}
          <div className={cn("min-w-0 flex-1", isCollapsed && "lg:hidden")}>
            <p className="truncate text-sm leading-tight font-semibold">
              {session.name}
            </p>
            {isCollapsed ? (
              <div className="flex justify-center">{roleBadge}</div>
            ) : (
              roleBadge
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground"
            onClick={onLogout}
            aria-label="Keluar dari panel admin"
          >
            <LogOut className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </>
  );
}

export function AdminApp({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [session, setSession] = useState<AdminSession | null>(null);
  const [siteName, setSiteName] = useState("");
  const [activeTab, setActiveTab] = useState(() => {
    // Deep-link #admin/posisi/<id> → buka tab Posisi langsung.
    if (typeof window !== "undefined" && window.location.hash.startsWith("#admin/posisi")) {
      return "positions";
    }
    return "dashboard";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // Mode ciut sidebar — tersimpan di localStorage agar diperlakukan abadi.
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("lumina-admin-sidebar") === "collapsed";
    } catch {
      return false;
    }
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(
          "lumina-admin-sidebar",
          next ? "collapsed" : "open",
        );
      } catch {
        /* penyimpanan tidak tersedia — abaikan */
      }
      return next;
    });
  }, []);

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

  // Tutup drawer seluler dengan tombol Escape.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Deep-link #admin/posisi/<id> juga berlaku saat aplikasi sudah terbuka:
  // perubahan hash (mis. menempel link atau back/forward) memindahkan tab.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#admin/posisi")) {
        setActiveTab("positions");
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  const handleNavigate = useCallback((value: string) => {
    setActiveTab(value);
    setMobileOpen(false);
  }, []);

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

  // Tab aktif harus masih tersedia untuk peran ini (mis. turun peran),
  // jika tidak, kembali ke dashboard.
  const effectiveTab = ALL_NAV_ITEMS.some(
    (item) =>
      item.value === activeTab && (!item.roles || item.roles.includes(role)),
  )
    ? activeTab
    : "dashboard";
  const activeLabel =
    ALL_NAV_ITEMS.find((item) => item.value === effectiveTab)?.label ??
    "Panel Admin";

  return (
    <AdminSessionProvider value={sessionContextValue}>
      <NewApplicationToaster />
      <div className="flex min-h-screen bg-zinc-50 dark:bg-background">
        {/* Overlay drawer seluler */}
        {mobileOpen ? (
          <div
            className="fixed inset-0 z-40 bg-zinc-950/40 backdrop-blur-[2px] lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        ) : null}

        {/* Sidebar — hanya tampil di desktop; di seluler digantikan drawer */}
        <aside
          className={cn(
            "hidden flex-col border-r bg-background transition-[width] duration-200 lg:sticky lg:top-0 lg:h-screen lg:flex",
            collapsed ? "lg:w-[4.5rem]" : "lg:w-64",
          )}
        >
          <SidebarShell
            siteName={siteName}
            session={session}
            role={role}
            activeTab={effectiveTab}
            collapsed={collapsed}
            onNavigate={handleNavigate}
            onToggleCollapse={toggleCollapsed}
            onCloseMobile={() => setMobileOpen(false)}
            onLogout={() => void handleLogout()}
            variant="desktop"
          />
        </aside>

        {/* Drawer seluler */}
        {mobileOpen ? (
          <aside className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-background shadow-xl lg:hidden">
            <SidebarShell
              siteName={siteName}
              session={session}
              role={role}
              activeTab={effectiveTab}
              collapsed={false}
              onNavigate={handleNavigate}
              onCloseMobile={() => setMobileOpen(false)}
              onLogout={() => void handleLogout()}
              variant="mobile"
            />
          </aside>
        ) : null}

        {/* Kolom konten */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 lg:hidden"
                  onClick={() => setMobileOpen(true)}
                  aria-label="Buka menu navigasi"
                >
                  <Menu className="size-5" aria-hidden="true" />
                </Button>
                <div className="min-w-0">
                  <p className="truncate leading-tight font-bold">
                    {activeLabel}
                  </p>
                  <p className="truncate text-xs text-muted-foreground sm:hidden">
                    Panel Admin
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <RealtimeIndicator />
                <ThemeToggle />
                <NotificationBell onOpenTasks={() => setActiveTab("tasks")} />
                <AdminAskWidget />
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
            {effectiveTab === "dashboard" ? (
              <TabReveal>
                <DashboardTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "tasks" ? (
              <TabReveal>
                <TasksTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "pipeline" ? (
              <TabReveal>
                <PipelineTab onNavigate={setActiveTab} />
              </TabReveal>
            ) : null}
            {effectiveTab === "applications" ? (
              <TabReveal>
                <ApplicationsTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "interview" ? (
              <TabReveal>
                <InterviewTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "calendar" ? (
              <TabReveal>
                <CalendarTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "analytics" ? (
              <TabReveal>
                <AnalyticsTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "logs" ? (
              <TabReveal>
                <LogsTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "positions" && isOwnerOrHr ? (
              <TabReveal>
                <PositionsTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "hire" ? (
              <TabReveal>
                <HireTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "reports" ? (
              <TabReveal>
                <ReportsTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "templates" ? (
              <TabReveal>
                <TemplatesTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "data" && isOwner ? (
              <TabReveal>
                <DataTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "users" && isOwner ? (
              <TabReveal>
                <UsersTab />
              </TabReveal>
            ) : null}
            {effectiveTab === "settings" && isOwner ? (
              <TabReveal>
                <SettingsTab />
              </TabReveal>
            ) : null}
          </main>
        </div>
      </div>
    </AdminSessionProvider>
  );
}
