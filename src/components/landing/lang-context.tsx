"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import {
  LANG_STORAGE_KEY,
  dictionaries,
  type Dict,
  type Lang,
} from "@/components/landing/strings";

type LangContextValue = {
  lang: Lang;
  t: Dict;
  setLang: (lang: Lang) => void;
};

const LangContext = createContext<LangContextValue | null>(null);

// Ikuti perubahan localStorage lintas tab (event "storage").
function subscribeStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function readStoredLang(): string | null {
  try {
    return window.localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function LangProvider({ children }: { children: ReactNode }) {
  // Nilai tersimpan dibaca via useSyncExternalStore agar aman SSR + tanpa
  // setState di effect; pilihan pengguna di sesi ini disimpan di state lokal.
  const stored = useSyncExternalStore(subscribeStorage, readStoredLang, () => null);
  const [userLang, setUserLang] = useState<Lang | null>(null);

  const lang: Lang = userLang ?? (stored === "id" || stored === "en" ? stored : "id");

  const setLang = useCallback((next: Lang) => {
    setUserLang(next);
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // abaikan kegagalan penyimpanan.
    }
  }, []);

  const value = useMemo<LangContextValue>(
    () => ({ lang, t: dictionaries[lang], setLang }),
    [lang, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang harus dipakai di dalam LangProvider");
  return ctx;
}
