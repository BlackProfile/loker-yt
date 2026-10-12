"use client";

// NR49-A — Kartu "Pusat Kendali AI" (tab Pengaturan, kelompok Pusat Kendali AI).
// GET /api/admin/ai-control  -> { control: AiControlView } (semua role).
// PUT /api/admin/ai-control  -> simpan (HANYA OWNER) — hanya field yang berubah
//                               yang dikirim + manualPriority.
//
// Karakter penting:
// - Draft lokal (Switch aktif/nonaktif + teks kuota) dibandingkan dengan data server;
//   tombol simpan nonaktif bila draft == server.
// - "Kembalikan Bawaan" memakai konfirmasi inline (teks + Ya/Batal), BUKAN confirm().
// - non-OWNER: semua kontrol disabled + baris keterangan.
// - Gagal fetch: baris amber + tombol "Coba Lagi" (pola access-health-card).

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCircuit, Leaf, Loader2, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { AI_FEATURES, type AiControlView } from "@/lib/ai-features";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CollapsibleCard } from "./collapsible-card";
import { ApiError, apiGet, apiPut } from "./api";
import { formatDateTime } from "./format";
import { useAdminSession } from "./admin-context";

type DraftFeature = { enabled: boolean; quotaText: string };
type DraftState = { features: Record<string, DraftFeature>; manualPriority: boolean };

/** Kuota efektif dari teks input: "" -> null (tanpa batas); input sudah disaring digit. */
function quotaNum(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? Math.floor(num) : null;
}

function draftFromControl(control: AiControlView): DraftState {
  const features: Record<string, DraftFeature> = {};
  for (const f of control.features) {
    features[f.key] = {
      enabled: f.enabled,
      quotaText: f.quotaPerDay === null ? "" : String(f.quotaPerDay),
    };
  }
  return { features, manualPriority: control.manualPriority };
}

export function AiControlCard() {
  const { role } = useAdminSession();
  const isOwner = role === "OWNER";

  const [control, setControl] = useState<AiControlView | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const applyControl = useCallback((next: AiControlView) => {
    setControl(next);
    setDraft(draftFromControl(next));
  }, []);

  const refresh = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await apiGet<{ control: AiControlView }>("/api/admin/ai-control");
        applyControl(data.control);
        setFetchFailed(false);
      } catch {
        setFetchFailed(true);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [applyControl],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Draft == server? -> tombol simpan nonaktif.
  const dirty = useMemo(() => {
    if (!control || !draft) return false;
    if (draft.manualPriority !== control.manualPriority) return true;
    for (const f of control.features) {
      const d = draft.features[f.key];
      if (!d) continue;
      if (d.enabled !== f.enabled) return true;
      if (quotaNum(d.quotaText) !== f.quotaPerDay) return true;
    }
    return false;
  }, [control, draft]);

  const activeCount = control ? control.features.filter((f) => f.enabled).length : 0;
  const someDisabled = control ? control.features.some((f) => !f.enabled) : false;

  function setFeatureEnabled(key: string, enabled: boolean) {
    setDraft((prev) =>
      prev ? { ...prev, features: { ...prev.features, [key]: { ...prev.features[key], enabled } } } : prev,
    );
  }

  function setQuotaText(key: string, quotaText: string) {
    setDraft((prev) =>
      prev ? { ...prev, features: { ...prev.features, [key]: { ...prev.features[key], quotaText } } } : prev,
    );
  }

  async function handleSave() {
    if (!control || !draft || saving) return;
    const features: Record<string, { enabled?: boolean; quotaPerDay?: number | null }> = {};
    for (const f of control.features) {
      const d = draft.features[f.key];
      if (!d) continue;
      const patch: { enabled?: boolean; quotaPerDay?: number | null } = {};
      if (d.enabled !== f.enabled) patch.enabled = d.enabled;
      const quota = quotaNum(d.quotaText);
      if (quota !== f.quotaPerDay) patch.quotaPerDay = quota;
      if (patch.enabled !== undefined || patch.quotaPerDay !== undefined) features[f.key] = patch;
    }
    const manualChanged = draft.manualPriority !== control.manualPriority;
    if (Object.keys(features).length === 0 && !manualChanged) return;

    setSaving(true);
    try {
      // Respons PUT berisi config mentah (writeAiControl) — sesuai kontrak, UI
      // menyegarkan tampilan lewat GET agar label/usedToday selalu akurat.
      await apiPut("/api/admin/ai-control", {
        ...(Object.keys(features).length > 0 ? { features } : {}),
        ...(manualChanged ? { manualPriority: draft.manualPriority } : {}),
      });
      await refresh(true);
      toast.success("Pengaturan AI disimpan");
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message ? err.message : "Gagal menyimpan pengaturan AI.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleResetDefaults() {
    if (!isOwner || resetting) return;
    setResetting(true);
    try {
      const features: Record<string, { enabled: boolean; quotaPerDay: number | null }> = {};
      for (const def of AI_FEATURES) {
        features[def.key] = { enabled: true, quotaPerDay: def.defaultQuota };
      }
      // Respons PUT berisi config mentah — segarkan tampilan lewat GET.
      await apiPut("/api/admin/ai-control", { features });
      await refresh(true);
      setConfirmReset(false);
      toast.success("Pengaturan AI dikembalikan ke bawaan");
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.message ? err.message : "Gagal mengembalikan pengaturan AI.",
      );
    } finally {
      setResetting(false);
    }
  }

  return (
    <CollapsibleCard
      id="pusat-kendali-ai"
      icon={BrainCircuit}
      title="Pusat Kendali AI"
      description="Nyalakan/matikan tiap fitur AI, atur kuota harian, dan atur prioritas aksi admin."
      defaultOpen
      status={
        control
          ? { label: `${activeCount} fitur aktif`, tone: someDisabled ? "warn" : "ok" }
          : undefined
      }
    >
      {fetchFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Belum dapat memuat pengaturan AI.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950"
            onClick={() => void refresh(true)}
          >
            Coba Lagi
          </Button>
        </div>
      ) : null}

      {loading && !control ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : control && draft ? (
        <>
          {/* --- Baris atas: Mode Hemat + Prioritas Aksi Admin --- */}
          {control.saveMode?.active ? (
            <div className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
              <div className="flex items-center gap-2">
                <Leaf className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                  Mode Hemat aktif
                </span>
              </div>
              {control.saveMode.reason ? (
                <p className="text-xs text-amber-700/90 dark:text-amber-300/90">
                  {control.saveMode.reason}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Prioritas Aksi Admin</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Saat aktif, tugas AI latar belakang (skrining otomatis, brief pagi) ditunda bila ada
                aksi admin yang sedang mengantre.
              </p>
            </div>
            <Switch
              checked={draft.manualPriority}
              disabled={!isOwner}
              onCheckedChange={(v) => setDraft((prev) => (prev ? { ...prev, manualPriority: v } : prev))}
              aria-label="Prioritas Aksi Admin"
              className="mt-1 shrink-0"
            />
          </div>

          {/* --- Daftar fitur AI --- */}
          <ul
            className="nice-scrollbar flex max-h-96 flex-col gap-2 overflow-y-auto pr-1"
            aria-label="Daftar fitur AI"
          >
            {control.features.map((f) => {
              const d = draft.features[f.key];
              if (!d) return null;
              return (
                <li
                  key={f.key}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <Switch
                    checked={d.enabled}
                    disabled={!isOwner}
                    onCheckedChange={(v) => setFeatureEnabled(f.key, v)}
                    aria-label={f.label}
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium">{f.label}</span>
                      {f.priority === "background" ? (
                        <span className="rounded-full border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium leading-3 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                          Latar belakang
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{f.description}</p>
                    <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground/80">
                      Terpakai hari ini: {f.usedToday}
                    </p>
                  </div>
                  <div className="w-full shrink-0 sm:w-44">
                    <Label
                      htmlFor={`ai-quota-${f.key}`}
                      className="text-[11px] font-normal text-muted-foreground"
                    >
                      Kuota harian
                    </Label>
                    <Input
                      id={`ai-quota-${f.key}`}
                      value={d.quotaText}
                      placeholder="Tanpa batas"
                      inputMode="numeric"
                      autoComplete="off"
                      disabled={!isOwner}
                      className="mt-1 h-9"
                      onChange={(e) =>
                        setQuotaText(f.key, e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          {/* --- Aksi --- */}
          {isOwner ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Button
                  className="h-11 w-full sm:w-auto"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-4" aria-hidden="true" />
                  )}
                  Simpan Pengaturan AI
                </Button>
                {confirmReset ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Kembalikan semua fitur ke pengaturan bawaan?
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      onClick={() => void handleResetDefaults()}
                      disabled={resetting}
                    >
                      {resetting ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : null}
                      Ya
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9"
                      onClick={() => setConfirmReset(false)}
                      disabled={resetting}
                    >
                      Batal
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="h-11 sm:h-10"
                    onClick={() => setConfirmReset(true)}
                    disabled={saving || resetting}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Kembalikan Bawaan
                  </Button>
                )}
              </div>
              {control.updatedAt ? (
                <p className="text-xs text-muted-foreground">
                  Terakhir diubah: {formatDateTime(control.updatedAt)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              Hanya OWNER dapat mengubah pengaturan AI.
            </p>
          )}
        </>
      ) : null}
    </CollapsibleCard>
  );
}
