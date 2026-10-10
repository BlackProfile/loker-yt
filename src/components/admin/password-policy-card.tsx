"use client";

// NR46 — Kartu "Kebijakan Sandi" (tab Pengaturan).
// GET /api/admin/password-policy -> { policy, description } (semua role —
//     dipakai juga untuk teks "syarat sandi" di dialog ganti sandi).
// PUT /api/admin/password-policy { minLength, requireChangeFirstLogin,
//     rotationDays, blockWeak } — simpan (OWNER saja).
//
// - OWNER: kontrol Input number + Switch + Select rotasi, tombol Simpan.
// - Non-OWNER: description tampil sebagai bullet list baca-saja.
// - Gagal fetch: teks kecil amber + Coba Lagi; tidak crash.

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CollapsibleCard } from "./collapsible-card";
import { apiGet, apiPut, ApiError } from "./api";
import { useAdminSession } from "./admin-context";

type PasswordPolicy = {
  minLength: number;
  requireChangeFirstLogin: boolean;
  rotationDays: number;
  blockWeak: boolean;
};

type PolicyResponse = {
  policy: PasswordPolicy;
  description: string[];
};

const ROTATION_OPTIONS = [0, 30, 60, 90, 180] as const;

function rotationLabel(days: number): string {
  if (days === 0) return "Tidak aktif";
  return `${days} hari`;
}

export function PasswordPolicyCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";

  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  const [description, setDescription] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<PolicyResponse>("/api/admin/password-policy");
      setPolicy(data.policy);
      setDescription(Array.isArray(data.description) ? data.description : []);
      setFetchFailed(false);
    } catch {
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function updatePolicy(patch: Partial<PasswordPolicy>) {
    setPolicy((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSave() {
    if (!policy || saving || !isOwner) return;
    setSaving(true);
    try {
      const minLength = Math.min(72, Math.max(8, Math.round(Number(policy.minLength) || 8)));
      const res = await apiPut<PolicyResponse>("/api/admin/password-policy", {
        minLength,
        requireChangeFirstLogin: policy.requireChangeFirstLogin,
        rotationDays: policy.rotationDays,
        blockWeak: policy.blockWeak,
      });
      setPolicy(res.policy);
      setDescription(Array.isArray(res.description) ? res.description : description);
      toast.success("Kebijakan sandi disimpan");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      id="kebijakan-sandi"
      icon={KeyRound}
      title="Kebijakan Sandi"
      description="Syarat kekuatan sandi, rotasi berkala, dan kewajiban ganti sandi pertama."
    >
      {fetchFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Belum dapat memuat kebijakan sandi.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950"
            onClick={() => void refresh()}
          >
            Coba Lagi
          </Button>
        </div>
      ) : null}

      {loading && !policy ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat kebijakan sandi...
        </div>
      ) : policy ? (
        <>
          {isOwner ? (
            <div className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="policy-min-length">Panjang minimum sandi (8–72)</Label>
                  <Input
                    id="policy-min-length"
                    type="number"
                    min={8}
                    max={72}
                    value={String(policy.minLength)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      updatePolicy({ minLength: Number.isFinite(n) ? n : policy.minLength });
                    }}
                    className="h-11 sm:h-9"
                  />
                  <p className="text-xs text-muted-foreground">
                    Sandi baru lebih pendek dari nilai ini akan ditolak.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Rotasi sandi</Label>
                  <Select
                    value={String(policy.rotationDays)}
                    onValueChange={(v) => updatePolicy({ rotationDays: Number(v) })}
                  >
                    <SelectTrigger className="h-11 w-full sm:h-9" aria-label="Rotasi sandi">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROTATION_OPTIONS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {rotationLabel(d)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Pengingat rotasi berkala untuk akun admin.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Tolak sandi lemah</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Sandi umum dan pola mudah ditebak otomatis ditolak.
                  </p>
                </div>
                <Switch
                  checked={policy.blockWeak}
                  onCheckedChange={(checked) => updatePolicy({ blockWeak: checked })}
                  aria-label="Tolak sandi lemah"
                />
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Wajib ganti sandi saat login pertama</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Akun buatan OWNER diminta mengganti sandi sebelum dapat melanjutkan.
                  </p>
                </div>
                <Switch
                  checked={policy.requireChangeFirstLogin}
                  onCheckedChange={(checked) => updatePolicy({ requireChangeFirstLogin: checked })}
                  aria-label="Wajib ganti sandi saat login pertama"
                />
              </div>

              <div className="flex justify-end">
                <Button
                  className="h-11 active:scale-[0.99] sm:h-10"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Menyimpan...
                    </>
                  ) : (
                    "Simpan Kebijakan"
                  )}
                </Button>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              Hanya OWNER dapat mengubah kebijakan sandi.
            </p>
          )}

          {description.length > 0 ? (
            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Ketentuan aktif saat ini</p>
              <ul className="mt-2 flex flex-col gap-1">
                {description.map((line, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-600"
                    />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </CollapsibleCard>
  );
}
