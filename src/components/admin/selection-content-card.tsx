"use client";

// NR67 — Kartu editor konten section "Proses Seleksi" halaman publik.
// Null = teks bawaan kamus (ID/EN) dipakai; admin bisa "Sunting Teks" untuk
// mengaktifkan konten kustom (badge, judul, deskripsi, daftar tahap dengan
// durasi + kiat sukses). Konten kustom tampil apa adanya di kedua bahasa —
// konsisten dengan aturan konten admin tidak diterjemahkan.

import {
  ArrowDown,
  ArrowUp,
  ListOrdered,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { CollapsibleCard } from "./collapsible-card";
import { DEFAULT_SELECTION_CONTENT } from "@/lib/defaults";
import type { SelectionContent } from "@/lib/types";

// Batas sama dengan sanitizer di seed.ts — UI mencegah lebih dini.
const MAX_STAGES = 10;
const MAX_TIPS = 6;
const MIN_STAGES = 1;

function cloneDefault(): SelectionContent {
  return JSON.parse(JSON.stringify(DEFAULT_SELECTION_CONTENT)) as SelectionContent;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SelectionContentCard({
  selection,
  onChange,
}: {
  selection: SelectionContent | null;
  onChange: (next: SelectionContent | null) => void;
}) {
  const active = selection !== null;

  function updateStage(index: number, patch: Partial<SelectionContent["stages"][number]>) {
    if (!selection) return;
    onChange({
      ...selection,
      stages: selection.stages.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });
  }

  function moveStage(index: number, dir: -1 | 1) {
    if (!selection) return;
    const target = index + dir;
    if (target < 0 || target >= selection.stages.length) return;
    const next = [...selection.stages];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange({ ...selection, stages: next });
  }

  function removeStage(index: number) {
    if (!selection || selection.stages.length <= MIN_STAGES) return;
    onChange({ ...selection, stages: selection.stages.filter((_, i) => i !== index) });
  }

  function addStage() {
    if (!selection || selection.stages.length >= MAX_STAGES) return;
    onChange({
      ...selection,
      stages: [...selection.stages, { title: "", description: "", duration: "", tips: [] }],
    });
  }

  return (
    <CollapsibleCard
      id="proses-seleksi"
      icon={ListOrdered}
      title="Proses Seleksi"
      description="Badge, judul, dan tahap-tahap section alur seleksi di halaman publik."
      status={
        active
          ? { label: `${selection.stages.length} tahap kustom`, tone: "ok" }
          : { label: "Teks bawaan", tone: "neutral" }
      }
    >
      {!active ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Saat ini section memakai teks bawaan yang ikut bahasa pengunjung
            (Indonesia/Inggris). Aktifkan teks kustom untuk mengatur sendiri isi
            setiap tahap — teks kustom tampil sama di kedua bahasa.
          </p>
          <div>
            <Button type="button" variant="outline" size="sm" onClick={() => onChange(cloneDefault())}>
              Sunting Teks
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="f-selBadge" label="Badge Section">
              <Input
                id="f-selBadge"
                value={selection.badge}
                onChange={(e) => onChange({ ...selection, badge: e.target.value })}
                className="h-10"
                maxLength={60}
              />
            </Field>
            <Field id="f-selTitle" label="Judul Section">
              <Input
                id="f-selTitle"
                value={selection.title}
                onChange={(e) => onChange({ ...selection, title: e.target.value })}
                className="h-10"
                maxLength={120}
              />
            </Field>
            <div className="md:col-span-2">
              <Field id="f-selDesc" label="Deskripsi Section">
                <Textarea
                  id="f-selDesc"
                  value={selection.desc}
                  onChange={(e) => onChange({ ...selection, desc: e.target.value })}
                  rows={2}
                  maxLength={400}
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tahap ({selection.stages.length}/{MAX_STAGES})
            </p>
            {selection.stages.map((stage, index) => (
              <div
                key={index}
                className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <span className="flex size-6 items-center justify-center rounded-md bg-rose-100 text-[11px] font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    Tahap {index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === 0}
                      onClick={() => moveStage(index, -1)}
                      aria-label={`Naikkan tahap ${index + 1}`}
                    >
                      <ArrowUp className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={index === selection.stages.length - 1}
                      onClick={() => moveStage(index, 1)}
                      aria-label={`Turunkan tahap ${index + 1}`}
                    >
                      <ArrowDown className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 text-rose-600 hover:text-rose-700 dark:text-rose-400"
                      disabled={selection.stages.length <= MIN_STAGES}
                      onClick={() => removeStage(index)}
                      aria-label={`Hapus tahap ${index + 1}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field id={`f-selStageTitle-${index}`} label="Judul Tahap">
                    <Input
                      id={`f-selStageTitle-${index}`}
                      value={stage.title}
                      onChange={(e) => updateStage(index, { title: e.target.value })}
                      className="h-10"
                      maxLength={120}
                      placeholder="mis. Seleksi Berkas"
                    />
                  </Field>
                  <Field id={`f-selStageDur-${index}`} label="Durasi" hint="Teks bebas, mis. ±1-3 hari kerja. Kosongkan untuk sembunyikan.">
                    <Input
                      id={`f-selStageDur-${index}`}
                      value={stage.duration}
                      onChange={(e) => updateStage(index, { duration: e.target.value })}
                      className="h-10"
                      maxLength={60}
                      placeholder="±1-3 hari kerja"
                    />
                  </Field>
                </div>
                <Field id={`f-selStageDesc-${index}`} label="Deskripsi Tahap">
                  <Textarea
                    id={`f-selStageDesc-${index}`}
                    value={stage.description}
                    onChange={(e) => updateStage(index, { description: e.target.value })}
                    rows={2}
                    maxLength={400}
                  />
                </Field>
                <Field
                  id={`f-selStageTips-${index}`}
                  label="Kiat Sukses"
                  hint={`Satu kiat per baris (maksimal ${MAX_TIPS} baris). Kosongkan jika tidak ada.`}
                >
                  <Textarea
                    id={`f-selStageTips-${index}`}
                    value={stage.tips.join("\n")}
                    onChange={(e) =>
                      updateStage(index, { tips: e.target.value.split("\n").slice(0, MAX_TIPS) })
                    }
                    onBlur={() =>
                      updateStage(index, {
                        tips: stage.tips.map((t) => t.trim()).filter(Boolean),
                      })
                    }
                    rows={3}
                  />
                </Field>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addStage}
                disabled={selection.stages.length >= MAX_STAGES}
                className="gap-1.5"
              >
                <Plus className="size-4" aria-hidden="true" />
                Tambah Tahap
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Kembali ke Teks Bawaan
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Kembalikan ke teks bawaan?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Teks kustom yang belum disimpan akan hilang. Section akan
                      kembali memakai teks bawaan yang mengikuti bahasa pengunjung.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onChange(null)}>
                      Ya, Kembalikan
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
