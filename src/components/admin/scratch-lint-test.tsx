"use client";

// Berkas eksperimen sementara untuk menguji aturan eslint react-hooks/set-state-in-effect.
import { useCallback, useEffect, useState } from "react";

async function fetchNum(): Promise<number> {
  return 1;
}

export function ScratchA() {
  const [a, setA] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // Varian A: setState hanya di try (post-await), catch kosong.
  const load = useCallback(async (silent = false) => {
    try {
      const v = await fetchNum();
      setA(v);
      if (!silent) setFailed(false);
    } catch {
      if (!silent) setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return <div>{a}{failed ? "g" : ""}</div>;
}

export function ScratchB() {
  const [a, setA] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // Varian B: catch memanggil helper lokal (bukan setState langsung).
  const load = useCallback(async (silent = false) => {
    const markFail = () => {
      if (!silent) setFailed(true);
    };
    try {
      const v = await fetchNum();
      setA(v);
      if (!silent) setFailed(false);
    } catch {
      markFail();
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return <div>{a}{failed ? "g" : ""}</div>;
}

export function ScratchC() {
  const [a, setA] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  // Varian C: semua setState lewat setter refs dalam objek? tidak — pakai flag ref + render guard.
  const load = useCallback(async (silent = false) => {
    try {
      const v = await fetchNum();
      if (!silent) setFailed(false);
      setA(v);
    } catch (err) {
      console.error(err);
      if (!silent) setFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return <div>{a}{failed ? "g" : ""}</div>;
}
