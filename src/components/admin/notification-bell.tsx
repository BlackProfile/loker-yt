"use client";

// Pusat notifikasi admin — tombol lonceng di header dengan badge hitam jumlah
// belum dibaca. GET /api/admin/notifications (50 terbaru + unreadCount),
// PATCH { id } untuk tandai satu dibaca atau { all: true } untuk semua.
// Data segar: polling ringan tiap 30 detik + refresh saat event realtime
// "applications:changed" (lewat useLiveRefresh, pemakaian useLiveEvent di admin).

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Bell,
  BellOff,
  CheckCheck,
  Info,
  ListTodo,
  Shield,
  Sparkles,
  UserPlus,
  Video,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiGet, apiPatch } from "./api";
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
};

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
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    if (inFlightRef.current) return; // hindari request bertumpuk (polling + realtime)
    inFlightRef.current = true;
    try {
      const data = await apiGet<NotificationsResponse>("/api/admin/notifications");
      setItems(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
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
          {unreadCount > 0 ? (
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
        </div>

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
