"use client";

import {
  Bell,
  Bot,
  Briefcase,
  CircleHelp,
  Eye,
  FileText,
  Flag,
  Gift,
  Info,
  ListOrdered,
  MessagesSquare,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CollapsibleCard } from "./collapsible-card";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  type SectionKey,
  type SectionVisibility,
} from "@/lib/types";

// Ikon lucide kecil per kunci bagian halaman publik.
const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  hero: Sparkles,
  positions: Briefcase,
  about: Info,
  benefits: Gift,
  steps: ListOrdered,
  applyForm: FileText,
  statusCheck: Search,
  testimonials: MessagesSquare,
  faq: CircleHelp,
  subscribe: Bell,
  finalCta: Flag,
  chatbot: Bot,
};

// Hint khusus untuk kasus penting (tampil saat bagian dinonaktifkan).
const SECTION_HINTS: Partial<Record<SectionKey, string>> = {
  positions:
    "Posisi tetap terbuka di dashboard & RSS/embed, hanya disembunyikan di halaman publik.",
  applyForm:
    "Pelamar tidak dapat mengirim lamaran dari halaman publik. Buka/tutup per posisi ada di tab Posisi.",
  chatbot: "Widget disembunyikan; saklar utama chatbot tetap di atas.",
};

// Lengkapi data lama: kunci yang hilang dianggap true agar Switch terkontrol penuh.
export function normalizeSections(input: unknown): SectionVisibility {
  const source =
    typeof input === "object" && input !== null
      ? (input as Partial<Record<SectionKey, unknown>>)
      : {};
  const result = {} as SectionVisibility;
  for (const key of SECTION_KEYS) {
    result[key] = typeof source[key] === "boolean" ? (source[key] as boolean) : true;
  }
  return result;
}

export function SectionVisibilityCard({
  sections,
  onChange,
}: {
  sections: SectionVisibility;
  onChange: (key: SectionKey, value: boolean) => void;
}) {
  return (
    <CollapsibleCard
      id="tampilan-publik"
      icon={Eye}
      title="Tampilan Halaman Publik"
      description="Atur bagian mana yang tampil di halaman publik. Perubahan berlaku setelah disimpan."
    >
      <div className="flex flex-col">
        {SECTION_KEYS.map((key, index) => {
          const Icon = SECTION_ICONS[key];
          const hint = !sections[key] ? SECTION_HINTS[key] : undefined;
          return (
            <div key={key} className="flex flex-col">
              {/* Garis panjang pembatas antar fitur — selebar kartu */}
              {index > 0 ? (
                <div
                  aria-hidden="true"
                  className="h-px w-full bg-zinc-200 dark:bg-zinc-800"
                />
              ) : null}
              <div className="flex items-center justify-between gap-3 py-3.5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">
                      {SECTION_LABELS[key]}
                    </p>
                    {hint ? (
                      <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                        {hint}
                      </p>
                    ) : null}
                  </div>
                </div>
                <Switch
                  checked={sections[key]}
                  onCheckedChange={(checked) => onChange(key, checked)}
                  aria-label={`Tampilkan ${SECTION_LABELS[key]} di halaman publik`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </CollapsibleCard>
  );
}
