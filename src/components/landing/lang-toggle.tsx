"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS, type Lang } from "@/components/landing/strings";
import { useLang } from "@/components/landing/lang-context";

export function LangToggle({ dark = false }: { dark?: boolean }) {
  const { lang, setLang, t } = useLang();

  return (
    <div
      role="group"
      aria-label={t.aria.langToggle}
      className={cn(
        "inline-flex h-11 items-center gap-1 rounded-full border p-1",
        dark
          ? "border-white/15 bg-white/5 text-zinc-200"
          : "bg-background text-foreground",
      )}
    >
      <Languages
        className={cn("ml-1 h-4 w-4", dark ? "text-zinc-400" : "text-muted-foreground")}
        aria-hidden="true"
      />
      {LANGS.map((code: Lang) => {
        const active = lang === code;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={active}
            aria-label={code === "id" ? "Bahasa Indonesia" : "English"}
            onClick={() => setLang(code)}
            className={cn(
              "min-h-8 min-w-10 rounded-full px-2 text-xs font-semibold uppercase tracking-wide transition-all active:scale-95",
              active
                ? "bg-primary text-primary-foreground shadow-xs"
                : dark
                  ? "text-zinc-300 hover:bg-white/10"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}
