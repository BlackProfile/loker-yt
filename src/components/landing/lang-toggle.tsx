"use client";

import { ChevronDown, Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS, type Lang } from "@/components/landing/strings";
import { useLang } from "@/components/landing/lang-context";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LANG_LABEL: Record<Lang, string> = {
  id: "Bahasa Indonesia",
  en: "English",
};

export function LangToggle({ dark = false }: { dark?: boolean }) {
  const { lang, setLang, t } = useLang();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.aria.langToggle}
        className={cn(
          "group inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold uppercase tracking-wide transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-95",
          dark
            ? "border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10"
            : "bg-background text-foreground hover:bg-accent",
        )}
      >
        <Languages
          className={cn("h-4 w-4", dark ? "text-zinc-400" : "text-muted-foreground")}
          aria-hidden="true"
        />
        {lang}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]:rotate-180",
            dark ? "text-zinc-400" : "text-muted-foreground",
          )}
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={lang}
          onValueChange={(value) => setLang(value as Lang)}
        >
          {LANGS.map((code: Lang) => (
            <DropdownMenuRadioItem
              key={code}
              value={code}
              aria-label={code === "id" ? "Bahasa Indonesia" : "English"}
              className="cursor-pointer"
            >
              {LANG_LABEL[code]}
              <DropdownMenuShortcut className="tracking-normal">
                {code.toUpperCase()}
              </DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
