"use client";

// NR46 — Kartu "Persetujuan Ganda (Empat Mata)" (dashboard, OWNER saja).
// GET  /api/admin/approvals -> { enabled, requests: ApprovalRequestView[] }.
// POST /api/admin/approvals { id, action: approve|reject|cancel, note? }.
//
// Aturan empat mata di sisi server: permintaan PENDING milik sendiri tidak
// dapat disetujui/ditolak oleh pengajunya sendiri (hanya bisa dibatalkan).
//
// Karakter penting:
// - Guard role DI DALAM komponen: return null bila role sesi bukan OWNER.
// - Polling 45 detik hanya saat tab visible; skip document.hidden; interval
//   dibersihkan saat unmount.
// - Toleran gagal: teks kecil amber + Coba Lagi; data lama dipertahankan.

import { useCallback, useEffect, useState } from "react";
import { Loader2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import type { ApprovalRequestView } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleCard } from "./collapsible-card";
import { apiGet, apiPost, ApiError } from "./api";
import { formatRelative } from "./format";
import { useAdminSession } from "./admin-context";

const POLL_MS = 45_000;

const STATUS_BADGE: Record<
  ApprovalRequestView["status"],
  { label: string; className: string }
> = {
  PENDING: {
    label: "Menunggu",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
  EXECUTED: {
    label: "Dieksekusi",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  },
  REJECTED: {
    label: "Ditolak",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  },
  CANCELLED: {
    label: "Dibatalkan",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  },
  FAILED: {
    label: "Gagal",
    className:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  },
  APPROVED: {
    label: "Disetujui",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

function actionErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

function RequestRow({
  req,
  busy,
  onAct,
}: {
  req: ApprovalRequestView;
  busy: boolean;
  onAct: (req: ApprovalRequestView, action: "approve" | "reject" | "cancel") => void;
}) {
  const statusMeta = STATUS_BADGE[req.status] ?? STATUS_BADGE.PENDING;
  const isPending = req.status === "PENDING";
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={`shrink-0 px-1.5 py-0 text-[10px] ${statusMeta.className}`}>
          {statusMeta.label}
        </Badge>
        <p className="min-w-0 flex-1 text-sm font-medium">{req.summary}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Diajukan oleh {req.requestedByName} · {formatRelative(req.createdAt)}
        {req.resolvedByName ? ` · diputuskan oleh ${req.resolvedByName}` : ""}
      </p>
      {req.resolvedNote ? (
        <p className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
          Catatan: {req.resolvedNote}
        </p>
      ) : null}
      {req.error ? (
        <p className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
          {req.error}
        </p>
      ) : null}
      {isPending && !req.isMine ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-rose-300 bg-transparent text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
            disabled={busy}
            onClick={() => onAct(req, "approve")}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <UserCheck className="size-3.5" aria-hidden="true" />
            )}
            Setujui &amp; Jalankan
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={busy}
            onClick={() => onAct(req, "reject")}
          >
            Tolak
          </Button>
        </div>
      ) : null}
      {isPending && req.isMine ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Menunggu OWNER lain — Anda tidak dapat menyetujui permintaan sendiri.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            disabled={busy}
            onClick={() => onAct(req, "cancel")}
          >
            Batalkan
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ApprovalsCard() {
  const { role } = useAdminSession();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [requests, setRequests] = useState<ApprovalRequestView[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<{ enabled: boolean; requests: ApprovalRequestView[] }>(
        "/api/admin/approvals",
      );
      setEnabled(Boolean(data.enabled));
      setRequests(Array.isArray(data.requests) ? data.requests : []);
      setFetchFailed(false);
    } catch {
      setFetchFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Polling 45 dtk hanya saat tab terlihat; skip document.hidden.
  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.hidden) return;
      void refresh(true);
    };
    const interval = window.setInterval(tick, POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) void refresh(true);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  async function handleAct(
    req: ApprovalRequestView,
    action: "approve" | "reject" | "cancel",
  ) {
    if (busyId) return;
    setBusyId(req.id);
    try {
      const res = await apiPost<{ ok?: boolean; message?: string }>("/api/admin/approvals", {
        id: req.id,
        action,
      });
      toast.success(res.message ?? "Permintaan diproses.");
      void refresh(true);
    } catch (err) {
      // 409/403/400: tampilkan pesan dari body server.
      toast.error(actionErrorMessage(err, "Gagal memproses persetujuan."));
    } finally {
      setBusyId(null);
    }
  }

  // Guard OWNER — dirender hanya untuk pemilik studio.
  if (role !== "OWNER") return null;

  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  return (
    <CollapsibleCard
      id="persetujuan-ganda"
      icon={UserCheck}
      title="Persetujuan Ganda (Empat Mata)"
      description="Aksi berisiko tinggi (hapus data, hapus akun) menunggu persetujuan OWNER lain."
      defaultOpen
      actions={
        pendingCount > 0 ? (
          <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-100 text-amber-700 tabular-nums dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
            {pendingCount} menunggu
          </Badge>
        ) : null
      }
    >
      {fetchFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Belum dapat memuat daftar persetujuan.</span>
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

      {loading && enabled === null ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : enabled === false ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Persetujuan ganda nonaktif</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Fitur dimatikan lewat Setting <span className="font-mono text-xs">dual_control</span> pada
            tab Pengaturan. Aktifkan untuk mewajibkan persetujuan OWNER lain pada aksi berisiko.
          </p>
        </div>
      ) : requests.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Tidak ada permintaan persetujuan. Permintaan dari aksi hapus data/akun akan muncul di sini.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((req) => (
            <RequestRow
              key={req.id}
              req={req}
              busy={busyId === req.id}
              onAct={(r, action) => void handleAct(r, action)}
            />
          ))}
        </ul>
      )}
    </CollapsibleCard>
  );
}
