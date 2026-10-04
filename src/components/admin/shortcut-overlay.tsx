"use client";

// NR-28 (item 14) — Overlay pintasan keyboard panel admin.
// Tombol "?" (Shift + /) membuka dialog daftar pintasan yang benar-benar
// terpasang di panel admin (Ctrl/Cmd+K untuk palet perintah, Esc untuk
// menutup dialog). Listener global mengabaikan ketukan saat fokus berada di
// input/textarea/select/contentEditable agar tidak mengganggu pengisian form.
// Komponen dikendalikan induk (admin-app) sehingga tombol ikon Keyboard di
// header membuka overlay yang sama.

import { useEffect, useRef } from "react";
import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** True bila fokus sedang berada di elemen ketik (input, textarea, dst). */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** Kapsul kecil untuk menampilkan tombol keyboard (styling kbd). */
function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md border bg-muted px-1.5 font-mono text-xs font-medium text-foreground">
      {children}
    </kbd>
  );
}

/** Satu baris daftar pintasan: keterangan kiri, tombol-tombol di kanan. */
function ShortcutRow({ label, keys }: { label: string; keys: string[] }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border px-3 py-2.5">
      <span className="min-w-0 text-sm">{label}</span>
      <span className="flex shrink-0 items-center gap-1">
        {keys.map((key) => (
          <Kbd key={key}>{key}</Kbd>
        ))}
      </span>
    </div>
  );
}

export function ShortcutOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Ref agar listener tidak perlu dipasang ulang saat state open berubah,
  // sekaligus memungkinkan toggle "?" yang akurat.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Hanya tombol "?" polos (Shift + /) — tanpa modifier agar tidak
      // menabrak kombinasi aplikasi/OS lain.
      if (event.key !== "?") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      onOpenChange(!openRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Pintasan Keyboard
          </DialogTitle>
          <DialogDescription>
            Tekan tombol berikut di mana saja saat panel admin terbuka.
          </DialogDescription>
        </DialogHeader>

        {/* Daftar pintasan NYATA yang terpasang di panel admin. */}
        <div className="flex flex-col gap-2">
          <ShortcutRow
            label="Buka palet perintah (cari tab, posisi, pelamar)"
            keys={["Ctrl", "K"]}
          />
          <ShortcutRow
            label="Buka / tutup daftar pintasan ini"
            keys={["?"]}
          />
          <ShortcutRow
            label="Tutup dialog atau palet yang terbuka"
            keys={["Esc"]}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Pengguna macOS dapat memakai tombol Command sebagai pengganti Ctrl.
        </p>
      </DialogContent>
    </Dialog>
  );
}
