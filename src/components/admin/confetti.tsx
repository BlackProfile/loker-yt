"use client";

// NR-28 (item 10) — confetti ringan untuk panel admin, dipicu saat keputusan
// positif (status DITERIMA / hire). Mandiri dari landing (tidak mengimpor
// folder landing) supaya bundle admin tetap terpisah. Menghormati
// prefers-reduced-motion (langsung tidak merender apa pun) dan tanpa emoji.
// Warna mengikuti palet aplikasi: rose, amber, emerald, orange, zinc.

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

const COLORS = [
  "#f43f5e", // rose-500
  "#f59e0b", // amber-500
  "#10b981", // emerald-500
  "#fb923c", // orange-400
  "#a1a1aa", // zinc-400
];

/**
 * Confetti sekali tembak.
 * @param fire beralih false -> true memicu satu burst ~2.5 detik.
 */
export function AdminConfetti({ fire }: { fire: boolean }) {
  const reduced = useReducedMotion();
  const [burstId, setBurstId] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!fire || reduced) return;
    setBurstId((n) => n + 1);
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(t);
  }, [fire, reduced]);

  const particles = useMemo(() => {
    if (!visible || reduced) return [];
    return Array.from({ length: 36 }, (_, i) => ({
      id: `${burstId}-${i}`,
      left: Math.round((i * 53) % 100),
      size: 6 + ((i * 29) % 8),
      color: COLORS[i % COLORS.length],
      delay: ((i * 17) % 30) / 100,
      spin: 360 + ((i * 71) % 360),
      drift: ((i * 37) % 160) - 80,
    }));
    // burstId sengaja menjadi dep agar tiap pemicu menghasilkan pola baru.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burstId, visible, reduced]);

  if (!visible || particles.length === 0) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[80] overflow-hidden"
    >
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="absolute top-0 block rounded-[2px]"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.6,
            backgroundColor: p.color,
          }}
          initial={{ y: -24, x: 0, rotate: 0, opacity: 1 }}
          animate={{ y: window.innerHeight + 40, x: p.drift, rotate: p.spin, opacity: 0 }}
          transition={{ duration: 2.2, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}
