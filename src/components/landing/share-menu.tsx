"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  Copy,
  QrCode,
  Share2,
  Twitter,
  MessageCircle,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useLang } from "@/components/landing/lang-context";
import { twitterShareHref, waShareHref } from "@/components/landing/landing-utils";
import { cn } from "@/lib/utils";

type ShareMenuProps = {
  siteName: string;
  tagline: string;
  /** true bila trigger dipakai di atas hero gelap. */
  dark?: boolean;
};

// URL halaman dibaca via useSyncExternalStore (aman SSR, tanpa setState di effect).
const emptySubscribe = () => () => {};
function usePageUrl(): string {
  return useSyncExternalStore(
    emptySubscribe,
    () => window.location.href,
    () => "",
  );
}

export function ShareMenu({ siteName, tagline, dark = false }: ShareMenuProps) {
  const { t } = useLang();
  const url = usePageUrl();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  // Loading di-set dari event handler (bukan body effect) agar memenuhi
  // aturan react-hooks/set-state-in-effect.
  function openQr() {
    setQrLoading(true);
    setQrDataUrl(null);
    setQrOpen(true);
  }

  useEffect(() => {
    if (!qrOpen) return;
    let cancelled = false;
    QRCode.toDataURL(window.location.href, { width: 320, margin: 2 })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setQrLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrDataUrl(null);
          setQrLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [qrOpen]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url || window.location.href);
      toast.success(t.hero.share.copied);
    } catch {
      toast.error(t.hero.share.copyFailed);
    }
  }

  const shareText = `${t.hero.share.shareText} — ${siteName}. ${tagline}`;

  const items = [
    {
      key: "copy",
      label: t.hero.share.copy,
      icon: Copy,
      onSelect: copyLink,
      href: undefined,
    },
    {
      key: "wa",
      label: t.hero.share.whatsapp,
      icon: MessageCircle,
      onSelect: undefined,
      href: waShareHref(shareText),
    },
    {
      key: "tw",
      label: t.hero.share.twitter,
      icon: Twitter,
      onSelect: undefined,
      href: twitterShareHref(t.hero.share.shareText, url),
    },
    {
      key: "qr",
      label: t.hero.share.qr,
      icon: QrCode,
      onSelect: openQr,
      href: undefined,
    },
  ];

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t.hero.share.trigger}
            title={t.hero.share.trigger}
            className={cn(
              "h-11 w-11 rounded-full transition-transform active:scale-95",
              dark &&
                "border border-white/20 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white",
            )}
          >
            <Share2 className="h-5 w-5" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-52 p-1.5">
          <div className="flex flex-col">
            {items.map((item) => {
              const Icon = item.icon;
              if (item.href) {
                return (
                  <a
                    key={item.key}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Icon className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    {item.label}
                  </a>
                );
              }
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onSelect}
                  className="flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Icon className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="max-w-xs sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.hero.share.qrTitle}</DialogTitle>
            <DialogDescription>{t.hero.share.qrCaption}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center rounded-xl border bg-white p-4">
            {qrLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
            ) : qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={t.hero.share.qrAlt}
                className="h-56 w-56"
                width={224}
                height={224}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t.hero.share.copyFailed}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
