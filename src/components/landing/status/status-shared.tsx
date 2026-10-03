"use client";

// Komponen kecil bersama untuk halaman Cek Status (#status) — NR-18-a.
// - DetailRow & FadeInSlide dipindahkan verbatim dari status-page.tsx.
// - StatusSection: pembungkus panel collapsible (Bagian 2 NR-18-a) dengan header
//   konsisten (ikon + judul + chevron berputar). State form di dalam konten
//   TIDAK di-reset saat dilipat/dibuka karena state form hidup di orchestrator.

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** Baris detail "Label: nilai" untuk kartu wawancara/penawaran. */
export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-medium">{value}</span>
    </p>
  );
}

/**
 * FadeIn lokal: slide lembut untuk kartu login (varian ringan dari primitives
 * tanpa IntersectionObserver — halaman status memakai mount-effect scrollTo).
 */
export function FadeInSlide({ children }: { children: ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Panel collapsible dengan header konsisten (NR-18-a Bagian 2):
 * ikon + judul + chevron berputar. Target sentuh header >= 44px (min-h-11).
 * Konten dirender Radix (unmount saat tertutup) — aman karena semua state form
 * panel-panel ini disimpan di orchestrator (StatusPageInner), bukan di DOM.
 */
export function StatusSection({
  icon: Icon,
  title,
  defaultOpen = false,
  containerClassName,
  triggerClassName,
  iconClassName,
  titleClassName,
  contentClassName,
  children,
}: {
  icon: LucideIcon;
  title: string;
  defaultOpen?: boolean;
  containerClassName?: string;
  triggerClassName?: string;
  iconClassName?: string;
  titleClassName?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-card text-card-foreground shadow-sm",
        containerClassName,
      )}
    >
      <Collapsible defaultOpen={defaultOpen}>
        <CollapsibleTrigger
          className={cn(
            "group flex min-h-11 w-full items-center gap-2.5 rounded-2xl px-5 py-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:px-6",
            triggerClassName,
          )}
          aria-label={title}
        >
          <Icon className={cn("h-4 w-4 shrink-0", iconClassName)} aria-hidden="true" />
          <span
            className={cn(
              "flex-1 text-sm font-semibold uppercase tracking-wide",
              titleClassName,
            )}
          >
            {title}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className={cn("px-5 pb-5 md:px-6 md:pb-6", contentClassName)}>
          {children}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
