"use client";

// NR49 Paket D — dialog poster lowongan hasil AI (pembuatan gambar 1024x1024).
// Pilih gaya (minimalis/berani/hangat) -> POST /api/admin/positions/{id}/poster.
// Proses 30-120 detik: tombol disabled + pesan loading jelas agar tidak spam klik.
// Hasil disimpan sebagai FileAsset dan dilayani /api/files/{id} (butuh sesi admin).
import { useEffect, useState } from "react";
import { Download, ImageDown, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Position } from "@/lib/types";
import { apiPost } from "./api";
import { cn } from "@/lib/utils";

const STYLE_OPTIONS = [
  { value: "minimalis", label: "Minimalis", hint: "Bersih, banyak ruang kosong, aksen geometris halus." },
  { value: "berani", label: "Berani", hint: "Kontras tinggi, tipografi besar, komposisi dinamis." },
  { value: "hangat", label: "Hangat", hint: "Ilustrasi ramah, gradasi lembut, kesan menyambut." },
] as const;

type StyleValue = (typeof STYLE_OPTIONS)[number]["value"];

export function PosterDialog({
  open,
  onOpenChange,
  position,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: Position | null;
}) {
  const [style, setStyle] = useState<StyleValue>("minimalis");
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset hasil & error saat berganti posisi/dialog dibuka ulang.
  useEffect(() => {
    if (open) {
      setUrl(null);
      setError(null);
      setLoading(false);
    }
  }, [open, position?.id]);

  async function handleGenerate() {
    if (!position || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiPost<{ url: string }>(`/api/admin/positions/${position.id}/poster`, {
        style,
      });
      setUrl(res.url);
      toast.success("Poster selesai dibuat.");
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err && typeof (err as Error).message === "string"
          ? (err as Error).message
          : "Gagal membuat poster. Coba lagi sebentar.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-md nice-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageDown className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Poster Lowongan (AI)
          </DialogTitle>
          <DialogDescription>
            Buat gambar poster rekrutmen untuk posisi{" "}
            {position?.title ? `"${position.title}"` : "-"} dari satu klik, lalu unduh sebagai PNG.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="poster-style" className="text-xs">
              Gaya poster
            </Label>
            <Select
              value={style}
              onValueChange={(v) => setStyle(v as StyleValue)}
              disabled={loading}
            >
              <SelectTrigger id="poster-style" className="h-11 w-full sm:h-10" aria-label="Pilih gaya poster">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {STYLE_OPTIONS.find((opt) => opt.value === style)?.hint}
            </p>
          </div>

          <Button
            className="h-11 w-full active:scale-[0.99]"
            onClick={() => void handleGenerate()}
            disabled={loading || !position}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Membuat gambar — bisa memakan waktu hingga 2 menit
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden="true" />
                Buat Poster (AI)
              </>
            )}
          </Button>

          {loading ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2 rounded-xl border border-dashed p-8 text-xs text-muted-foreground"
            >
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Model gambar sedang bekerja. Jangan tutup dialog ini.
            </div>
          ) : null}

          {error && !loading ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
            >
              {error}
            </p>
          ) : null}

          {url && !loading ? (
            <div className="flex flex-col gap-3">
              <img
                src={url}
                alt={"Poster lowongan " + (position?.title ?? "")}
                className="w-full rounded-md border"
              />
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-11 flex-1 sm:h-9">
                  <a
                    href={url}
                    download
                    aria-label={"Unduh poster lowongan " + (position?.title ?? "")}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    Unduh PNG
                  </a>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("h-11 flex-1 sm:h-9")}
                  onClick={() => void handleGenerate()}
                  disabled={loading}
                >
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Buat Ulang
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
