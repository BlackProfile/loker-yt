"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import type { AdminSession } from "@/lib/types";
import { ApiError, apiPost } from "./api";
import { Reveal } from "./motion-primitives";

const DEMO_ACCOUNTS = [
  { role: "Owner", email: "admin@lumina.id", password: "admin123" },
  { role: "HR", email: "hr@lumina.id", password: "admin123" },
  { role: "Pengamat", email: "viewer@lumina.id", password: "admin123" },
] as const;

export function LoginCard({
  onSuccess,
}: {
  onSuccess: (session: AdminSession) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demoRole, setDemoRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 2FA: muncul setelah server membalas 401 { error: "KODE_2FA" }.
  const [needsTotp, setNeedsTotp] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  function handleLoginError(err: unknown) {
    if (err instanceof ApiError) {
      if (err.status === 429 || err.message === "LOCKOUT") {
        // Sisa waktu blokir sengaja tidak diekspos server.
        setError(
          "Terlalu banyak percobaan gagal. Akun diblokir sementara — coba lagi nanti."
        );
      } else if (err.message === "KODE_2FA") {
        setNeedsTotp(true);
        setError("Kode 2FA salah atau kedaluwarsa. Coba lagi.");
      } else if (err.status === 401) {
        setError(err.message || "Email atau password salah.");
      } else {
        setError(err.message);
      }
    } else if (err instanceof Error) {
      setError(err.message);
    } else {
      setError("Terjadi kesalahan. Coba lagi.");
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost<{ ok: boolean; session: AdminSession }>(
        "/api/admin/login",
        {
          email: email.trim(),
          password,
          ...(needsTotp || totpCode ? { totpCode } : {}),
        }
      );
      toast.success("Berhasil masuk");
      onSuccess(data.session);
    } catch (err) {
      handleLoginError(err);
    } finally {
      setLoading(false);
    }
  }

  // Masuk cepat satu klik: kirim kredensial demo langsung ke server.
  // Bila akun ternyata mengaktifkan 2FA, isi form + minta kode (fallback).
  async function handleDemoLogin(account: (typeof DEMO_ACCOUNTS)[number]) {
    if (loading || demoRole) return;
    setError(null);
    setNeedsTotp(false);
    setTotpCode("");
    setDemoRole(account.role);
    try {
      const data = await apiPost<{ ok: boolean; session: AdminSession }>(
        "/api/admin/login",
        { email: account.email, password: account.password }
      );
      toast.success(`Berhasil masuk sebagai ${account.role}`);
      onSuccess(data.session);
    } catch (err) {
      handleLoginError(err);
      // Isi form agar user tinggal melengkapi (mis. kode 2FA) bila perlu.
      setEmail(account.email);
      setPassword(account.password);
    } finally {
      setDemoRole(null);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-background">
      {/* Entrance lembut: fade + naik, tanpa shake */}
      <Reveal slideX={0} slideY={16} duration={0.35} className="w-full max-w-sm">
        <Card className="w-full rounded-2xl p-8 shadow-sm">
        <CardHeader className="items-center px-0 text-center">
          <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950">
            <Lock className="size-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl font-bold">Panel Admin</CardTitle>
          <CardDescription>
            Masuk untuk mengelola lamaran, posisi, dan pengaturan situs.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-email">Email</Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nama@lumina.id"
                autoComplete="email"
                className="h-11"
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-password">Password</Label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password"
                  autoComplete="current-password"
                  className="h-11 pr-10"
                  required
                />
                <button
                  type="button"
                  aria-label={
                    showPassword ? "Sembunyikan password" : "Lihat password"
                  }
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {error ? (
                <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            {needsTotp ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="admin-totp">Kode 2FA (6 digit)</Label>
                <Input
                  id="admin-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  className="h-11 text-center font-mono tracking-[0.35em]"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Akun ini memakai verifikasi dua langkah. Masukkan kode 6 digit dari aplikasi
                  autentikator Anda, lalu tekan Masuk lagi.
                </p>
              </div>
            ) : null}
            <Button
              type="submit"
              className="h-11 w-full active:scale-[0.99]"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Memproses...
                </>
              ) : (
                "Masuk"
              )}
            </Button>
          </form>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              Masuk cepat — akun demo
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <Button
                  key={account.role}
                  type="button"
                  variant="outline"
                  size="sm"
                  title={`${account.email} · ${account.password}`}
                  disabled={loading || demoRole !== null}
                  onClick={() => handleDemoLogin(account)}
                  className="h-9 border-amber-300 bg-white text-xs font-medium text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-800 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/50"
                >
                  {demoRole === account.role ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      Masuk...
                    </>
                  ) : (
                    account.role
                  )}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-amber-700/90 dark:text-amber-400/90">
              Owner <span className="font-medium">admin@lumina.id</span> · HR{" "}
              <span className="font-medium">hr@lumina.id</span> · Pengamat{" "}
              <span className="font-medium">viewer@lumina.id</span> — semua password{" "}
              <span className="font-medium">admin123</span>. Klik salah satu untuk langsung
              masuk.
            </p>
          </div>
        </CardContent>
      </Card>
      </Reveal>
    </div>
  );
}
