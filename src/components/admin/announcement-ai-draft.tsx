"use client";

// NR49 Paket D — tombol "Tulis dengan AI" untuk papan pengumuman (dashboard).
// Komponen mandiri: pilih posisi aktif -> POST /api/admin/announcements/draft ->
// hasil MENGISI input judul & isi yang sudah ada di form (onDraft) — pengiriman
// tetap lewat tombol "Posting" eksisting (AI hanya mengusulkan draf).
import { useState } from "react";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Position } from "@/lib/types";
import { apiGet, apiPost } from "./api";

export function AnnouncementAiDraft({
  onDraft,
}: {
  onDraft: (title: string, body: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [positionId, setPositionId] = useState("");
  const [generating, setGenerating] = useState(false);

  const activePositions = (positions ?? []).filter((p) => p.isActive);

  async function loadPositions() {
    if (positions) return;
    try {
      const rows = await apiGet<Position[]>("/api/admin/positions");
      setPositions(rows);
      const firstActive = rows.find((p) => p.isActive);
      if (firstActive) setPositionId(firstActive.id);
    } catch {
      setPositions([]);
      toast.error("Gagal memuat daftar posisi.");
    }
  }

  async function handleGenerate() {
    if (generating || !positionId) return;
    setGenerating(true);
    try {
      const res = await apiPost<{ title: string; body: string }>(
        "/api/admin/announcements/draft",
        { positionId },
      );
      onDraft(res.title, res.body);
      toast.info("Draf AI diisi ke form — silakan tinjau lalu posting.");
      setOpen(false);
    } catch (err) {
      const message =
        err && typeof err === "object" && "message" in err && typeof (err as Error).message === "string"
          ? (err as Error).message
          : "Gagal membuat draf pengumuman.";
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadPositions();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 border-amber-300 text-amber-700 hover:bg-amber-50 hover:text-amber-800 sm:h-8 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950"
        >
          <Sparkles className="size-4" aria-hidden="true" />
          Tulis dengan AI
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-xl">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Wand2 className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            <p className="text-sm font-semibold">Draf Pengumuman (AI)</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Pilih posisi aktif, AI menyusun judul dan isi pengumuman dari data lowongan.
            Hasil mengisi form di bawah untuk ditinjau sebelum diposting.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ann-ai-position" className="text-xs">
              Posisi aktif
            </Label>
            <Select
              value={positionId || undefined}
              onValueChange={(v) => setPositionId(v)}
              disabled={generating || !positions}
            >
              <SelectTrigger id="ann-ai-position" className="h-11 w-full sm:h-9" aria-label="Pilih posisi untuk draf pengumuman">
                <SelectValue placeholder={positions ? "Pilih posisi" : "Memuat posisi..."} />
              </SelectTrigger>
              <SelectContent>
                {activePositions.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    Tidak ada posisi aktif.
                  </div>
                ) : (
                  activePositions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            className="h-11 w-full active:scale-[0.99] sm:h-9"
            onClick={() => void handleGenerate()}
            disabled={generating || !positionId}
          >
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Menyusun draf...
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden="true" />
                Buat Draf
              </>
            )}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
