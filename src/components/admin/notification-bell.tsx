"use client";

// Pusat notifikasi admin — tombol lonceng di header dengan badge hitam jumlah
// belum dibaca. GET /api/admin/notifications (50 terbaru + unreadCount),
// PATCH { id } untuk tandai satu dibaca atau { all: true } untuk semua.
// Data segar: polling ringan tiap 30 detik + refresh saat event realtime
// "applications:changed" (lewat useLiveRefresh, pemakaian useLiveEvent di admin).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bell,
  BellOff,
  CheckCheck,
  Info,
  ListTodo,
  Loader2,
  Shield,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Video,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiGet, apiPatch, apiPut } from "./api";
import { formatRelative } from "./format";
import { useLiveRefresh } from "./use-live-refresh";

type NotificationRow = {
  id: string;
  title: string;
  body: string | null;
  category: string;
  applicationId: string | null;
  applicationName: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationsResponse = {
  notifications: NotificationRow[];
  unreadCount: number;
  // NR46 — jumlah notifikasi disembunyikan oleh preferensi/jam senyap sesi.
  filteredOut?: number;
};

// NR46 — preferensi notifikasi (kontrak /api/admin/notification-prefs).
type NotifyCategory = "APPLICATION" | "INTERVIEW" | "OFFER" | "SYSTEM" | "LOGIN";

type NotifyPrefs = {
  categories: Record<NotifyCategory, boolean>;
  silentFrom: number | null; // jam 0-23, null = nonaktif
  silentTo: number | null;
};

const PREF_CATEGORIES: { key: NotifyCategory; label: string }[] = [
  { key: "APPLICATION", label: "Lamaran" },
  { key: "INTERVIEW", label: "Wawancara" },
  { key: "OFFER", label: "Offer" },
  { key: "SYSTEM", label: "Sistem" },
  { key: "LOGIN", label: "Login" },
];

const HOUR_OPTIONS: number[] = Array.from({ length: 24 }, (_, h) => h);

function hourLabel(h: number): string {
  return `${String(h).padStart(2, "0")}:00`;
}

// Ikon per kategori notifikasi; lainnya = Info.
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  OFFER: Sparkles,
  INTERVIEW: Video,
  APPLICATION: UserPlus,
  LOGIN: Shield,
};

function categoryIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Info;
}

function categoryLabel(category: string): string {
  switch (category) {
    case "OFFER":
      return "Penawaran";
    case "INTERVIEW":
      return "Wawancara";
    case "APPLICATION":
      return "Lamaran";
    case "LOGIN":
      return "Login";
    default:
      return "Sistem";
  }
}

export function NotificationBell({ onOpenTasks }: { onOpenTasks?: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filteredOut, setFilteredOut] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const inFlightRef = useRef(false);

  // NR46 — panel "Preferensi Notifikasi Saya".
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefs, setPrefs] = useState<NotifyPrefs>({
    categories: { APPLICATION: true, INTERVIEW: true, OFFER: true, SYSTEM: true, LOGIN: true },
    silentFrom: null,
    silentTo: null,
  });

  const load = useCallback(async () => {
    if (inFlightRef.current) return; // hindari request bertumpuk (polling + realtime)
    inFlightRef.current = true;
    try {
      const data = await apiGet<NotificationsResponse>("/api/admin/notifications");
      setItems(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
      setFilteredOut(Number(data.filteredOut ?? 0));
    } catch {
      // Senyap: lonceng tidak boleh bising saat jaringan bermasalah.
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, []);

  // Muat awal + polling ringan tiap 30 detik.
  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  // Refresh senyap saat event realtime lamaran datang.
  useLiveRefresh("applications:changed", () => {
    void load();
  });

  // Segarkan saat popover dibuka (jangan hanya mengandalkan polling).
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function handleMarkRead(item: NotificationRow) {
    if (item.isRead) return;
    // Optimistik: dot hilang segera, API menyusul.
    setItems((prev) =>
      prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n))
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));
    try {
      const res = await apiPatch<{ ok: boolean; unreadCount: number }>(
        "/api/admin/notifications",
        { id: item.id }
      );
      setUnreadCount(res.unreadCount);
    } catch {
      // Kembalikan bila gagal.
      setItems((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, isRead: false } : n))
      );
      setUnreadCount((prev) => prev + 1);
    }
  }

  async function handleMarkAllRead() {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    try {
      await apiPatch("/api/admin/notifications", { all: true });
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch {
      // Biarkan polling berikutnya memperbaiki state.
    } finally {
      setMarkingAll(false);
    }
  }

  // NR46 — buka panel preferensi: muat preferensi sesi untuk prefill.
  async function openPrefs() {
    setPrefsOpen(true);
    setPrefsLoading(true);
    try {
      const data = await apiGet<{ prefs: NotifyPrefs }>("/api/admin/notification-prefs");
      setPrefs({
        categories: {
          APPLICATION: data.prefs?.categories?.APPLICATION !== false,
          INTERVIEW: data.prefs?.categories?.INTERVIEW !== false,
          OFFER: data.prefs?.categories?.OFFER !== false,
          SYSTEM: data.prefs?.categories?.SYSTEM !== false,
          LOGIN: data.prefs?.categories?.LOGIN !== false,
        },
        silentFrom: data.prefs?.silentFrom ?? null,
        silentTo: data.prefs?.silentTo ?? null,
      });
    } catch {
      // Prefill gagal: pakai nilai terakhir/bawaan; simpan tetap dicoba.
    } finally {
      setPrefsLoading(false);
    }
  }

  // NR46 — simpan preferensi (kategori + jam senyap; null = nonaktif).
  async function savePrefs() {
    if (prefsSaving) return;
    setPrefsSaving(true);
    try {
      await apiPut<{ ok: boolean; prefs: NotifyPrefs }>("/api/admin/notification-prefs", {
        categories: prefs.categories,
        silentFrom: prefs.silentFrom,
        silentTo: prefs.silentTo,
      });
      toast.success("Preferensi notifikasi disimpan");
      setPrefsOpen(false);
      // Muat ulang daftar agar hasil penyaringan langsung terlihat.
      await load();
    } catch {
      toast.error("Gagal menyimpan preferensi notifikasi.");
    } finally {
      setPrefsSaving(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="relative size-11 sm:size-9"
          aria-label={
            unreadCount > 0
              ? `Notifikasi (${unreadCount} belum dibaca)`
              : "Notifikasi"
          }
        >
          <Bell className="size-4" aria-hidden="true" />
          {unreadCount > 0 ? (
            <span
              className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-950 px-1 text-[10px] font-bold leading-none text-white dark:bg-zinc-50 dark:text-zinc-950"
              aria-hidden="true"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1.5rem))] p-0"
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifikasi</p>
          <div className="flex shrink-0 items-center gap-1">
            {unreadCount > 0 && !prefsOpen ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={() => void handleMarkAllRead()}
                disabled={markingAll}
              >
                <CheckCheck className="size-3.5" aria-hidden="true" />
                Tandai semua dibaca
              </Button>
            ) : null}
            {/* NR46 — Preferensi Notifikasi Saya. */}
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 gap-1.5 px-2 text-xs",
                prefsOpen && "bg-accent text-foreground",
              )}
              onClick={() => {
                if (prefsOpen) {
                  setPrefsOpen(false);
                } else {
                  void openPrefs();
                }
              }}
              aria-pressed={prefsOpen}
              aria-label="Preferensi notifikasi saya"
            >
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              Preferensi
            </Button>
          </div>
        </div>

        {prefsOpen ? (
          /* NR46 — panel preferensi inline di dalam popover. */
          <div className="flex flex-col gap-3 px-4 py-3">
            {prefsLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Memuat preferensi...
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Kategori
                  </p>
                  {PREF_CATEGORIES.map((cat) => (
                    <label
                      key={cat.key}
                      className="flex min-h-9 items-center justify-between gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted/60"
                    >
                      <span className="text-sm">{cat.label}</span>
                      <Switch
                        checked={prefs.categories[cat.key]}
                        onCheckedChange={(checked) =>
                          setPrefs((p) => ({
                            ...p,
                            categories: { ...p.categories, [cat.key]: checked },
                          }))
                        }
                        aria-label={`Tampilkan notifikasi kategori ${cat.label}`}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Jam senyap
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="notif-silent-from" className="text-xs text-muted-foreground">
                        Mulai
                      </Label>
                      <Select
                        value={prefs.silentFrom == null ? "off" : String(prefs.silentFrom)}
                        onValueChange={(v) =>
                          setPrefs((p) => ({
                            ...p,
                            silentFrom: v === "off" ? null : Number(v),
                          }))
                        }
                      >
                        <SelectTrigger id="notif-silent-from" className="h-9 w-full" aria-label="Jam mulai senyap">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Nonaktif</SelectItem>
                          {HOUR_OPTIONS.map((h) => (
                            <SelectItem key={h} value={String(h)}>
                              {hourLabel(h)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label htmlFor="notif-silent-to" className="text-xs text-muted-foreground">
                        Selesai
                      </Label>
                      <Select
                        value={prefs.silentTo == null ? "off" : String(prefs.silentTo)}
                        onValueChange={(v) =>
                          setPrefs((p) => ({
                            ...p,
                            silentTo: v === "off" ? null : Number(v),
                          }))
                        }
                      >
                        <SelectTrigger id="notif-silent-to" className="h-9 w-full" aria-label="Jam selesai senyap">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="off">Nonaktif</SelectItem>
                          {HOUR_OPTIONS.map((h) => (
                            <SelectItem key={h} value={String(h)}>
                              {hourLabel(h)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Selama jam senyap, hanya notifikasi Sistem yang tetap tampil.
                  </p>
                </div>
                <Button
                  className="h-9"
                  disabled={prefsSaving}
                  onClick={() => void savePrefs()}
                >
                  {prefsSaving ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Menyimpan...
                    </>
                  ) : (
                    "Simpan Preferensi"
                  )}
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            {filteredOut > 0 ? (
              <p className="border-b px-4 py-2 text-xs text-muted-foreground">
                {filteredOut} notifikasi disembunyikan oleh preferensi/jam senyap Anda.
              </p>
            ) : null}
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <span
                  className="size-1.5 animate-pulse rounded-full bg-rose-600"
                  aria-hidden="true"
                />
                Memuat notifikasi...
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <BellOff className="size-5 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Belum ada notifikasi. Aktivitas lamaran &amp; offer akan muncul di sini.
                </p>
              </div>
            ) : (
              <ul
                className="max-h-96 divide-y overflow-y-auto nice-scrollbar"
                aria-label="Daftar notifikasi"
              >
            {items.map((item) => {
              const Icon = categoryIcon(item.category);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60",
                      !item.isRead && "bg-muted"
                    )}
                    onClick={() => void handleMarkRead(item)}
                    aria-label={`Tandai notifikasi "${item.title}" sebagai dibaca`}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border bg-background",
                        !item.isRead
                          ? "border-rose-200 text-rose-600 dark:border-rose-900 dark:text-rose-400"
                          : "text-muted-foreground"
                      )}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        {!item.isRead ? (
                          <span
                            className="size-2 shrink-0 rounded-full bg-rose-600"
                            aria-hidden="true"
                          />
                        ) : null}
                        <span
                          className={cn(
                            "truncate text-sm",
                            !item.isRead ? "font-semibold" : "font-medium text-foreground/80"
                          )}
                        >
                          {item.title}
                        </span>
                      </span>
                      {item.body ? (
                        <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                          {item.body}
                        </span>
                      ) : null}
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>{categoryLabel(item.category)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRelative(item.createdAt)}</span>
                        {item.applicationName ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{item.applicationName}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
              </ul>
            )}
          </>
        )}

        <div className="border-t px-4 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-center gap-1.5 text-xs"
            onClick={() => {
              setOpen(false);
              onOpenTasks?.();
            }}
          >
            <ListTodo className="size-3.5" aria-hidden="true" />
            Lihat pusat tugas
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
