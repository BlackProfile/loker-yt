"use client";

// Empty state berilustrasi untuk daftar posisi (NR-28-A Paket A).
// Ilustrasi SVG inline bergaya brand: kotak arsip terbuka + pesawat kertas
// terbang — garis zinc, aksen rose/amber; tanpa gradien biru/ungu, tanpa emoji.

import type { ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { FadeIn } from "@/components/landing/primitives";

// Ilustrasi: pesawat kertas melayang naik dari kotak lamaran terbuka.
// Semua elemen dekoratif (aria-hidden); makna disampaikan lewat judul &
// deskripsi di bawahnya. Pesawat beranimasi float pelan yang mati saat
// pengguna memilih reduce-motion.
function EmptyJobsArt() {
  const reduceMotion = useReducedMotion();

  return (
    <svg
      viewBox="0 0 240 150"
      fill="none"
      aria-hidden="true"
      className="h-auto w-56 max-w-full"
    >
      {/* Bayangan tanah lembut */}
      <ellipse
        cx="120"
        cy="145"
        rx="52"
        ry="4"
        className="fill-zinc-200/80 dark:fill-zinc-800"
      />

      {/* Jejak pesawat kertas (garis putus-putus melengkung) */}
      <path
        d="M30 98C60 64 98 46 148 34"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="4 7"
        className="text-zinc-300 dark:text-zinc-700"
      />

      {/* Pesawat kertas (metafora lamaran terbang) — float pelan */}
      <motion.g
        animate={reduceMotion ? undefined : { y: [0, -5, 0] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <g transform="translate(148 6) scale(2)">
          <path
            d="m22 2-7 20-4-9-9-4Z"
            strokeWidth="1.2"
            strokeLinejoin="round"
            className="fill-rose-100 stroke-rose-500 dark:fill-rose-500/20 dark:stroke-rose-400"
          />
          <path
            d="M22 2 11 13"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-rose-500 dark:stroke-rose-400"
          />
        </g>
      </motion.g>

      {/* Panel belakang kotak (dalam kotak terlihat saat terbuka) */}
      <rect
        x="84"
        y="94"
        width="72"
        height="12"
        rx="2"
        className="fill-zinc-200 stroke-zinc-300 dark:fill-zinc-800 dark:stroke-zinc-700"
      />

      {/* Kertas-kertas lamaran yang tersimpan di dalam kotak */}
      <g transform="rotate(-10 104 88)">
        <rect
          x="94"
          y="74"
          width="20"
          height="26"
          rx="1.5"
          className="fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-700"
        />
        <path
          d="M98 81h12M98 86h9"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="stroke-rose-400 dark:stroke-rose-500/70"
        />
      </g>
      <g transform="rotate(7 140 90)">
        <rect
          x="132"
          y="76"
          width="18"
          height="24"
          rx="1.5"
          className="fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-700"
        />
        <path
          d="M136 83h10M136 88h7"
          strokeWidth="1.6"
          strokeLinecap="round"
          className="stroke-amber-500/80 dark:stroke-amber-500/70"
        />
      </g>

      {/* Daun kotak terbuka (kiri & kanan) */}
      <path
        d="M78 100 58 88l8-8 20 12Z"
        strokeLinejoin="round"
        className="fill-zinc-100 stroke-zinc-300 dark:fill-zinc-800 dark:stroke-zinc-700"
      />
      <path
        d="M162 100l20-12-8-8-20 12Z"
        strokeLinejoin="round"
        className="fill-zinc-100 stroke-zinc-300 dark:fill-zinc-800 dark:stroke-zinc-700"
      />

      {/* Badan kotak */}
      <path
        d="M78 100h84l-6 40H84Z"
        strokeLinejoin="round"
        className="fill-white stroke-zinc-300 dark:fill-zinc-900 dark:stroke-zinc-700"
      />
      {/* Pita aksen amber di badan kotak */}
      <rect
        x="112"
        y="112"
        width="16"
        height="6"
        rx="2"
        className="fill-amber-200 dark:fill-amber-500/30"
      />

      {/* Aksen: bintang & titik kecil (rose/amber/zinc) */}
      <path
        d="M46 50l2.2 5.8L54 58l-5.8 2.2L46 66l-2.2-5.8L38 58l5.8-2.2Z"
        className="fill-amber-400 dark:fill-amber-500/80"
      />
      <path
        d="M204 66l1.7 4.3 4.3 1.7-4.3 1.7-1.7 4.3-1.7-4.3-4.3-1.7 4.3-1.7Z"
        className="fill-rose-400 dark:fill-rose-500/80"
      />
      <circle cx="32" cy="120" r="2.5" className="fill-rose-500/60" />
      <circle cx="212" cy="122" r="2.5" className="fill-amber-500/70" />
      <circle cx="64" cy="28" r="2" className="fill-zinc-300 dark:fill-zinc-700" />
    </svg>
  );
}

/**
 * Empty state daftar posisi: ilustrasi brand + judul + deskripsi + aksi
 * opsional (mis. "Muat ulang" atau reset filter). Seluruh teks dari props
 * agar tetap mengikuti konteks bahasa pemanggil.
 */
export function EmptyJobsState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description: string;
  /** Node aksi opsional (tombol) di bawah deskripsi. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <FadeIn className={className}>
      <Card className="items-center gap-3 rounded-2xl p-10 text-center">
        <EmptyJobsArt />
        <p className="font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        {action ? <div className="mt-2 flex justify-center">{action}</div> : null}
      </Card>
    </FadeIn>
  );
}
