"use client";

import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

// Bintang rating 1-5. Tanpa onChange: tampilan saja (read-only).
// Dengan onChange: tiap bintang jadi tombol (dipakai di tabel & dialog detail).
export function RatingStars({
  value,
  onChange,
  disabled,
  size = "size-4",
  className,
  ariaLabel = "Rating",
}: {
  value: number;
  onChange?: (rating: number) => void;
  disabled?: boolean;
  size?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      className={cn("inline-flex items-center gap-0.5", className)}
      role={onChange ? "group" : undefined}
      aria-label={ariaLabel}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        const star = (
          <Star
            className={cn(
              size,
              filled
                ? "fill-amber-400 text-amber-400"
                : "text-muted-foreground/35",
              onChange && !disabled ? "transition-colors hover:fill-amber-300 hover:text-amber-400" : ""
            )}
            aria-hidden="true"
          />
        );
        if (!onChange || disabled) {
          return <span key={n}>{star}</span>;
        }
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onChange(n);
            }}
            aria-label={`Beri rating ${n} dari 5`}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {star}
          </button>
        );
      })}
    </div>
  );
}
