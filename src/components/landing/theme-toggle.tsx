"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLang } from "@/components/landing/lang-context";

// Tanda "sudah di klien" tanpa setState di effect (aman hidrasi).
const emptySubscribe = () => () => {};

export function ThemeToggle({ dark = false }: { dark?: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const { t } = useLang();

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      className={
        dark
          ? "h-11 w-11 border border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
          : "h-11 w-11"
      }
      aria-label={t.aria.themeToggle}
      title={t.aria.themeToggle}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? (
        <Sun className="h-5 w-5" aria-hidden="true" />
      ) : (
        <Moon className="h-5 w-5" aria-hidden="true" />
      )}
    </Button>
  );
}
