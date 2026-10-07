"use client";

import { useEffect, useState, type FormEvent } from "react";
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
import {
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  MailPlus,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import type { AdminSession } from "@/lib/types";
import { ApiError, apiGet, apiPost } from "./api";
import { copyText } from "./format";
import { Reveal } from "./motion-primitives";

// NR-41 F8 — respons login 200: sukses ATAU wajib setup 2FA (OWNER tanpa TOTP).
type LoginResponse =
  | { ok: true; session: AdminSession }
  | {
      ok: false;
      mustSetup2FA: true;
      setupToken: string;
      redirect: string;
    };

// Respons bootstrap pemasangan TOTP (tahap 1 & 2).
type TotpSetupResponse = {
  ok: true;
  stage?: string;
  email?: string;
  uri?: string;
  secret?: string;
  qrDataUrl?: string;
};

const DEMO_ACCOUNTS = [
  { role: "Owner", email: "admin@lumina.id", password: "admin123" },
  { role: "HR", email: "hr@lumina.id", password: "admin123" },
  { role: "Pengamat", email: "viewer@lumina.id", password: "admin123" },
] as const;

/** Baca token undangan dari hash URL: "#admin/invite?token=..." (NR-19). */
function readInviteTokenFromHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash;
  if (!hash.startsWith("#admin/invite")) return null;
  const queryIndex = hash.indexOf("?");
  if (queryIndex < 0) return null;
  const token = new URLSearchParams(hash.slice(queryIndex + 1)).get("token");
  const clean = token?.trim() ?? "";
  return clean ? clean.slice(0, 128) : null;
}

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

  // NR-41 F8 — gate pemasangan 2FA wajib utk OWNER tanpa TOTP. Tidak bisa
  // dilewati: form login diganti langkah "Aktifkan 2FA" sampai selesai.
  const [setup2fa, setSetup2fa] = useState<{
    setupToken: string;
    email: string | null;
    qrDataUrl: string | null;
    secret: string | null;
  } | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupVerifying, setSetupVerifying] = useState(false);

  // NR-19 — mode penerimaan undangan admin (hash "#admin/invite?token=...").
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteConfirm, setInviteConfirm] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  // Hash dibaca di sisi klien saat mount (hash tidak dikirim ke server).
  useEffect(() => {
    setInviteToken(readInviteTokenFromHash());
  }, []);

  /** Kembali ke mode login & bersihkan hash undangan menjadi "#admin". */
  function exitInviteMode() {
    history.replaceState(null, "", "#admin");
    setInviteToken(null);
    setInviteName("");
    setInvitePassword("");
    setInviteConfirm("");
    setInviteError(null);
  }

  async function handleInviteAccept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (inviteLoading || !inviteToken) return;
    setInviteError(null);
    if (invitePassword.length < 8) {
      setInviteError("Password minimal 8 karakter.");
      return;
    }
    if (invitePassword !== inviteConfirm) {
      setInviteError("Konfirmasi password tidak sama dengan password baru.");
      return;
    }
    setInviteLoading(true);
    try {
      await apiPost<{ ok: boolean }>("/api/public/admin-invite/accept", {
        token: inviteToken,
        password: invitePassword,
        ...(inviteName.trim() ? { name: inviteName.trim() } : {}),
      });
      toast.success("Akun aktif. Silakan masuk.");
      exitInviteMode();
    } catch (err) {
      if (err instanceof ApiError) {
        setInviteError(
          err.status === 404
            ? "Tautan undangan tidak valid atau sudah kedaluwarsa."
            : err.message
        );
      } else if (err instanceof Error) {
        setInviteError(err.message);
      } else {
        setInviteError("Terjadi kesalahan. Coba lagi.");
      }
    } finally {
      setInviteLoading(false);
    }
  }

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

  // NR-41 F8 — mulai alur setup 2FA: kirim setupToken, tampilkan QR + secret.
  async function startTwoFactorSetup(setupToken: string) {
    setSetupError(null);
    setSetupLoading(true);
    try {
      const res = await apiPost<TotpSetupResponse>(
        "/api/admin/security/totp/pending",
        { setupToken }
      );
      setSetup2fa({
        setupToken,
        email: res.email ?? null,
        qrDataUrl: res.qrDataUrl ?? null,
        secret: res.secret ?? null,
      });
      setSetupCode("");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Gagal menyiapkan 2FA. Coba lagi."
      );
    } finally {
      setSetupLoading(false);
    }
  }

  // Tahap 2 — verifikasi kode 6 digit; sukses = sesi penuh (cookie dipasang
  // server) → lanjutkan alur post-login yang sama (ambil sesi → onSuccess).
  async function handleVerifyTwoFactor(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!setup2fa || setupVerifying) return;
    if (!/^\d{6}$/.test(setupCode)) {
      setSetupError("Masukkan 6 digit kode dari aplikasi autentikator.");
      return;
    }
    setSetupError(null);
    setSetupVerifying(true);
    try {
      await apiPost<{ ok: boolean }>("/api/admin/security/totp/pending", {
        setupToken: setup2fa.setupToken,
        code: setupCode,
      });
      const data = await apiGet<{
        authenticated: boolean;
        session: AdminSession | null;
      }>("/api/admin/session");
      if (data.authenticated && data.session) {
        toast.success("2FA aktif — Berhasil masuk");
        setSetup2fa(null);
        onSuccess(data.session);
      } else {
        setSetupError(
          "2FA aktif, tetapi sesi gagal dimuat. Muat ulang halaman lalu login lagi."
        );
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 400) {
          // Token setup kedaluwarsa / tidak valid → wajib login ulang.
          setSetupError(
            `${err.message} Tekan "Login ulang" untuk mulai dari awal.`
          );
        } else {
          setSetupError(err.message);
        }
      } else {
        setSetupError("Verifikasi gagal. Coba lagi.");
      }
    } finally {
      setSetupVerifying(false);
    }
  }

  /** Kembali ke form login (token setup hilang — server tetap menggate). */
  function exitTwoFactorSetup() {
    setSetup2fa(null);
    setSetupCode("");
    setSetupError(null);
    setNeedsTotp(false);
    setTotpCode("");
    setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const data = await apiPost<LoginResponse>(
        "/api/admin/login",
        {
          email: email.trim(),
          password,
          ...(needsTotp || totpCode ? { totpCode } : {}),
        }
      );
      // NR-41 F8 — OWNER tanpa TOTP: jangan lanjut, tampilkan langkah setup 2FA.
      if ("mustSetup2FA" in data && data.mustSetup2FA) {
        setLoading(false);
        await startTwoFactorSetup(data.setupToken);
        return;
      }
      if (data.ok && data.session) {
        toast.success("Berhasil masuk");
        onSuccess(data.session);
      }
    } catch (err) {
      handleLoginError(err);
    } finally {
      setLoading(false);
    }
  }

  // Masuk cepat satu klik: kirim kredensial demo langsung ke server.
  // Bila akun ternyata mengaktifkan 2FA, isi form + minta kode (fallback);
  // OWNER tanpa TOTP diarahkan ke langkah wajib "Aktifkan 2FA" (NR-41 F8).
  async function handleDemoLogin(account: (typeof DEMO_ACCOUNTS)[number]) {
    if (loading || demoRole) return;
    setError(null);
    setNeedsTotp(false);
    setTotpCode("");
    setDemoRole(account.role);
    try {
      const data = await apiPost<LoginResponse>(
        "/api/admin/login",
        { email: account.email, password: account.password }
      );
      if ("mustSetup2FA" in data && data.mustSetup2FA) {
        setDemoRole(null);
        setEmail(account.email);
        setPassword(account.password);
        await startTwoFactorSetup(data.setupToken);
        return;
      }
      if (data.ok && data.session) {
        toast.success(`Berhasil masuk sebagai ${account.role}`);
        onSuccess(data.session);
      }
    } catch (err) {
      handleLoginError(err);
      // Isi form agar user tinggal melengkapi (mis. kode 2FA) bila perlu.
      setEmail(account.email);
      setPassword(account.password);
    } finally {
      setDemoRole(null);
    }
  }

  // ---------------- Mode penerimaan undangan (NR-19) ----------------
  // Email TIDAK dikirim dalam token — akun ditemukan lewat token undangan.
  if (inviteToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-background">
        <Reveal slideX={0} slideY={16} duration={0.35} className="w-full max-w-sm">
          <Card className="w-full rounded-2xl p-8 shadow-sm">
            <CardHeader className="items-center px-0 text-center">
              <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                <MailPlus className="size-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              </div>
              <CardTitle className="text-xl font-bold">Selesaikan Pendaftaran</CardTitle>
              <CardDescription>
                Undangan admin Lumina Studio terdeteksi. Atur password untuk mengaktifkan akun Anda
                — tautan berlaku 48 jam.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <form onSubmit={handleInviteAccept} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite-name">Nama (opsional)</Label>
                  <Input
                    id="invite-name"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="mis. Rani Putri"
                    autoComplete="name"
                    maxLength={60}
                    className="h-11"
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite-password">Password Baru</Label>
                  <div className="relative">
                    <Input
                      id="invite-password"
                      type={showPassword ? "text" : "password"}
                      value={invitePassword}
                      onChange={(e) => setInvitePassword(e.target.value)}
                      placeholder="Minimal 8 karakter"
                      autoComplete="new-password"
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
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="invite-confirm">Konfirmasi Password</Label>
                  <Input
                    id="invite-confirm"
                    type={showPassword ? "text" : "password"}
                    value={inviteConfirm}
                    onChange={(e) => setInviteConfirm(e.target.value)}
                    placeholder="Ulangi password baru"
                    autoComplete="new-password"
                    className="h-11"
                    required
                  />
                  {inviteError ? (
                    <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                      {inviteError}
                    </p>
                  ) : null}
                </div>
                <Button
                  type="submit"
                  className="h-11 w-full active:scale-[0.99]"
                  disabled={inviteLoading}
                >
                  {inviteLoading ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Memproses...
                    </>
                  ) : (
                    "Aktifkan Akun"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 text-muted-foreground"
                  onClick={exitInviteMode}
                  disabled={inviteLoading}
                >
                  Kembali ke halaman masuk
                </Button>
              </form>
            </CardContent>
          </Card>
        </Reveal>
      </div>
    );
  }

  // ------------- NR-41 F8 — langkah wajib "Aktifkan 2FA" (OWNER) -------------
  // Tidak bisa dilewati: tidak ada tombol lewati/kembali ke panel. Token setup
  // hanya berlaku 10 menit; bila kedaluwarsa pengguna wajib login ulang.
  if (setup2fa) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4 dark:bg-background">
        <Reveal slideX={0} slideY={16} duration={0.35} className="w-full max-w-sm">
          <Card className="w-full rounded-2xl p-8 shadow-sm">
            <CardHeader className="items-center px-0 text-center">
              <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
                <ShieldCheck className="size-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
              <CardTitle className="text-xl font-bold">Aktifkan 2FA</CardTitle>
              <CardDescription>
                Akun OWNER wajib memakai verifikasi dua langkah. Pindai QR di
                bawah dengan aplikasi autentikator (Google Authenticator, Authy,
                dsb.) untuk menyelesaikan login.
                {setup2fa.email ? (
                  <span className="mt-1 block font-medium text-foreground">
                    {setup2fa.email}
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <form onSubmit={handleVerifyTwoFactor} className="flex flex-col gap-4">
                {setupLoading ? (
                  <div className="flex flex-col items-center gap-2 py-4" aria-live="polite">
                    <Loader2 className="size-6 animate-spin text-rose-600 dark:text-rose-400" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">Menyiapkan QR 2FA...</p>
                  </div>
                ) : (
                  <>
                    {setup2fa.qrDataUrl ? (
                      <div className="flex justify-center">
                        <img
                          src={setup2fa.qrDataUrl}
                          alt="QR 2FA"
                          width={180}
                          height={180}
                          className="rounded-xl border bg-white p-2"
                        />
                      </div>
                    ) : null}
                    {setup2fa.secret ? (
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="totp-secret">Kode rahasia (manual)</Label>
                        <div className="flex items-center gap-2">
                          <code
                            id="totp-secret"
                            className="min-w-0 flex-1 truncate rounded-lg border bg-muted px-2.5 py-2 font-mono text-xs"
                          >
                            {setup2fa.secret}
                          </code>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="size-11 shrink-0 sm:size-9"
                            onClick={() =>
                              void copyText(setup2fa.secret ?? "").then((ok) => {
                                if (ok) toast.success("Kode rahasia disalin");
                                else toast.error("Gagal menyalin kode.");
                              })
                            }
                            aria-label="Salin kode rahasia 2FA"
                          >
                            <Copy className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="totp-setup-code">Kode 6 digit</Label>
                      <Input
                        id="totp-setup-code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={setupCode}
                        onChange={(e) => {
                          setSetupCode(e.target.value.replace(/\D/g, ""));
                          if (setupError) setSetupError(null);
                        }}
                        placeholder="123456"
                        className="h-11 text-center font-mono tracking-[0.35em]"
                        autoFocus
                        required
                      />
                      {setupError ? (
                        <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">
                          {setupError}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="submit"
                      className="h-11 w-full active:scale-[0.99]"
                      disabled={setupVerifying || setupCode.length !== 6}
                    >
                      {setupVerifying ? (
                        <>
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          Memverifikasi...
                        </>
                      ) : (
                        "Verifikasi & Masuk"
                      )}
                    </Button>
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 text-muted-foreground"
                  onClick={exitTwoFactorSetup}
                  disabled={setupLoading || setupVerifying}
                >
                  Login ulang
                </Button>
              </form>
            </CardContent>
          </Card>
        </Reveal>
      </div>
    );
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
