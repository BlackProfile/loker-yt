"use client";

// Kartu section yang bisa DICIUTKAN (dropdown) — default TERTUTUP.
// Dipakai kartu-kartu setelan di tab Pengaturan & Data agar halaman panjang
// mudah dipindai: setiap kartu punya latar sendiri (kartu terpisah), header
// berisi ikon rose + judul + deskripsi + chevron yang bisa diklik untuk
// membuka/menutup isi. Aksi tambahan (tombol di header) tetap tampil saat
// kartu tertutup lewat prop `actions`, dan ringkasan status terlihat tanpa
// membuka kartu lewat prop `status` (chip kecil bernada warna).

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Nada warna chip status header kartu. */
export type CardStatusTone = "neutral" | "ok" | "warn" | "danger";

/**
 * Ringkasan status singkat yang selalu terlihat di header kartu (walau kartu
 * tertutup) — mis. { label: "3 temuan", tone: "warn" } atau { label: "Aktif", tone: "ok" }.
 */
export type CardStatus = {
  label: string;
  tone?: CardStatusTone;
};

const STATUS_TONE_CLASS: Record<CardStatusTone, string> = {
  neutral:
    "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
  ok: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400",
  warn: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400",
  danger:
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-400",
};

export function CollapsibleCard({
  id,
  icon: Icon,
  title,
  description,
  children,
  defaultOpen = false,
  actions,
  status,
}: {
  /** ID unik untuk aria (controls/labelledby). */
  id: string;
  /** Ikon lucide opsional — dirender dalam kotak rose (gaya section formulir). */
  icon?: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
  /** Buka saat pertama render (default: tertutup). */
  defaultOpen?: boolean;
  /** Aksi tambahan di kanan header (tetap terlihat saat kartu tertutup). */
  actions?: ReactNode;
  /** Chip status di header — bagian dari tombol buka/tutup. */
  status?: CardStatus;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const headId = `collap-head-${id}`;
  const bodyId = `collap-body-${id}`;

  return (
    <section
      aria-labelledby={headId}
      className="gap-0 rounded-2xl border bg-card p-5 text-card-foreground shadow-sm md:p-6"
    >
      <div className="flex items-center gap-3">
        <h3 id={headId} className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="flex w-full items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {Icon ? (
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                <Icon className="size-4" aria-hidden="true" />
              </span>
            ) : null}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">
                {title}
              </span>
              {description ? (
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {description}
                </span>
              ) : null}
            </span>
            {status ? (
              <span
                className={cn(
                  "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums",
                  STATUS_TONE_CLASS[status.tone ?? "neutral"]
                )}
              >
                {status.label}
              </span>
            ) : null}
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {open ? (
        <div id={bodyId} className="mt-4 flex flex-col gap-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}
