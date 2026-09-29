"use client";

// Banner Mode Pratinjau (Task 27): tampil hanya bila URL memuat ?preview=1.
// Dipasang di page.tsx (di luar LangProvider), sehingga bahasa dibaca langsung
// dari localStorage (kunci sama dengan lang-context) via useSyncExternalStore —
// aman SSR dan tanpa setState di effect.
import { useState, useSyncExternalStore } from "react";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LANG_STORAGE_KEY,
  dictionaries,
  type Lang,
} from "@/components/landing/strings";

function subscribeLang(onChange: () => void) {
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

export function PreviewBanner() {
  const [dismissed, setDismissed] = useState(false);
  const stored = useSyncExternalStore(subscribeLang, readStoredLang, () => null);
  const lang: Lang = stored === "en" ? "en" : "id";
  const t = dictionaries[lang].previewBanner;

  if (dismissed) return null;

  // Tutup pratinjau: tutup tab bila memungkinkan (tab dibuka via script),
  // kalau tidak, kembali ke halaman utama tanpa query param.
  function closePreview() {
    setDismissed(true);
    try {
      window.close();
    } catch {
      // diabaikan — fallback di bawah yang menangani
    }
    window.setTimeout(() => {
      if (!window.closed) {
        try {
          window.location.replace("/");
        } catch {
          // diabaikan
        }
      }
    }, 150);
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 border-b border-amber-200 bg-amber-50/95 text-amber-900 shadow-sm backdrop-blur dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-100"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{t.title}</span>
        </p>
        <Button
          size="sm"
          variant="outline"
          className="h-8 shrink-0 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-500/10 dark:hover:text-amber-100"
          onClick={closePreview}
        >
          {t.close}
        </Button>
      </div>
    </div>
  );
}
