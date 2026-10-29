"use client";

// NR68 (#13) — Kartu editor konten section "Bekerja di Lumina" (budaya kerja).
// null = section disembunyikan (admin belum mengisi konten); admin bisa
// "Sunting Teks" untuk mengaktifkan konten kustom (badge, judul, deskripsi,
// daftar kartu budaya). Konten tampil apa adanya di kedua bahasa.

import { Heart, Plus, RotateCcw, Trash2 } from "lucide-react";
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
import { DEFAULT_WORK_CULTURE_CONTENT } from "@/lib/defaults";
import type { WorkCultureContent } from "@/lib/types";

const MAX_ITEMS = 8;
const MIN_ITEMS = 1;

function cloneDefault(): WorkCultureContent {
  return JSON.parse(JSON.stringify(DEFAULT_WORK_CULTURE_CONTENT)) as WorkCultureContent;
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

export function WorkCultureContentCard({
  workCulture,
  onChange,
}: {
  workCulture: WorkCultureContent | null;
  onChange: (next: WorkCultureContent | null) => void;
}) {
  const active = workCulture !== null;

  function updateItem(index: number, patch: Partial<WorkCultureContent["items"][number]>) {
    if (!workCulture) return;
    onChange({
      ...workCulture,
      items: workCulture.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    });
  }

  function removeItem(index: number) {
    if (!workCulture || workCulture.items.length <= MIN_ITEMS) return;
    onChange({ ...workCulture, items: workCulture.items.filter((_, i) => i !== index) });
  }

  function addItem() {
    if (!workCulture || workCulture.items.length >= MAX_ITEMS) return;
    onChange({ ...workCulture, items: [...workCulture.items, { title: "", description: "" }] });
  }

  return (
    <CollapsibleCard
      id="bekerja-di-lumina"
      icon={Heart}
      title="Bekerja di Lumina"
      description="Section budaya kerja di halaman publik — tampil hanya bila konten sudah diisi."
      status={
        active
          ? { label: `${workCulture.items.length} kartu`, tone: "ok" }
          : { label: "Nonaktif", tone: "neutral" }
      }
    >
      {!active ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Section ini disembunyikan dari halaman publik sampai kamu mengisi
            kontennya. Aktifkan teks kustom untuk menampilkan budaya kerja
            studio — tampil sama di kedua bahasa.
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
            <Field id="f-wcBadge" label="Badge Section">
              <Input
                id="f-wcBadge"
                value={workCulture.badge}
                onChange={(e) => onChange({ ...workCulture, badge: e.target.value })}
                className="h-10"
                maxLength={60}
              />
            </Field>
            <Field id="f-wcTitle" label="Judul Section">
              <Input
                id="f-wcTitle"
                value={workCulture.title}
                onChange={(e) => onChange({ ...workCulture, title: e.target.value })}
                className="h-10"
                maxLength={120}
              />
            </Field>
            <div className="md:col-span-2">
              <Field id="f-wcDesc" label="Deskripsi Section">
                <Textarea
                  id="f-wcDesc"
                  value={workCulture.desc}
                  onChange={(e) => onChange({ ...workCulture, desc: e.target.value })}
                  rows={2}
                  maxLength={400}
                />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Kartu Budaya ({workCulture.items.length}/{MAX_ITEMS})
            </p>
            {workCulture.items.map((item, index) => (
              <div
                key={index}
                className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <span className="flex size-6 items-center justify-center rounded-md bg-rose-100 text-[11px] font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    Kartu {index + 1}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 text-rose-600 hover:text-rose-700 dark:text-rose-400"
                    disabled={workCulture.items.length <= MIN_ITEMS}
                    onClick={() => removeItem(index)}
                    aria-label={`Hapus kartu ${index + 1}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <Field id={`f-wcItemTitle-${index}`} label="Judul Kartu">
                  <Input
                    id={`f-wcItemTitle-${index}`}
                    value={item.title}
                    onChange={(e) => updateItem(index, { title: e.target.value })}
                    className="h-10"
                    maxLength={120}
                    placeholder="mis. Tim Kecil, Suara Didengar"
                  />
                </Field>
                <Field id={`f-wcItemDesc-${index}`} label="Deskripsi Kartu">
                  <Textarea
                    id={`f-wcItemDesc-${index}`}
                    value={item.description}
                    onChange={(e) => updateItem(index, { description: e.target.value })}
                    rows={2}
                    maxLength={400}
                  />
                </Field>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
                disabled={workCulture.items.length >= MAX_ITEMS}
                className="gap-1.5"
              >
                <Plus className="size-4" aria-hidden="true" />
                Tambah Kartu
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Nonaktifkan Section
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Nonaktifkan section ini?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Konten kustom yang belum disimpan akan hilang. Section
                      akan disembunyikan dari halaman publik sampai diisi lagi.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onChange(null)}>
                      Ya, Nonaktifkan
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
