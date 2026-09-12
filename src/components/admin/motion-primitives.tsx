"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type HTMLMotionProps,
} from "framer-motion";
import { cn } from "@/lib/utils";

// Primitif animasi bersama untuk panel admin.
// Semua animasi hanya memakai transform/opacity dan menghormati
// preferensi prefers-reduced-motion.

/** Reveal: entrance fade + slide halus saat komponen ter-mount. */
export function Reveal({
  children,
  className,
  delay = 0,
  slideX = 12,
  slideY,
  duration = 0.2,
  ...props
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  slideX?: number;
  slideY?: number;
  duration?: number;
} & Omit<HTMLMotionProps<"div">, "children">) {
  const reduced = useReducedMotion();
  const offset = reduced
    ? {}
    : slideY != null
      ? { y: slideY }
      : slideX !== 0
        ? { x: slideX }
        : {};
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, ...offset }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration, delay, ease: "easeOut" }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

/**
 * CountUp: angka besar dengan animasi hitung naik saat masuk viewport.
 * Menghormati prefers-reduced-motion (langsung tampilkan nilai akhir).
 */
export function CountUp({
  value,
  className,
  duration,
}: {
  value: number;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -4px 0px" });
  const [animated, setAnimated] = useState(0);
  const currentRef = useRef(0);

  useEffect(() => {
    if (reduced || !inView) return;
    const from = currentRef.current;
    const dist = Math.abs(value - from);
    const controls = animate(from, value, {
      duration: duration ?? (dist <= 10 ? 0.5 : Math.min(0.9, 0.45 + dist / 120)),
      ease: "easeOut",
      onUpdate: (v) => {
        currentRef.current = v;
        setAnimated(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [inView, value, reduced, duration]);

  const display = reduced ? value : animated;

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {display}
    </span>
  );
}

/** Varian stagger untuk daftar kartu (dipakai grid statistik dashboard). */
export const STAGGER_CONTAINER = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
} as const;

export const STAGGER_ITEM = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: "easeOut" } },
} as const;
