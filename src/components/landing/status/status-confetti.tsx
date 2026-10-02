"use client";

// Confetti perayaan status Diterima (NR-15 idea 16 — dipindah verbatim dari
// status-page.tsx pada NR-18-a). Partikel stabil via useMemo per burst; tanpa
// emoji, tanpa warna biru/ungu.

import { useMemo } from "react";
import { motion } from "framer-motion";
import { CONFETTI_COLORS } from "./status-types";

export function StatusConfetti({ celebrate }: { celebrate: boolean }) {
  // NR-15 (idea 16): partikel confetti stabil selama animasi (useMemo per burst).
  const confettiParticles = useMemo(() => {
    if (!celebrate) return [];
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      left: `${Math.round(((i * 97) % 100) + Math.random() * 4)}%`,
      size: 6 + Math.random() * 7,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.round(Math.random() * 40) / 100,
      spin: 360 + Math.round(Math.random() * 360),
      drift: Math.round((Math.random() - 0.5) * 120),
    }));
  }, [celebrate]);

  if (!celebrate || confettiParticles.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      {confettiParticles.map((particle) => (
        <motion.span
          key={particle.id}
          className="absolute top-0 block rounded-[2px]"
          style={{
            left: particle.left,
            width: particle.size,
            height: particle.size * 0.6,
            backgroundColor: particle.color,
          }}
          initial={{ y: -24, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: 360, x: particle.drift, rotate: particle.spin, opacity: 0 }}
          transition={{
            duration: 2.2,
            delay: particle.delay,
            ease: "easeIn",
          }}
        />
      ))}
    </div>
  );
}
