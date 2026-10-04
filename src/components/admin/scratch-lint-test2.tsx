"use client";

// Berkas eksperimen sementara ke-2 untuk aturan eslint react-hooks/set-state-in-effect.
import { useCallback, useEffect, useRef, useState } from "react";

async function fetchNum(): Promise<number> {
  return 1;
}

// Fungsi opaque ala reportError (dari context).
function useFakeSession() {
  return { reportError: (_e: unknown) => {} };
}

export function ScratchD() {
  const { reportError } = useFakeSession();
  const [a, setA] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // Varian D: replika persis bentuk dashboard-tab (setLoading cond di awal & finally, deps [reportError]).
  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const v = await fetchNum();
        setA(v);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [reportError]
  );
  useEffect(() => {
    void load();
  }, [load]);
  return <div>{a}{loading ? "l" : ""}</div>;
}

export function ScratchE() {
  const [a, setA] = useState<number | null>(null);
  // Varian E: setState DI DALAM .then() (bukan dalam fungsi async yang dipanggil efek).
  const load = useCallback(() => {
    fetchNum().then((v) => setA(v));
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return <div>{a}</div>;
}

export function ScratchF() {
  const [a, setA] = useState<number | null>(null);
  // Varian F: async IIFE di dalam efek dengan await sebelum setState.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const v = await fetchNum();
      if (alive) setA(v);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return <div>{a}</div>;
}

export function ScratchG() {
  const [a, setA] = useState<number | null>(null);
  const ref = useRef<(silent?: boolean) => Promise<void>>();
  // Varian G: dipanggil lewat ref (analyzer tidak menelusuri).
  ref.current = async (silent = false) => {
    try {
      const v = await fetchNum();
      if (!silent) setA(v);
    } catch {
      // diam
    }
  };
  useEffect(() => {
    void ref.current?.();
  }, []);
  return <div>{a}</div>;
}
