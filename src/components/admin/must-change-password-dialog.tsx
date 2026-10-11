"use client";

// NR46 Paket B — Dialog WAJIB ganti sandi (tidak dapat ditutup) untuk akun
// dengan mustChangePassword = true (akun buatan OWNER dengan kebijakan
// "wajib ganti sandi saat login pertama").
//
// - GET /api/admin/password-policy -> description ditampilkan sebagai bullet
//   kecil agar pengguna tahu syarat sandi aktif.
// - POST /api/admin/users/password { currentPassword, newPassword }.
// - Sukses: toast "Sandi diganti" + tutup dialog (onDone).
// - Gagal: toast.error pesan dari body server.
// - Dialog TIDAK bisa ditutup (escape/outside dicegah, tanpa tombol close).

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
import { Label } from "@/components/ui/label";
import { apiGet, apiPost, ApiError } from "./api";

type PasswordPolicyResponse = {
  policy: { minLength: number };
  description: string[];
};

export function MustChangePasswordDialog({
  open,
  onDone,
}: {
  open: boolean;
  onDone: () => void;
}) {
  const [policyDescription, setPolicyDescription] = useState<string[]>([]);
  const [minLength, setMinLength] = useState(8);
  const [policyFailed, setPolicyFailed] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Muat kebijakan sandi saat dialog dibuka (sekali per pembukaan).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPolicyFailed(false);
    apiGet<PasswordPolicyResponse>("/api/admin/password-policy")
      .then((data) => {
        if (cancelled) return;
        setPolicyDescription(Array.isArray(data.description) ? data.description : []);
        const n = Number(data.policy?.minLength);
        setMinLength(Number.isFinite(n) ? n : 8);
      })
      .catch(() => {
        if (!cancelled) setPolicyFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const resetFields = useCallback(() => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (!currentPassword) {
      toast.warning("Masukkan sandi saat ini yang diberikan OWNER.");
      return;
    }
    if (newPassword.length < Math.max(6, minLength)) {
      toast.warning(`Sandi baru minimal ${Math.max(6, minLength)} karakter.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.warning("Konfirmasi sandi tidak sama dengan sandi baru.");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost<{ ok: boolean }>("/api/admin/users/password", {
        currentPassword,
        newPassword,
      });
      toast.success("Sandi diganti");
      resetFields();
      onDone();
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message
          ? err.message
          : "Gagal mengganti sandi. Coba lagi.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Dialog wajib: tutup dari luar diabaikan sampai sandi berhasil diganti.
        if (!o && submitting) return;
      }}
    >
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="nice-scrollbar max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Ganti Sandi Anda
          </DialogTitle>
          <DialogDescription>
            Akun ini wajib mengganti sandi sebelum dapat digunakan. Masukkan sandi sementara yang
            diberikan OWNER, lalu tentukan sandi baru Anda.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="must-pw-current">Sandi saat ini</Label>
            <Input
              id="must-pw-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="must-pw-new">Sandi baru</Label>
            <Input
              id="must-pw-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="must-pw-confirm">Konfirmasi sandi baru</Label>
            <Input
              id="must-pw-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-11"
            />
          </div>

          {policyDescription.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-lg border bg-muted/40 p-3">
              {policyDescription.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className="mt-1 size-1 shrink-0 rounded-full bg-rose-600"
                  />
                  {line}
                </li>
              ))}
            </ul>
          ) : policyFailed ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Syarat sandi tidak dapat dimuat — ikuti ketentuan minimal {Math.max(6, minLength)}{" "}
              karakter. Server tetap memvalidasi kebijakan terkini.
            </p>
          ) : null}

          <DialogFooter className="gap-2 border-t pt-4">
            <Button type="submit" className="h-11 w-full sm:h-10" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : (
                "Ganti Sandi"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
