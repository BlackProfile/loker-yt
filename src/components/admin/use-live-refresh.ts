"use client";

// Hook kecil untuk tab admin: jalankan handler (ter-debounce) setiap kali
// event realtime broadcast datang. Dipakai untuk refresh SENYAP — data lama
// tetap tampil sampai data baru siap (tanpa skeleton ulang / flash kosong).
// Debounce menggabungkan burst event (mis. banyak PATCH massal) menjadi satu
// pemanggilan; handler terbaru selalu dipakai (aman terhadap stale closure).

import { useEffect, useRef } from "react";
import { useLiveEvent } from "@/lib/live-client";

export function useLiveRefresh(
  event: string,
  handler: () => void,
  delay = 300
): void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLiveEvent(event, () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      handler();
    }, delay);
  });

  // Bersihkan timer tertunda saat komponen unmount (pindah tab).
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);
}
