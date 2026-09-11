"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
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

// Reveal berurutan: kontainer induk yang memainkan StaggerItem anak satu per satu.
// Wajib dipasangkan dengan <MotionConfig reducedMotion="user"> di root shell
// agar otomatis menghormati preferensi reduce-motion pengguna.
export function Stagger({
  children,
  className,
  gap = 0.08,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  gap?: number;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-80px" }}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: gap, delayChildren: delay } },
      }}
    >
      {children}
    </motion.div>
  );
}

// Anak dari <Stagger>: fade-up halus per item.
export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 20 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.45, ease: "easeOut" },
        },
      }}
    >
      {children}
    </motion.div>
  );
}

// Lift halus saat kursor hover — hanya transform (GPU-friendly).
export function HoverLift({
  children,
  className,
  amount = 4,
}: {
  children: ReactNode;
  className?: string;
  amount?: number;
}) {
  return (
    <motion.div
      className={className}
      whileHover={{ y: -amount }}
      transition={{ type: "spring", stiffness: 320, damping: 26 }}
    >
      {children}
    </motion.div>
  );
}

// Angka statistik yang menghitung naik saat masuk viewport.
// Bilangan bulat + suffix opsional, selalu tabular-nums; skip animasi bila
// pengguna memilih reduce-motion (langsung tampil nilai akhir).
export function AnimatedNumber({
  value,
  suffix = "",
  className,
  duration = 1.1,
}: {
  value: number;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const count = useMotionValue(0);
  const text = useTransform(count, (latest) => `${Math.round(latest)}${suffix}`);

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      count.set(value);
      return;
    }
    const controls = animate(count, value, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [inView, value, duration, reduce, count]);

  return (
    <motion.span ref={ref} className={cn("tabular-nums", className)}>
      {text}
    </motion.span>
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
