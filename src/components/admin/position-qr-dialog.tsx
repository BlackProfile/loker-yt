"use client";

// Dialog QR code deep link posisi (pola share-menu landing).
// URL: {origin}/?posisi={slug} — fallback id bila slug belum ada.
// Isi dialog dipasang hanya saat terbuka (key=id posisi) agar state QR selalu segar.

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Loader2, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Position } from "@/lib/types";
import { copyText } from "./format";

export function positionDeepLink(position: Position): string {
  const key = position.slug ?? position.id;
  return `${window.location.origin}/?posisi=${encodeURIComponent(key)}`;
}

// Hanya dirender saat dialog terbuka di client (aman mengakses window saat render).
function QrBody({ position }: { position: Position }) {
  const url = positionDeepLink(position);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // setState hanya di callback async (bukan body effect secara sinkron).
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: 320, margin: 2 })
      .then((dataUrl) => {
        if (!cancelled) {
          setQrDataUrl(dataUrl);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Tautan posisi disalin");
    } catch {
      toast.error("Gagal menyalin tautan");
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center justify-center rounded-xl border bg-white p-4">
        {loading ? (
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`QR code tautan posisi ${position.title}`}
            className="size-56"
            width={224}
            height={224}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Gagal membuat QR. Coba lagi.</p>
        )}
      </div>
      <p className="w-full truncate rounded-lg border bg-zinc-50/60 px-3 py-2 text-center font-mono text-xs text-muted-foreground dark:bg-zinc-900/40">
        {url}
      </p>
      <Button
        variant="outline"
        className="h-11 w-full active:scale-[0.99] sm:h-9"
        onClick={() => void copyLink()}
      >
        <Copy className="size-4" aria-hidden="true" />
        Salin Link
      </Button>
    </div>
  );
}

export function PositionQrDialog({
  open,
  onOpenChange,
  position,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs rounded-2xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            QR Posisi
          </DialogTitle>
          <DialogDescription>
            Pindai untuk membuka halaman lowongan {position?.title ? `"${position.title}"` : ""}
          </DialogDescription>
        </DialogHeader>
        {open && position ? <QrBody key={position.id} position={position} /> : null}
      </DialogContent>
    </Dialog>
  );
}
