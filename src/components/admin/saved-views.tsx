"use client";

// NR38-B fitur 2 — Tampilan tersimpan (saved views) untuk tab Pelamar.
// Snapshot state filter aktif disimpan ke localStorage (key "lumina.admin.savedViews",
// maks 12, terbaru di depan). Baris chip dirender DI ATAS bar filter:
// klik chip = terapkan filter, ikon x kecil = hapus (konfirmasi inline, tanpa dialog besar).
// Chip yang filternya identik dengan state aktif diberi ring rose.

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BookmarkPlus, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lumina.admin.savedViews";
const MAX_VIEWS = 12;
const MAX_NAME = 40;

/** Snapshot filter aktif tab Pelamar — semua nilai harus serializable. */
export type AdminFilterSnapshot = {
  q?: string;
  status?: string;
  positionId?: string;
  source?: string;
  sort?: string;
  ratingMin?: string;
  tag?: string;
  talentPool?: boolean;
  hasInterview?: boolean;
  starred?: boolean;
  followup?: boolean;
  hold?: boolean;
  archive?: string;
  komuter?: string;
  domisili?: string;
  unseen?: boolean;
};

export type SavedView = {
  id: string;
  name: string;
  filters: AdminFilterSnapshot;
};

/** Tanda tangan kanonik untuk mendeteksi chip yang identik dengan filter aktif. */
export function snapshotSignature(snapshot: AdminFilterSnapshot): string {
  const canonical: Record<string, string | boolean> = {};
  for (const key of Object.keys(snapshot).sort()) {
    const value = (snapshot as Record<string, unknown>)[key];
    if (value === undefined || value === "" || value === false || value === "ALL") continue;
    if (key === "q" && (value as string).trim() === "") continue;
    canonical[key] = value as string | boolean;
  }
  return JSON.stringify(canonical);
}

function loadViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SavedView =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as SavedView).id === "string" &&
          typeof (item as SavedView).name === "string" &&
          Boolean((item as SavedView).filters) &&
          typeof (item as SavedView).filters === "object"
      )
      .slice(0, MAX_VIEWS);
  } catch {
    return [];
  }
}

function persistViews(views: SavedView[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
  } catch {
    toast.error("Gagal menyimpan tampilan di peramban ini.");
  }
}

export function SavedViewsBar({
  currentSnapshot,
  onApply,
}: {
  /** Snapshot filter yang sedang aktif di induk (untuk deteksi chip aktif & simpan). */
  currentSnapshot: AdminFilterSnapshot;
  /** Terapkan snapshot ke state filter induk. */
  onApply: (filters: AdminFilterSnapshot) => void;
}) {
  // Komponen ini hanya termount di panel admin (client-only), jadi inisialisasi
  // lazy dari localStorage aman terhadap SSR/hidrasi (pola yang sama dgn sidebar).
  const [views, setViews] = useState<SavedView[]>(() => loadViews());
  const [saveOpen, setSaveOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);
  // Konfirmasi hapus inline: id tampilan yang menunggu konfirmasi.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const currentSignature = snapshotSignature(currentSnapshot);

  const saveCurrentView = useCallback(() => {
    const name = nameInput.trim().slice(0, MAX_NAME);
    if (!name) {
      toast.error("Tulis nama tampilan terlebih dahulu.");
      return;
    }
    setSaving(true);
    const view: SavedView = {
      id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      filters: currentSnapshot,
    };
    const next = [view, ...views.filter((v) => v.name !== name)].slice(0, MAX_VIEWS);
    persistViews(next);
    setViews(next);
    setSaving(false);
    setSaveOpen(false);
    setNameInput("");
    toast.success(`Tampilan "${name}" tersimpan`);
  }, [nameInput, currentSnapshot, views]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Baris chip tampilan tersimpan (di atas bar filter) */}
      {views.length > 0 ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {views.map((view) => {
            const isActive = snapshotSignature(view.filters) === currentSignature;
            const isConfirming = confirmingDeleteId === view.id;
            if (isConfirming) {
              return (
                <span
                  key={view.id}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
                >
                  Hapus &quot;{view.name}&quot;?
                  <button
                    type="button"
                    className="inline-flex h-6 items-center gap-0.5 rounded-full bg-rose-600 px-2 text-[11px] font-semibold text-white hover:bg-rose-700"
                    onClick={() => {
                      const next = views.filter((v) => v.id !== view.id);
                      persistViews(next);
                      setViews(next);
                      setConfirmingDeleteId(null);
                      toast.success(`Tampilan "${view.name}" dihapus`);
                    }}
                    aria-label={`Ya, hapus tampilan ${view.name}`}
                  >
                    <Check className="size-3" aria-hidden="true" />
                    Ya
                  </button>
                  <button
                    type="button"
                    className="inline-flex h-6 items-center rounded-full px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    onClick={() => setConfirmingDeleteId(null)}
                    aria-label="Batal hapus tampilan"
                  >
                    Batal
                  </button>
                </span>
              );
            }
            return (
              <span
                key={view.id}
                className={cn(
                  "group inline-flex items-center overflow-hidden rounded-full border bg-background text-xs",
                  isActive
                    ? "border-rose-300 ring-2 ring-rose-500/60 dark:border-rose-800"
                    : "border-zinc-300 dark:border-zinc-700"
                )}
              >
                <button
                  type="button"
                  className="max-w-48 truncate px-3 py-1.5 font-medium transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onClick={() => onApply(view.filters)}
                  title={`Terapkan tampilan "${view.name}"`}
                >
                  {view.name}
                </button>
                <button
                  type="button"
                  className="flex h-full items-center border-l border-zinc-200 px-1.5 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 dark:border-zinc-800 dark:hover:bg-rose-950 dark:hover:text-rose-400"
                  onClick={() => setConfirmingDeleteId(view.id)}
                  aria-label={`Hapus tampilan ${view.name}`}
                  title="Hapus tampilan"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 rounded-full"
        onClick={() => {
          setNameInput("");
          setSaveOpen(true);
        }}
        aria-label="Simpan tampilan filter saat ini"
      >
        <BookmarkPlus className="size-4" aria-hidden="true" />
        Simpan tampilan
      </Button>

      {/* Dialog kecil: nama tampilan (maks 40 karakter) */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Simpan tampilan</DialogTitle>
            <DialogDescription>
              Snapshot filter aktif akan disimpan di peramban ini (maksimal 12 tampilan).
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveCurrentView();
              }
            }}
            placeholder="Mis. Review Senin — Supervisor aktif"
            aria-label="Nama tampilan"
            maxLength={MAX_NAME}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">{nameInput.length}/{MAX_NAME} karakter</p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSaveOpen(false)} className="h-11 sm:h-9">
              Batal
            </Button>
            <Button
              onClick={saveCurrentView}
              disabled={saving || nameInput.trim().length === 0}
              className="h-11 active:scale-[0.99] sm:h-9"
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <BookmarkPlus className="size-4" aria-hidden="true" />
              )}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
