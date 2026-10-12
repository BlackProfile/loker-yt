"use client";

// Label kelompok untuk menyusun beberapa CollapsibleCard menjadi segmen yang
// mudah dipindai di tab Data/Pengaturan/Dashboard. Murni presentasional:
// tidak mengubah perilaku kartu di dalamnya. Jarak antar kartu dalam satu
// kelompok lebih rapat (gap-3); jarak antar kelompok mengikuti wadah tab
// (gap-6) sehingga hierarki terlihat jelas.

import type { ReactNode } from "react";

export function SectionGroup({
  label,
  description,
  children,
}: {
  /** Nama kelompok, mis. "Backup & Pemulihan". */
  label: string;
  /** Keterangan singkat opsional di bawah nama kelompok. */
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <div className="px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </h2>
        {description ? (
          <p className="mt-0.5 text-xs text-muted-foreground/80">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
