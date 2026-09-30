"use client";

// Primitif formulir posisi yang dipakai bersama oleh halaman-halaman setelan
// per posisi (Konten, Penerimaan, Seleksi, Wawancara, Pesan) di
// position-form-page.tsx & position-settings-pages.tsx.
// Dipisah dari position-form-page.tsx agar tiap sub-halaman Kelola bisa
// memakai komponen section, pembatas, dan util validasi yang konsisten.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

// Garis panjang pembatas antar section fitur — selebar area formulir.
export function FormDivider() {
  return (
    <hr
      aria-hidden="true"
      className="h-px w-full border-0 bg-zinc-200 dark:bg-zinc-800"
    />
  );
}

// Header section fitur flat: ikon dalam kotak rose + judul + petunjuk singkat.
export function FormSection({
  id,
  icon: Icon,
  title,
  hint,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`formsec-${id}`} className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3
            id={`formsec-${id}`}
            className="text-sm font-semibold leading-tight"
          >
            {title}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
      </div>
      {children}
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
