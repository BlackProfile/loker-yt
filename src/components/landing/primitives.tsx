"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Clapperboard } from "lucide-react";
import { cn } from "@/lib/utils";

// Badge aksen rose yang aman untuk light & dark mode.
export const ROSE_BADGE =
  "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400";

// Chip ikon benefit (light & dark aman).
export const ICON_TILE =
  "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400";

export function Container({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

export function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

export function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "rounded-xl bg-gradient-to-br from-rose-600 to-amber-500 text-white",
        size === "md" ? "p-2" : "p-1.5",
      )}
    >
      <Clapperboard
        className={size === "md" ? "h-5 w-5" : "h-4 w-4"}
        aria-hidden="true"
      />
    </div>
  );
}
