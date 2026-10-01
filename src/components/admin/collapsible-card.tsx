"use client";

// Kartu section yang bisa DICIUTKAN (dropdown) — default TERTUTUP.
// Dipakai kartu-kartu setelan di tab Pengaturan & Data agar halaman panjang
// mudah dipindai: setiap kartu punya latar sendiri (kartu terpisah), header
// berisi ikon rose + judul + deskripsi + chevron yang bisa diklik untuk
// membuka/menutup isi. Aksi tambahan (tombol di header) tetap tampil saat
// kartu tertutup lewat prop `actions`.

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function CollapsibleCard({
  id,
  icon: Icon,
  title,
  description,
  children,
  defaultOpen = false,
  actions,
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
