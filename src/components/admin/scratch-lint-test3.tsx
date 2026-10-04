"use client";

// Berkas eksperimen sementara ke-3 — mempersempit pemicu aturan set-state-in-effect.
import { useCallback, useEffect, useState } from "react";

async function fetchNum(): Promise<number> {
  return 1;
}

function useFakeSession() {
  return { reportError: (_e: unknown) => {} };
}

export function ScratchH() {
  const [a, setA] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  // Varian H: seperti D tapi deps [] dan catch kosong.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const v = await fetchNum();
      setA(v);
    } catch {
      // diam
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return <div>{a}{loading ? "l" : ""}</div>;
}

export function ScratchI() {
  const { reportError } = useFakeSession();
  const [a, setA] = useState<number | null>(null);
  // Varian I: seperti D TANPA setLoading awal & finally; deps [reportError].
  const load = useCallback(
    async (silent = false) => {
      try {
        const v = await fetchNum();
        setA(v);
      } catch (err) {
        reportError(err);
      }
    },
    [reportError]
  );
  useEffect(() => {
    void load();
  }, [load]);
  return <div>{a}</div>;
}

export function ScratchJ() {
  const [a, setA] = useState<number | null>(null);
  // Varian J: setState post-await dibungkus kondisi (ala silent), deps [].
  const load = useCallback(async (silent = false) => {
    try {
      const v = await fetchNum();
      if (!silent) setA(v);
    } catch {
      // diam
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return <div>{a}</div>;
}
