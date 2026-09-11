"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
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
import { Badge } from "@/components/ui/badge";
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
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  ROLES,
  ROLE_LABELS,
  type AdminUser,
  type Role,
} from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { roleBadgeClass, formatDate } from "./format";
import { useAdminSession } from "./admin-context";
import { cn } from "@/lib/utils";

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="h-10 pr-10"
        />
        <button
          type="button"
          aria-label={show ? `Sembunyikan ${label.toLowerCase()}` : `Lihat ${label.toLowerCase()}`}
          onClick={() => setShow((v) => !v)}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {show ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

type UserForm = {
  name: string;
  email: string;
  role: Role;
  password: string;
  isActive: boolean;
};

const EMPTY_FORM: UserForm = {
  name: "",
  email: "",
  role: "HR",
  password: "",
  isActive: true,
};

export function UsersTab() {
  const { reportError } = useAdminSession();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Ganti password sendiri
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  // Dialog tambah/edit
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<"name" | "email" | "password", string>>>({});
  const [saving, setSaving] = useState(false);

  // Hapus
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<AdminUser[]>("/api/admin/users");
      setUsers(data);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(user: AdminUser) {
    setEditing(user);
    setForm({
      name: user.name,
      email: user.email,
      role: user.role,
      password: "",
      isActive: user.isActive,
    });
    setErrors({});
    setDialogOpen(true);
  }

  function validate(): boolean {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = "Nama wajib diisi.";
    if (!form.email.trim() || !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      next.email = "Email tidak valid.";
    }
    if (!editing && form.password.length < 6) {
      next.password = "Password minimal 6 karakter.";
    }
    if (editing && form.password && form.password.length < 6) {
      next.password = "Password baru minimal 6 karakter.";
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (saving || !validate()) return;
    setSaving(true);
    try {
      if (editing) {
        const payload: Record<string, unknown> = {
          name: form.name.trim(),
          role: form.role,
          isActive: form.isActive,
        };
        if (form.password) payload.password = form.password;
        await apiPatch<AdminUser>(`/api/admin/users/${editing.id}`, payload);
        toast.success("Pengguna diperbarui");
      } else {
        await apiPost<AdminUser>("/api/admin/users", {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          password: form.password,
        });
        toast.success("Pengguna ditambahkan");
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(user: AdminUser, isActive: boolean) {
    setUsers((prev) =>
      prev.map((u) => (u.id === user.id ? { ...u, isActive } : u))
    );
    try {
      await apiPatch<AdminUser>(`/api/admin/users/${user.id}`, { isActive });
      toast.success(isActive ? "Pengguna diaktifkan" : "Pengguna dinonaktifkan");
      await load();
    } catch (err) {
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, isActive: user.isActive } : u))
      );
      reportError(err);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/users/${deleteTarget.id}`);
      toast.success("Pengguna dihapus");
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function handleChangePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pwSaving) return;
    setPwError(null);
    if (newPassword.length < 6) {
      setPwError("Password baru minimal 6 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Konfirmasi password tidak sama dengan password baru.");
      return;
    }
    setPwSaving(true);
    try {
      await apiPost<{ ok: boolean }>("/api/admin/users/password", {
        currentPassword,
        newPassword,
      });
      toast.success("Password berhasil diganti");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      reportError(err);
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Ganti Password Saya */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Ganti Password Saya
          </CardTitle>
          <CardDescription>
            Ganti password akun Anda sendiri. Berlaku untuk semua role.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-3">
              <PasswordField
                id="u-currentPassword"
                label="Password saat ini"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <PasswordField
                id="u-newPassword"
                label="Password baru"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
              />
              <PasswordField
                id="u-confirmPassword"
                label="Konfirmasi password baru"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
            </div>
            {pwError ? (
              <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                {pwError}
              </p>
            ) : null}
            <div>
              <Button type="submit" className="h-10" disabled={pwSaving}>
                {pwSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Menyimpan...
                  </>
                ) : (
                  "Ganti Password"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Daftar pengguna */}
      <Card className="gap-0 rounded-2xl py-6">
        <CardHeader className="flex-row items-center justify-between px-6">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Kelola Pengguna
            </CardTitle>
            <CardDescription className="mt-1">
              Admin panel dengan role Pemilik, HR, atau Pengamat.
            </CardDescription>
          </div>
          <Button onClick={openCreate} className="h-11 active:scale-[0.99] sm:h-10">
            <Plus className="size-4" aria-hidden="true" />
            Tambah Pengguna
          </Button>
        </CardHeader>
        <CardContent className="px-6">
          {loading ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Users className="size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">Belum ada pengguna.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {users.map((user) => (
                <div
                  key={user.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-colors duration-150 hover:border-zinc-300 dark:hover:border-zinc-600"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                    {user.name.charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{user.name}</p>
                      <Badge
                        variant="outline"
                        className={cn("px-1.5 py-0 text-[10px]", roleBadgeClass(user.role))}
                      >
                        {ROLE_LABELS[user.role]}
                      </Badge>
                      {!user.isActive ? (
                        <Badge
                          variant="outline"
                          className="border-zinc-200 bg-zinc-100 px-1.5 py-0 text-[10px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400"
                        >
                          Nonaktif
                        </Badge>
                      ) : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email} · sejak {formatDate(user.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={user.isActive}
                      onCheckedChange={(checked) => void handleToggleActive(user, checked)}
                      aria-label={`Aktifkan pengguna ${user.name}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      onClick={() => openEdit(user)}
                      aria-label={`Edit pengguna ${user.name}`}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9 dark:hover:bg-rose-950"
                      onClick={() => setDeleteTarget(user)}
                      aria-label={`Hapus pengguna ${user.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog tambah/edit */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Pengguna" : "Tambah Pengguna"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Perbarui data pengguna panel admin."
                : "Buat akun admin baru dengan role tertentu."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-name">Nama *</Label>
              <Input
                id="u-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="mis. Rani Putri"
                className="h-10"
              />
              {errors.name ? (
                <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
                  {errors.name}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="u-email">Email *</Label>
              <Input
                id="u-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="nama@lumina.id"
                className="h-10"
                disabled={!!editing}
              />
              {errors.email ? (
                <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
                  {errors.email}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Role</Label>
              <Select
                value={form.role}
                onValueChange={(v) => setForm((f) => ({ ...f, role: v as Role }))}
              >
                <SelectTrigger className="h-10 w-full" aria-label="Role pengguna">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <PasswordField
              id="u-password"
              label={editing ? "Password Baru (opsional)" : "Password *"}
              value={form.password}
              onChange={(v) => setForm((f) => ({ ...f, password: v }))}
              autoComplete="new-password"
              placeholder={editing ? "Kosongkan jika tidak diganti" : "Minimal 6 karakter"}
            />
            {errors.password ? (
              <p className="-mt-2 text-xs text-rose-600 dark:text-rose-400" role="alert">
                {errors.password}
              </p>
            ) : null}
            {editing ? (
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Akun aktif</p>
                  <p className="text-xs text-muted-foreground">
                    Pengguna nonaktif tidak bisa login
                  </p>
                </div>
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(checked) =>
                    setForm((f) => ({ ...f, isActive: checked }))
                  }
                  aria-label="Akun aktif"
                />
              </div>
            ) : null}
            <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
          </form>
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
                "Tambah Pengguna"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi hapus */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pengguna ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Akun ${deleteTarget.name} (${deleteTarget.email}) akan dihapus permanen.`
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
