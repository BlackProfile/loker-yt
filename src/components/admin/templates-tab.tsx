"use client";

// Tab Template — pustaka template pesan global (lintas posisi).
// CRUD MessageTemplate via /api/admin/templates; dipakai offer/reject/invite
// melalui komponen TemplatePicker. VIEWER hanya dapat melihat.

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { useAdminSession } from "./admin-context";

type TemplateKind = "OFFER" | "REJECT" | "INVITE" | "CUSTOM";

type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

const KINDS: TemplateKind[] = ["OFFER", "REJECT", "INVITE", "CUSTOM"];

const KIND_LABELS: Record<TemplateKind, string> = {
  OFFER: "Penawaran",
  REJECT: "Penolakan",
  INVITE: "Undangan",
  CUSTOM: "Kustom",
};

const KIND_BADGE: Record<TemplateKind, string> = {
  OFFER: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300",
  REJECT: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
  INVITE: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  CUSTOM: "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-500/40 dark:bg-zinc-500/10 dark:text-zinc-300",
};

function formatDateId(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", { dateStyle: "long" });
}

export function TemplatesTab() {
  const { session, canMutate } = useAdminSession();
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [filter, setFilter] = useState<TemplateKind | "ALL">("ALL");
  const [busy, setBusy] = useState<string | null>(null);

  // Form buat/ubah
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formKind, setFormKind] = useState<TemplateKind>("CUSTOM");
  const [formBody, setFormBody] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setRows(null);
    try {
      const data = await apiGet<TemplateRow[]>("/api/admin/templates");
      setRows(data);
    } catch (err) {
      if (!silent) setRows([]);
      toast.error(err instanceof Error ? err.message : "Gagal memuat template.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setFormName("");
    setFormKind("CUSTOM");
    setFormBody("");
    setEditorOpen(true);
  }

  function openEdit(row: TemplateRow) {
    setEditingId(row.id);
    setFormName(row.name);
    setFormKind((KINDS as string[]).includes(row.kind) ? (row.kind as TemplateKind) : "CUSTOM");
    setFormBody(row.body);
    setEditorOpen(true);
  }

  async function handleSave() {
    if (!formName.trim() || !formBody.trim()) {
      toast.error("Nama dan isi template wajib diisi.");
      return;
    }
    setBusy("save");
    try {
      if (editingId) {
        await apiPatch(`/api/admin/templates/${editingId}`, {
          name: formName.trim(),
          kind: formKind,
          body: formBody,
        });
        toast.success("Template diperbarui.");
      } else {
        await apiPost("/api/admin/templates", {
          name: formName.trim(),
          kind: formKind,
          body: formBody,
        });
        toast.success("Template dibuat.");
      }
      setEditorOpen(false);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menyimpan template.");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusy(deleteTarget.id);
    try {
      await apiDelete(`/api/admin/templates/${deleteTarget.id}`);
      toast.success(`Template "${deleteTarget.name}" dihapus.`);
      setDeleteTarget(null);
      await load(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus template.");
    } finally {
      setBusy(null);
    }
  }

  const visible = (rows ?? []).filter((row) => filter === "ALL" || row.kind === filter);

  return (
    <div className="flex flex-col gap-4">
      <Card className="rounded-2xl p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Pustaka Template Pesan
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Template global lintas posisi. Variabel seperti {"{nama}"}, {"{posisi}"}, {"{gaji}"} otomatis
              diisi saat pesan dikirim dari dialog penawaran/penolakan.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={filter} onValueChange={(v) => setFilter(v as TemplateKind | "ALL")}>
              <SelectTrigger className="h-10 w-40" aria-label="Filter jenis template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Semua jenis</SelectItem>
                {KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              className="h-10"
              onClick={openCreate}
              disabled={!canMutate}
              aria-label="Buat template baru"
            >
              <Plus className="size-4" aria-hidden="true" />
              Template Baru
            </Button>
          </div>
        </div>

        {rows === null ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat template...
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed p-8 text-center">
            <p className="text-sm font-medium">Belum ada template{filter !== "ALL" ? ` ${KIND_LABELS[filter as TemplateKind].toLowerCase()}` : ""}.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Buat template pertama untuk mempercepat pengiriman pesan ke kandidat.
            </p>
          </div>
        ) : (
          <ul className="mt-5 grid max-h-96 gap-3 overflow-y-auto nice-scrollbar pr-1">
            {visible.map((row, index) => {
              const kind = (KINDS as string[]).includes(row.kind) ? (row.kind as TemplateKind) : "CUSTOM";
              return (
                <motion.li
                  key={row.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.3) }}
                  className="rounded-xl border p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-medium">{row.name}</p>
                        <Badge variant="outline" className={KIND_BADGE[kind]}>
                          {KIND_LABELS[kind]}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-muted-foreground">
                        {row.body}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Diperbarui {formatDateId(row.updatedAt)}
                      </p>
                    </div>
                    {canMutate ? (
                      <div className="flex shrink-0 gap-2">
                        <Button variant="outline" size="sm" className="h-9" onClick={() => openEdit(row)}>
                          Ubah
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 px-2 text-rose-600 hover:text-rose-700"
                          onClick={() => setDeleteTarget(row)}
                          aria-label={`Hapus template ${row.name}`}
                          disabled={busy !== null}
                        >
                          {busy === row.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="size-4" aria-hidden="true" />
                          )}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Dialog buat/ubah template */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Ubah Template" : "Template Baru"}</DialogTitle>
            <DialogDescription>
              Isi pesan dapat memakai variabel seperti {"{nama}"}, {"{posisi}"}, {"{gaji}"}, {"{kode}"}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-name">Nama template</Label>
              <Input
                id="tpl-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="mis. Offer ramah — gaji standar"
                maxLength={80}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-kind">Jenis</Label>
              <Select value={formKind} onValueChange={(v) => setFormKind(v as TemplateKind)}>
                <SelectTrigger id="tpl-kind" className="h-10" aria-label="Jenis template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-body">Isi pesan</Label>
              <Textarea
                id="tpl-body"
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                rows={7}
                maxLength={2000}
                placeholder={"Halo {nama},\n\nSelamat! Kami menawarkanmu posisi {posisi} dengan kompensasi {gaji}. Mohon jawab sebelum {deadline}."}
              />
              <p className="text-xs text-muted-foreground">{formBody.length}/2000 karakter</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={busy === "save"} className="h-10">
              Batal
            </Button>
            <Button onClick={() => void handleSave()} disabled={busy === "save"} className="h-10">
              {busy === "save" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {editingId ? "Simpan Perubahan" : "Buat Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog konfirmasi hapus */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-rose-600" aria-hidden="true" />
              Hapus Template
            </DialogTitle>
            <DialogDescription>
              Template "{deleteTarget?.name}" akan dihapus permanen. Template yang sudah terpakai di pesan lama
              tidak ikut terhapus.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={busy !== null} className="h-10">
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleDelete()}
              disabled={busy !== null}
              className="h-10"
            >
              {busy === deleteTarget?.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Hapus
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {!canMutate && session ? (
        <p className="text-xs text-muted-foreground">
          Mode pengamat — perubahan template dinonaktifkan.
        </p>
      ) : null}
    </div>
  );
}
