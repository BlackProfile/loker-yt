// NR-38 — avatar inisial pelamar untuk baris tabel/kartu/detail.
// Mempercepat pemindaian visual: inisial nama + cincin rose bila pelamar
// ditandai penting (starred) oleh admin yang sedang login.
"use client";

import { cn } from "@/lib/utils";
import { avatarToneClass, initialsOf } from "./stage-meta";

export function ApplicantAvatar({
  name,
  starred,
  className,
}: {
  name: string | null | undefined;
  /** Bintang personal admin aktif — cincin rose + latar putih. */
  starred?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 select-none items-center justify-center rounded-full text-xs font-bold",
        avatarToneClass(name),
        starred && "ring-2 ring-rose-500 ring-offset-2 ring-offset-background",
        className
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
