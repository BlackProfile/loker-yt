"use client";

// NR63 — Pengumuman publik untuk pelamar di halaman utama.
// Sumber data: GET /api/public/notices (tanpa login, hanya pengumuman isPublic).
// Perilaku:
//  1) Popup dialog otomatis saat ada pengumuman yang belum pernah dibaca
//     pengunjung (status "sudah dibaca" disimpan di localStorage per browser).
//  2) Menutup dengan tombol "Mengerti" = semua pengumuman tampilan ditandai
//     sudah dibaca — popup & chip tidak muncul lagi untuk pengumuman itu.
//  3) Menutup dengan X / klik luar / Esc = menunda (snooze per sesi tab via
//     sessionStorage): popup tidak auto-muncul berulang di sesi tab yang sama,
//     tetapi chip megafon mengapung (kiri-bawah) tetap ada untuk dibuka ulang.
// Halaman mode perawatan penuh tidak merender komponen ini (dipasang di
// LandingShell setelah early-return perawatan).

import { useCallback, useEffect, useState } from "react";
import { Megaphone, Pin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/landing/lang-context";
import { formatDateTimeId } from "@/components/landing/landing-utils";

type PublicNotice = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
};

// Kunci localStorage daftar id pengumuman yang sudah dibaca pengunjung.
const SEEN_KEY = "lumina-notice-seen-v1";
// Kunci sessionStorage penanda "snooze": pengguna menutup popup tanpa
// "Mengerti" — jangan auto-muncul lagi dalam sesi tab ini (chip tetap ada).
const SNOOZE_KEY = "lumina-notice-snoozed-v1";
// Jeda sebelum fetch agar konten utama halaman selesai dimuat dulu.
const FETCH_DELAY_MS = 1500;
// Batas daftar id yang disimpan agar localStorage tidak membengkak.
const SEEN_CAP = 50;

function readSeenIds(): string[] {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string").slice(-SEEN_CAP);
  } catch {
    return [];
  }
}

function writeSeenIds(ids: string[]) {
  try {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_CAP)));
  } catch {
    // Penyimpanan penuh/diblokir — abaikan; popup boleh muncul lagi nanti.
  }
}

function readSnoozed(): boolean {
  try {
    return window.sessionStorage.getItem(SNOOZE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSnoozed(value: boolean) {
  try {
    if (value) window.sessionStorage.setItem(SNOOZE_KEY, "1");
    else window.sessionStorage.removeItem(SNOOZE_KEY);
  } catch {
    // Abaikan — fallback perilaku: popup boleh muncul lagi.
  }
}

export function PublicNotice() {
  const { t } = useLang();
  const [notices, setNotices] = useState<PublicNotice[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // NR63 — set id yang sudah dibaca; state (bukan ref) karena dipakai saat render
  // untuk menentukan visibilitas chip mengapung.
  const [seenIds, setSeenIds] = useState<Set<string>>(() => new Set());

  const hasUnseen = loaded && notices.length > 0 && notices.some((n) => !seenIds.has(n.id));

  // Muat pengumuman publik sekali per kunjungan, setelah halaman tenang.
  useEffect(() => {
    let disposed = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/public/notices", { cache: "no-cache" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (disposed || !Array.isArray(data)) return;
        const rows: PublicNotice[] = data
          .filter(
            (v): v is PublicNotice =>
              !!v &&
              typeof v === "object" &&
              typeof (v as PublicNotice).id === "string" &&
              typeof (v as PublicNotice).title === "string" &&
              typeof (v as PublicNotice).body === "string"
          )
          .slice(0, 5);
        const awal = new Set(readSeenIds());
        setSeenIds(awal);
        setNotices(rows);
        setLoaded(true);
        // Popup otomatis hanya untuk pengumuman yang belum dibaca — dan
        // dilewati bila pengguna sudah menunda di sesi tab ini (chip tetap ada).
        if (rows.length > 0 && rows.some((n) => !awal.has(n.id)) && !readSnoozed()) {
          setOpen(true);
        }
      } catch {
        // Gagal fetch: halaman publik tetap tenang tanpa pengumuman.
      }
    }, FETCH_DELAY_MS);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Tutup/buka dialog biasa (X, klik luar, Esc, chip) — TIDAK menandai
  // sudah dibaca; hanya menandai snooze agar tidak auto-muncul berulang
  // dalam sesi tab yang sama. Penandaan dibaca lewat tombol "Mengerti".
  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) writeSnoozed(true);
  }, []);

  // "Mengerti" — tandai seluruh pengumuman tampilan sudah dibaca (localStorage)
  // lalu tutup dialog; chip mengapung ikut hilang.
  const markAllSeen = useCallback(() => {
    if (notices.length > 0) {
      const next = new Set(seenIds);
      for (const n of notices) next.add(n.id);
      setSeenIds(next);
      writeSeenIds([...next]);
    }
    writeSnoozed(false);
    setOpen(false);
  }, [notices, seenIds]);

  return (
    <>
      {/* Chip megafon mengapung — hanya saat ada pengumuman belum dibaca. */}
      {hasUnseen && !open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t.notice.chipAria}
          className={cn(
            // bottom-20 (80px) agar tidak menabrak indikator Next.js DevTools
            // (kiri-bawah, mode dev) maupun elemen lain di sudut layar.
            "fixed bottom-20 left-4 z-40 flex size-12 items-center justify-center",
            "rounded-full border bg-background/95 shadow-lg backdrop-blur",
            "transition-transform hover:scale-105 focus-visible:outline-none",
            "focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          )}
        >
          <Megaphone className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <span
            className="absolute right-0.5 top-0.5 size-3 rounded-full bg-rose-600 ring-2 ring-background"
            aria-hidden="true"
          />
        </button>
      ) : null}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400"
              >
                <Megaphone className="size-4.5" />
              </span>
              {t.notice.title}
            </DialogTitle>
            <DialogDescription>{t.notice.desc}</DialogDescription>
          </DialogHeader>

          {notices.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{t.notice.empty}</p>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto nice-scrollbar">
              <ul className="flex flex-col divide-y">
                {notices.map((item, idx) => (
                  <li key={item.id} className={cn("py-3", idx === 0 && "pt-0")}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{item.title}</p>
                      {item.pinned ? (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                        >
                          <Pin className="size-3" aria-hidden="true" />
                          {t.notice.pinned}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                    <p className="mt-1.5 text-[11px] text-muted-foreground/80">
                      {formatDateTimeId(item.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button className="w-full sm:w-auto" onClick={markAllSeen}>
              {t.notice.gotIt}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
