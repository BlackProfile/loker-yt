"use client";

// Klien realtime + data-fetching anti-flicker untuk publik & admin.
//
// - getLiveSocket(): singleton socket.io (reconnect otomatis, aman SSR).
// - useLiveEvent(event, handler): berlangganan satu event broadcast.
// - useRealtimeConnected(): status koneksi (untuk indikator kecil di UI).
// - useLiveResource(url, events): fetch + auto-refresh saat event/fokus,
//   dengan semantik SWR — data lama TETAP tampil saat memuat ulang (tanpa
//   flicker/skeleton ulang), state hanya di-swap bila isi benar-benar berubah.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { io, type Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Socket singleton
// ---------------------------------------------------------------------------

let socket: Socket | null = null;
let connecting = false;

const listeners = new Map<string, Set<(payload?: unknown) => void>>();
const statusListeners = new Set<() => void>();
let connectedFlag = false;

function notifyStatus() {
  for (const fn of statusListeners) fn();
}

function ensureSocket(): Socket | null {
  if (typeof window === "undefined") return null;
  if (socket) return socket;
  if (connecting) return null;
  connecting = true;

  const instance = io("/?XTransformPort=3003", {
    path: "/rt",
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  instance.on("connect", () => {
    connectedFlag = true;
    notifyStatus();
  });
  instance.on("disconnect", () => {
    connectedFlag = false;
    notifyStatus();
  });
  instance.on("connect_error", () => {
    if (connectedFlag) {
      connectedFlag = false;
      notifyStatus();
    }
  });

  socket = instance;
  connecting = false;
  return socket;
}

/** Pasang handler global untuk sebuah event broadcast (sekali per event). */
function addGlobalListener(event: string, handler: (payload?: unknown) => void) {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
    const s = ensureSocket();
    s?.on(event, (payload: unknown) => {
      for (const fn of listeners.get(event) ?? []) {
        try {
          fn(payload);
        } catch {
          // handler user tidak boleh mematikan koneksi
        }
      }
    });
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

/** Berlangganan satu event realtime; handler dipasang ulang tiap render tanpa disconnect. */
export function useLiveEvent(event: string, handler: () => void) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);
  useEffect(() => {
    ensureSocket();
    return addGlobalListener(event, () => ref.current());
  }, [event]);
}

/** true bila socket realtime tersambung (untuk indikator "Live"). */
export function useRealtimeConnected(): boolean {
  const subscribe = useCallback((cb: () => void) => {
    statusListeners.add(cb);
    return () => statusListeners.delete(cb);
  }, []);
  const getSnapshot = useCallback(() => connectedFlag, []);
  // getServerSnapshot false agar SSR stabil.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

// ---------------------------------------------------------------------------
// useLiveResource — fetch + realtime refresh + anti-flicker
// ---------------------------------------------------------------------------

export type LiveResource<T> = {
  data: T | null;
  error: boolean;
  loading: boolean; // hanya true saat BELUM ada data sama sekali (skeleton pertama)
  refreshing: boolean; // true saat memuat ulang dengan data lama tetap tampil
  refresh: () => void;
  lastUpdated: number | null;
};

type LiveOptions = {
  /** Event realtime yang memicu refresh (default: tidak ada). */
  events?: string[];
  /** Refresh juga saat window kembali fokus (default: true). */
  refreshOnFocus?: boolean;
};

export function useLiveResource<T = unknown>(
  url: string,
  options: LiveOptions = {},
): LiveResource<T> {
  const { events = [], refreshOnFocus = true } = options;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const dataKeyRef = useRef<string>("");
  const inFlightRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchNow = useCallback(async (silent: boolean) => {
    if (typeof window === "undefined") return;
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    if (silent && hasDataRef.current) setRefreshing(true);

    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as T;
      if (!mountedRef.current) return;

      // ANTI-FLICKER: hanya swap state bila isi benar-benar berubah.
      const key = JSON.stringify(json);
      if (key !== dataKeyRef.current) {
        dataKeyRef.current = key;
        setData(json);
      }
      hasDataRef.current = true;
      setError(false);
      setLastUpdated(Date.now());
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      if (!mountedRef.current) return;
      // Data lama tetap dipertahankan saat error (tanpa flash kosong).
      if (!hasDataRef.current) setError(true);
    } finally {
      if (mountedRef.current && inFlightRef.current === controller) {
        inFlightRef.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [url]);

  const refresh = useCallback(() => {
    void fetchNow(true);
  }, [fetchNow]);

  // Fetch pertama + saat URL berubah.
  useEffect(() => {
    mountedRef.current = true;
    hasDataRef.current = false;
    dataKeyRef.current = "";
    setLoading(true);
    void fetchNow(false);
    return () => {
      mountedRef.current = false;
      inFlightRef.current?.abort();
    };
  }, [fetchNow]);

  // Refresh ter-debounce saat event realtime datang (gabungkan burst event).
  useEffect(() => {
    if (events.length === 0) return;
    let cancelled = false;
    const unsubs = events.map((event) =>
      addGlobalListener(event, () => {
        if (cancelled) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          if (document.visibilityState === "visible") void fetchNow(true);
        }, 250);
      }),
    );
    return () => {
      cancelled = true;
      for (const unsub of unsubs) unsub();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [events, fetchNow]);

  // Refresh saat window kembali fokus (fallback bila realtime sempat putus).
  useEffect(() => {
    if (!refreshOnFocus) return;
    const onFocus = () => {
      if (document.visibilityState === "visible") void fetchNow(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refreshOnFocus, fetchNow]);

  return { data, error, loading, refreshing, refresh, lastUpdated };
}
