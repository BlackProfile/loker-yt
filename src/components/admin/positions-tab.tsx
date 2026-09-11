"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase,
  Copy,
  GripVertical,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { POSITION_TYPES, type Position } from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { localInputToIso, isoToLocalInput } from "./format";

type PositionForm = {
  title: string;
  department: string;
  type: string;
  location: string;
  description: string;
  requirementsText: string;
  closesAtLocal: string;
  isActive: boolean;
};

const EMPTY_FORM: PositionForm = {
  title: "",
  department: "",
  type: "Full-time",
  location: "Remote",
  description: "",
  requirementsText: "",
  closesAtLocal: "",
  isActive: true,
};

function isExpired(closesAt: string | null): boolean {
  if (!closesAt) return false;
  const d = new Date(closesAt);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

function parseRequirements(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function PositionsTab() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Position | null>(null);
  const [form, setForm] = useState<PositionForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<"title" | "department" | "description", string>>>({});
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<Position[]>("/api/admin/positions");
      setPositions(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(position: Position) {
    setEditing(position);
    setForm({
      title: position.title,
      department: position.department,
      type: POSITION_TYPES.includes(position.type as (typeof POSITION_TYPES)[number])
        ? position.type
        : POSITION_TYPES[0],
      location: position.location || "Remote",
      description: position.description,
      requirementsText: position.requirements.join("\n"),
      closesAtLocal: isoToLocalInput(position.closesAt),
      isActive: position.isActive,
    });
    setErrors({});
    setDialogOpen(true);
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!form.title.trim()) next.title = "Nama posisi wajib diisi.";
    if (!form.department.trim()) next.department = "Departemen wajib diisi.";
    if (!form.description.trim()) next.description = "Deskripsi wajib diisi.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (saving) return;
    if (!validate()) return;
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      department: form.department.trim(),
      type: form.type,
      location: form.location.trim() || "Remote",
      description: form.description.trim(),
      requirements: parseRequirements(form.requirementsText),
      closesAt: localInputToIso(form.closesAtLocal),
      isActive: form.isActive,
    };
    try {
      if (editing) {
        await apiPatch<Position>(`/api/admin/positions/${editing.id}`, payload);
        toast.success("Posisi diperbarui");
      } else {
        await apiPost<Position>("/api/admin/positions", payload);
        toast.success("Posisi ditambahkan");
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(position: Position, isActive: boolean) {
    // Optimistik: update UI langsung, kembalikan bila gagal.
    setPositions((prev) =>
      prev.map((p) => (p.id === position.id ? { ...p, isActive } : p))
    );
    try {
      const updated = await apiPatch<Position>(
        `/api/admin/positions/${position.id}`,
        { isActive }
      );
      setPositions((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(isActive ? "Posisi diaktifkan" : "Posisi dinonaktifkan");
    } catch (err) {
      setPositions((prev) =>
        prev.map((p) =>
          p.id === position.id ? { ...p, isActive: position.isActive } : p
        )
      );
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    }
  }

  async function handleDuplicate(position: Position) {
    try {
      await apiPost<Position>(`/api/admin/positions/${position.id}/duplicate`);
      toast.success("Posisi disalin (nonaktif)");
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi."
      );
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/positions/${deleteTarget.id}`);
      toast.success("Posisi dihapus");
      setPositions((prev) => prev.filter((p) => p.id !== deleteTarget.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg">Kelola Posisi</CardTitle>
          <CardDescription className="mt-1">
            Kelola posisi lowongan yang tampil di halaman publik.
          </CardDescription>
        </div>
        <Button onClick={openCreate} className="h-11 active:scale-[0.99] sm:h-10">
          <Plus className="size-4" aria-hidden="true" />
          Tambah Posisi
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))}
        </div>
      ) : positions.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Briefcase className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada posisi. Tambahkan posisi pertama Anda.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {positions.map((position) => (
            <Card
              key={position.id}
              className="gap-0 rounded-2xl p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="flex flex-wrap items-center gap-3 px-0">
                <GripVertical
                  className="hidden size-5 shrink-0 text-muted-foreground/40 sm:block"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{position.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {position.department}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">{position.type || "-"}</Badge>
                    <Badge variant="secondary" className="gap-1">
                      <MapPin className="size-3" aria-hidden="true" />
                      {position.location || "-"}
                    </Badge>
                    {position.closesAt ? (
                      isExpired(position.closesAt) ? (
                        <Badge className="border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400">
                          Kedaluwarsa
                        </Badge>
                      ) : (
                        <Badge className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                          Tutup otomatis{" "}
                          {format(new Date(position.closesAt), "dd MMM", { locale: localeId })}
                        </Badge>
                      )
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={position.isActive}
                    onCheckedChange={(checked) => void handleToggle(position, checked)}
                    aria-label={`Aktifkan posisi ${position.title}`}
                  />
                  <span className="hidden text-xs text-muted-foreground lg:block">
                    {position.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-9"
                    onClick={() => void handleDuplicate(position)}
                    aria-label={`Duplikat posisi ${position.title}`}
                  >
                    <Copy className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 sm:size-9"
                    onClick={() => openEdit(position)}
                    aria-label={`Edit posisi ${position.title}`}
                  >
                    <Pencil className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9"
                    onClick={() => setDeleteTarget(position)}
                    aria-label={`Hapus posisi ${position.title}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog tambah/edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden rounded-2xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit Posisi" : "Tambah Posisi"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Perbarui informasi posisi lowongan."
                : "Tambahkan posisi lowongan baru untuk halaman publik."}
            </DialogDescription>
          </DialogHeader>
          <div className="-mr-2 max-h-[70vh] overflow-y-auto pr-2 nice-scrollbar">
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pos-title">Nama Posisi *</Label>
                <Input
                  id="pos-title"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="mis. Content Video Creator"
                  className="h-10"
                />
                {errors.title ? (
                  <p className="text-xs text-rose-600" role="alert">{errors.title}</p>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pos-department">Departemen *</Label>
                  <Input
                    id="pos-department"
                    value={form.department}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, department: e.target.value }))
                    }
                    placeholder="mis. Produksi"
                    className="h-10"
                  />
                  {errors.department ? (
                    <p className="text-xs text-rose-600" role="alert">{errors.department}</p>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Jenis</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}
                  >
                    <SelectTrigger className="h-10 w-full" aria-label="Jenis pekerjaan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POSITION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pos-location">Lokasi</Label>
                <Input
                  id="pos-location"
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Remote"
                  className="h-10"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pos-closesAt">Tanggal Penutupan (opsional)</Label>
                <Input
                  id="pos-closesAt"
                  type="datetime-local"
                  value={form.closesAtLocal}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, closesAtLocal: e.target.value }))
                  }
                  className="h-10"
                />
                <p className="text-xs text-muted-foreground">
                  Posisi berhenti tampil di halaman publik setelah waktu ini.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pos-description">Deskripsi *</Label>
                <Textarea
                  id="pos-description"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder="Jelaskan tanggung jawab dan gambaran umum posisi..."
                  rows={4}
                />
                {errors.description ? (
                  <p className="text-xs text-rose-600" role="alert">{errors.description}</p>
                ) : null}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pos-requirements">Persyaratan</Label>
                <Textarea
                  id="pos-requirements"
                  value={form.requirementsText}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, requirementsText: e.target.value }))
                  }
                  placeholder={"Satu persyaratan per baris, mis.:\nMenguasai editing video\nPunya portofolio konten"}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Satu persyaratan per baris.
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Aktifkan posisi</p>
                  <p className="text-xs text-muted-foreground">
                    Tampil di halaman publik
                  </p>
                </div>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, isActive: checked }))
                  }
                  aria-label="Aktifkan posisi (tampil di halaman publik)"
                />
              </div>

              {/* Tombol submit tersembunyi agar Enter mensubmit form */}
              <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
            </form>
          </div>
          <DialogFooter className="gap-2 border-t pt-4">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="h-10"
            >
              Batal
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving} className="h-10">
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : editing ? (
                "Simpan Perubahan"
              ) : (
                "Tambah Posisi"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi hapus posisi */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus posisi ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Posisi "${deleteTarget.title}" akan dihapus permanen. Tindakan tidak bisa dibatalkan.`
                : "Tindakan tidak bisa dibatalkan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleting}
            >
              {deleting ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
