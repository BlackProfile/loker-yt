"use client";

// Editor daftar bersama untuk form posisi v3.
// - StringListEditor: daftar teks sederhana (benefit, contoh karya, tahap pipeline, dll).
//   Batas item & karakter dikunci di sini sesuai batas server (tombol Tambah disable).
// - ScreeningQuestionsEditor: daftar pertanyaan screening (label + wajib + urutan).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
} from "lucide-react";
import type { ScreeningQuestion } from "@/lib/types";

export function StringListEditor({
  items,
  onChange,
  maxItems,
  maxLength,
  addLabel,
  name,
  placeholder,
  hint,
  urlOnly = false,
  disabled = false,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  maxItems: number;
  maxLength: number;
  addLabel: string;
  name: string;
  placeholder?: string;
  hint?: string;
  urlOnly?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const full = items.length >= maxItems;

  function addItem() {
    const value = draft.trim();
    if (!value || full || value.length > maxLength) return;
    if (urlOnly && !/^https?:\/\//i.test(value)) return;
    onChange([...items, value]);
    setDraft("");
  }

  function updateItem(index: number, value: string) {
    onChange(items.map((item, i) => (i === index ? value : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={index} className="flex items-center gap-2">
              <Input
                value={item}
                onChange={(e) => updateItem(index, e.target.value)}
                placeholder={placeholder}
                maxLength={maxLength}
                disabled={disabled}
                className="h-10"
                aria-label={`${name} #${index + 1}`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9 dark:hover:bg-rose-950"
                onClick={() => removeItem(index)}
                disabled={disabled}
                aria-label={`Hapus ${name} #${index + 1}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">Belum ada item.</p>
      )}

      {!full ? (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder={placeholder ?? "Tambah item baru..."}
            maxLength={maxLength}
            disabled={disabled}
            className="h-10"
            aria-label={`${name} baru`}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 active:scale-[0.99] sm:h-10"
            onClick={addItem}
            disabled={disabled}
            aria-label={addLabel}
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah
          </Button>
        </div>
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Batas maksimal {maxItems} item tercapai.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {items.length}/{maxItems} item
        {urlOnly ? " · Harus diawali https:// atau http://" : ` · Maksimal ${maxLength} karakter per item`}
        {hint ? ` — ${hint}` : ""}
      </p>
    </div>
  );
}

export function ScreeningQuestionsEditor({
  items,
  onChange,
  maxItems,
  disabled = false,
}: {
  items: ScreeningQuestion[];
  onChange: (items: ScreeningQuestion[]) => void;
  maxItems: number;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const full = items.length >= maxItems;

  function addItem() {
    const label = draft.trim();
    if (label.length < 3 || label.length > 200 || full) return;
    const id = `q${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
    onChange([...items, { id, label, required: false }]);
    setDraft("");
  }

  function updateItem(index: number, patch: Partial<ScreeningQuestion>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40"
            >
              <div className="flex items-center gap-2">
                <Input
                  value={item.label}
                  onChange={(e) => updateItem(index, { label: e.target.value })}
                  maxLength={200}
                  disabled={disabled}
                  placeholder={`Pertanyaan #${index + 1}`}
                  className="h-10"
                  aria-label={`Label pertanyaan screening #${index + 1}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9 dark:hover:bg-rose-950"
                  onClick={() => removeItem(index)}
                  disabled={disabled}
                  aria-label={`Hapus pertanyaan screening #${index + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={item.required}
                    onCheckedChange={(checked) => updateItem(index, { required: checked })}
                    disabled={disabled}
                    aria-label={`Pertanyaan #${index + 1} wajib diisi`}
                  />
                  <Label className="text-xs font-normal text-muted-foreground">
                    Wajib diisi
                  </Label>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-9"
                    onClick={() => move(index, -1)}
                    disabled={disabled || index === 0}
                    aria-label={`Naikkan pertanyaan #${index + 1}`}
                  >
                    <ChevronUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-9"
                    onClick={() => move(index, 1)}
                    disabled={disabled || index === items.length - 1}
                    aria-label={`Turunkan pertanyaan #${index + 1}`}
                  >
                    <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Belum ada pertanyaan. Pelamar tidak akan diminta mengisi jawaban screening.
        </p>
      )}

      {!full ? (
        <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addItem();
              }
            }}
            placeholder="Tulis pertanyaan screening baru..."
            maxLength={200}
            disabled={disabled}
            className="h-10"
            aria-label="Pertanyaan screening baru"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-11 shrink-0 active:scale-[0.99] sm:h-10"
            onClick={addItem}
            disabled={disabled || draft.trim().length < 3}
            aria-label="Tambah pertanyaan screening"
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah
          </Button>
        </div>
      ) : (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Batas maksimal {maxItems} pertanyaan tercapai.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        {items.length}/{maxItems} pertanyaan · Label 3-200 karakter · Urutan memengaruhi tampilan di formulir pelamar.
      </p>
    </div>
  );
}
