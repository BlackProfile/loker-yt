"use client";

// Primitif formulir posisi yang dipakai bersama oleh halaman-halaman setelan
// per posisi (Konten, Penerimaan, Seleksi, Wawancara, Pesan) di
// position-form-page.tsx & position-settings-pages.tsx.
// Dipisah dari position-form-page.tsx agar tiap sub-halaman Kelola bisa
// memakai komponen section dan util validasi yang konsisten.
// Setiap FormSection kini KARTU TERPISAH dengan latar sendiri, bisa
// diciutkan (dropdown) lewat header, dan default-nya TERTUTUP agar
// formulir panjang mudah dipindai. Section dengan error validasi membuka
// otomatis lewat prop hasError.

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Section fitur sebagai kartu terpisah: ikon dalam kotak rose + judul +
// petunjuk singkat + chevron. Klik header untuk membuka/menutup isi.
export function FormSection({
  id,
  icon: Icon,
  title,
  hint,
  children,
  defaultOpen = false,
  hasError = false,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  children: ReactNode;
  /** Buka saat pertama render (default: tertutup). */
  defaultOpen?: boolean;
  /** Tandai merah + buka otomatis saat section ini punya error validasi. */
  hasError?: boolean;
}) {
  const [userOpen, setOpen] = useState(defaultOpen);
  const bodyId = `formsec-body-${id}`;

  // Selalu terbuka selama section punya error validasi agar isian bermasalah
  // terlihat — dicek langsung saat render, tanpa effect.
  const open = hasError ? true : userOpen;

  return (
    <section
      aria-labelledby={`formsec-${id}`}
      className="gap-0 rounded-2xl border bg-card p-5 text-card-foreground shadow-sm md:p-6"
    >
      <h3 id={`formsec-${id}`} className="flex">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex w-full items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight">
              {title}
            </span>
            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
              {hint}
            </span>
          </span>
          {hasError ? (
            <span
              className="size-2 shrink-0 rounded-full bg-rose-500"
              aria-hidden="true"
            />
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
      {open ? (
        <div id={bodyId} className="mt-4 flex flex-col gap-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function isInt(value: string): boolean {
  return /^-?\d+$/.test(value.trim());
}

export const PUB_MODE = {
  tayang: {
    label: "Tayang",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  },
  terjadwal: {
    label: "Terjadwal",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
  draft: {
    label: "Draft",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  tutup: {
    label: "Tutup",
    className:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  },
} as const;

export function formPublicationMode(form: {
  isActive: boolean;
  publishAtLocal: string;
  closesAtLocal: string;
}): {
  key: keyof typeof PUB_MODE;
  hint: string;
} {
  if (!form.isActive) {
    return { key: "draft", hint: "Posisi tidak tampil di halaman publik." };
  }
  if (form.publishAtLocal) {
    const t = new Date(form.publishAtLocal).getTime();
    if (!Number.isNaN(t) && t > Date.now()) {
      return {
        key: "terjadwal",
        hint: "Posisi otomatis tayang tepat pada jadwal publikasi di atas.",
      };
    }
  }
  if (form.closesAtLocal) {
    const t = new Date(form.closesAtLocal).getTime();
    if (!Number.isNaN(t) && t <= Date.now()) {
      return {
        key: "tutup",
        hint: "Posisi sudah melewati tanggal penutupan dan tidak menerima lamaran baru.",
      };
    }
  }
  return { key: "tayang", hint: "Posisi tampil di halaman publik sekarang." };
}

// Contoh template pesan otomatis — dipakai tombol "Isi contoh" di halaman Pesan.
export const DEMO_TEMPLATES = {
  apply:
    "Terima kasih {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Pantau statusnya kapan saja dengan kode {kode}.",
  accept:
    "Selamat {nama}, kamu diterima untuk posisi {posisi}! Tim kami akan menghubungimu untuk langkah selanjutnya.",
  reject:
    "Terima kasih {nama}, setelah meninjau lamaranmu untuk posisi {posisi}, kami memutuskan untuk tidak melanjutkan proses. Semoga sukses di kesempatan berikutnya!",
};

// Batas dokumen wajib tambahan (halaman Penerimaan) — selaras server.
export const MAX_CUSTOM_DOCS = 8;
export const CUSTOM_DOC_MAX_LEN = 80;

// Sentinel opsi "(nonaktif)" — Radix Select melarang SelectItem dengan value "".
export const SHORTLIST_NONE = "__nonaktif__";
