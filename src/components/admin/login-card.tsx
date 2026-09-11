"use client";

import { useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { apiPost } from "./api";

export function LoginCard({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      await apiPost<{ ok: boolean }>("/api/admin/login", { password });
      toast.success("Berhasil masuk");
      onSuccess();
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Password salah. Coba lagi.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <Card className="w-full max-w-sm rounded-2xl p-8 shadow-sm">
        <CardHeader className="items-center px-0 text-center">
          <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-rose-100">
            <Lock className="size-6 text-rose-600" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl font-bold">Panel Admin</CardTitle>
          <CardDescription>
            Masuk untuk mengelola lamaran, posisi, dan pengaturan situs.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="admin-password">Password</Label>
              <div className="relative">
                <Input
                  id="admin-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Masukkan password admin"
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
                <p className="text-sm text-rose-600" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
            <Button type="submit" className="h-11 w-full" disabled={loading}>
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
          <Alert className="mt-4 rounded-lg border-amber-200 bg-amber-50 text-amber-800">
            <AlertDescription className="text-xs">
              Password default: <span className="font-semibold">admin123</span>{" "}
              — segera ganti di tab Pengaturan.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
