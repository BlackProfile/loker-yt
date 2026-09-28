"use client";

// TemplatePicker — dialog pemilih template pesan global (MessageTemplate).
// Dipakai offer-dialog (kind OFFER) dan quick-reject-dialog (kind REJECT):
// pilih template -> body dikembalikan lewat onPick untuk mengisi field pesan/catatan.
// Menyediakan kelola sederhana inline: tambah template baru & hapus (OWNER/HR).
// Variabel {nama}, {posisi}, dll dibiarkan apa adanya — pengisian variabel
// ditangani mekanisme template per posisi yang sudah ada.

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost } from "./api";
import { useAdminSession } from "./admin-context";

export type TemplateKind = "OFFER" | "REJECT" | "INVITE" | "CUSTOM";

type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

const KIND_LABELS: Record<TemplateKind, string> = {
  OFFER: "Penawaran",
  REJECT: "Penolakan",
  INVITE: "Undangan",
  CUSTOM: "Kustom",
};

export function TemplatePicker({
  open,
  onOpenChange,
  kind,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: TemplateKind;
  onPick: (body: string) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [rows, setRows] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newBody, setNewBody] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<TemplateRow[]>("/api/admin/templates");
      setRows(data.filter((t) => t.kind === kind));
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [kind, reportError]);

  // Muat setiap kali dialog dibuka agar daftar selalu segar.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  function handlePick(template: TemplateRow) {
    onPick(template.body);
    onOpenChange(false);
    toast.success(`Template "${template.name}" dipakai`, {
      description: "Isi pesan terisi dari template — sesuaikan bila perlu.",
    });
  }

  async function handleAdd() {
    if (adding) return;
    const name = newName.trim();
    const body = newBody.trim();
    if (!name) {
      toast.error("Nama template wajib diisi.");
      return;
    }
    if (!body) {
      toast.error("Isi template wajib diisi.");
      return;
    }
    setAdding(true);
    try {
      const res = await apiPost<{ template: TemplateRow }>("/api/admin/templates", {
        name,
        kind,
        body,
      });
      setRows((prev) => [res.template, ...prev]);
      setNewName("");
      setNewBody("");
      setShowAdd(false);
      toast.success("Template ditambahkan");
    } catch (err) {
      reportError(err);
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(template: TemplateRow) {
    const ok = window.confirm(`Hapus template "${template.name}"?`);
    if (!ok) return;
    try {
      await apiDelete(`/api/admin/templates/${template.id}`);
      setRows((prev) => prev.filter((t) => t.id !== template.id));
      toast.success("Template dihapus");
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Pilih Template {KIND_LABELS[kind]}
          </DialogTitle>
          <DialogDescription>
            Template mengisi area pesan. Variabel seperti{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{"{nama}"}</code> dan{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{"{posisi}"}</code>{" "}
            akan diisi otomatis sesuai konteks.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat template...
          </div>
        ) : rows.length === 0 && !showAdd ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Belum ada template {KIND_LABELS[kind].toLowerCase()}.
          </p>
        ) : (
          <ul className="flex max-h-96 flex-col divide-y overflow-y-auto rounded-xl border nice-scrollbar">
            {rows.map((template) => (
              <li
                key={template.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{template.name}</p>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                    {template.body}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs"
                    onClick={() => handlePick(template)}
                  >
                    Pakai
                  </Button>
                  {canMutate ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950"
                      onClick={() => void handleDelete(template)}
                      aria-label={`Hapus template ${template.name}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {canMutate ? (
          showAdd ? (
            <div className="flex flex-col gap-3 rounded-xl border p-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-picker-name">Nama template</Label>
                <Input
                  id="template-picker-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={`Mis. Offer ramah — ${KIND_LABELS[kind]}`}
                  maxLength={120}
                  className="h-10"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="template-picker-body">Isi pesan</Label>
                <Textarea
                  id="template-picker-body"
                  value={newBody}
                  onChange={(e) => setNewBody(e.target.value)}
                  placeholder={"Halo {nama},\n\nKami dari Lumina Studio terkait lamaran {posisi} kamu..."}
                  rows={4}
                  maxLength={4000}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => setShowAdd(false)}
                  disabled={adding}
                >
                  Batal
                </Button>
                <Button
                  size="sm"
                  className="h-9 active:scale-[0.99]"
                  onClick={() => void handleAdd()}
                  disabled={adding}
                >
                  {adding ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  Simpan Template
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-fit gap-1.5"
              onClick={() => setShowAdd(true)}
            >
              <Plus className="size-4" aria-hidden="true" />
              Template Baru
            </Button>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
