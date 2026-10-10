"use client";

// NR46 — Kartu "Matriks Izin" (tab Pengaturan).
// GET /api/admin/permission-matrix -> PermissionMatrixView (transparansi, semua role).
// PUT /api/admin/permission-matrix { overrides } — simpan penyempitan (OWNER saja);
//     overrides mengganti SELURUH peta penyesuaian (reset = kirim {}).
//
// Aturan:
// - Kolom OWNER selalu aktif & terkunci ON (server juga tidak pernah memperluas).
// - Toggle HR/VIEWER mengubah draft lokal; tombol Simpan aktif hanya bila draft
//   berbeda dari nilai server; HANYA aksi yang berubah yang dikirim.
// - Non-OWNER: seluruh kontrol disabled + keterangan (GET tetap boleh).

import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid3x3, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  ROLES,
  ROLE_LABELS,
  type PermissionActionDef,
  type PermissionActionKey,
  type PermissionMatrixView,
  type Role,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CollapsibleCard } from "./collapsible-card";
import { apiGet, apiPut, ApiError } from "./api";
import { formatDateTime } from "./format";
import { useAdminSession } from "./admin-context";

function sameRoles(a: Role[], b: Role[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r) => b.includes(r));
}

function MatrixRow({
  action,
  draft,
  canEdit,
  onToggle,
}: {
  action: PermissionActionDef;
  draft: Partial<Record<PermissionActionKey, Role[]>>;
  canEdit: boolean;
  onToggle: (key: PermissionActionKey, role: Role, checked: boolean) => void;
}) {
  const current = draft[action.key] ?? [];
  return (
    <TableRow>
      <TableCell className="max-w-[22rem] align-top">
        <p className="text-sm font-medium">{action.label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{action.description}</p>
      </TableCell>
      {ROLES.map((r) => {
        if (r === "OWNER") {
          return (
            <TableCell key={r} className="text-center align-middle">
              <Switch
                checked
                disabled
                title="OWNER selalu memiliki akses"
                aria-label={`${action.label} — OWNER selalu memiliki akses`}
              />
            </TableCell>
          );
        }
        return (
          <TableCell key={r} className="text-center align-middle">
            <Switch
              checked={current.includes(r)}
              disabled={!canEdit}
              onCheckedChange={(checked) => onToggle(action.key, r, checked)}
              aria-label={`${action.label} untuk ${ROLE_LABELS[r]}`}
            />
          </TableCell>
        );
      })}
    </TableRow>
  );
}

export function PermissionMatrixCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";

  const [view, setView] = useState<PermissionMatrixView | null>(null);
  const [draft, setDraft] = useState<Partial<Record<PermissionActionKey, Role[]>>>({});
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<PermissionMatrixView>("/api/admin/permission-matrix");
      setView(data);
      const next: Partial<Record<PermissionActionKey, Role[]>> = {};
      for (const a of data.actions) next[a.key] = [...a.roles];
      setDraft(next);
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

  const changedCount = useMemo(() => {
    if (!view) return 0;
    return view.actions.filter((a) => !sameRoles(draft[a.key] ?? [], a.roles)).length;
  }, [view, draft]);

  function toggle(key: PermissionActionKey, r: Role, checked: boolean) {
    setDraft((prev) => {
      const cur = prev[key] ?? [];
      const next = checked
        ? ROLES.filter((x) => x === "OWNER" || cur.includes(x) || x === r)
        : cur.filter((x) => x !== r);
      return { ...prev, [key]: next };
    });
  }

  async function handleSave() {
    if (!view || saving || !isOwner || changedCount === 0) return;
    setSaving(true);
    try {
      const overrides: Partial<Record<PermissionActionKey, Role[]>> = {};
      for (const a of view.actions) {
        const next = draft[a.key] ?? [];
        if (!sameRoles(next, a.roles)) overrides[a.key] = next;
      }
      await apiPut<{ ok?: boolean }>("/api/admin/permission-matrix", { overrides });
      toast.success("Matriks izin disimpan");
      setConfirmReset(false);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!isOwner || resetting) return;
    setResetting(true);
    try {
      // Kontrak PUT: overrides mengganti SELURUH peta penyesuaian — {} = reset bawaan.
      await apiPut<{ ok?: boolean }>("/api/admin/permission-matrix", { overrides: {} });
      toast.success("Matriks izin dikembalikan ke bawaan.");
      setConfirmReset(false);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError) toast.error(err.message);
      else reportError(err);
    } finally {
      setResetting(false);
    }
  }

  const hasOverrides = view?.hasOverrides === true;

  return (
    <CollapsibleCard
      id="matriks-izin"
      icon={Grid3x3}
      title="Matriks Izin"
      description="Peta aksi per role: Owner, HR, dan Pengamat. Matriks hanya mempersempit akses, tidak memperluas."
      actions={
        hasOverrides ? (
          <Badge
            variant="outline"
            className="shrink-0 border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
          >
            Ada penyesuaian
          </Badge>
        ) : null
      }
    >
      {fetchFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Belum dapat memuat matriks izin.</span>
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

      {!isOwner ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Hanya OWNER dapat mengubah matriks.
        </p>
      ) : null}

      {loading && !view ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat matriks izin...
        </div>
      ) : view ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[45%]">Aksi</TableHead>
                  <TableHead className="text-center">Pemilik</TableHead>
                  <TableHead className="text-center">HR</TableHead>
                  <TableHead className="text-center">Pengamat</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.actions.map((a) => (
                  <MatrixRow
                    key={a.key}
                    action={a}
                    draft={draft}
                    canEdit={isOwner}
                    onToggle={toggle}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {hasOverrides && view.updatedAt
                ? `Penyesuaian terakhir: ${formatDateTime(view.updatedAt)}`
                : "Masih memakai konfigurasi bawaan."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {hasOverrides ? (
                confirmReset ? (
                  <span className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-200">
                    Kembalikan semua ke bawaan?
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={resetting || saving}
                      onClick={() => void handleReset()}
                    >
                      {resetting ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="size-3.5" aria-hidden="true" />
                      )}
                      Ya
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9"
                      disabled={resetting || saving}
                      onClick={() => setConfirmReset(false)}
                    >
                      Batal
                    </Button>
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    className="h-11 sm:h-10"
                    disabled={resetting || saving || !isOwner}
                    onClick={() => setConfirmReset(true)}
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Kembalikan Bawaan
                  </Button>
                )
              ) : null}
              <Button
                className="h-11 active:scale-[0.99] sm:h-10"
                disabled={!isOwner || saving || changedCount === 0}
                onClick={() => void handleSave()}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Menyimpan...
                  </>
                ) : (
                  "Simpan Matriks"
                )}
              </Button>
            </div>
          </div>
          {changedCount > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {changedCount} aksi diubah — belum tersimpan.
            </p>
          ) : null}
        </>
      ) : null}
    </CollapsibleCard>
  );
}
