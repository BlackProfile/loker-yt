"use client";

// NR46 — Kartu "Kesehatan Akses" (dashboard, OWNER saja).
// GET  /api/admin/access-health -> AccessHealthReport (level + findings + stats).
// POST /api/admin/access-health { action: "revokeUserSessions", userId } — aksi
//      cepat "Cabut Sesi" pada temuan sesi menggantung per pengguna.
//
// Karakter penting (pola server-health-card.tsx):
// - Guard role DI DALAM komponen: return null bila role sesi bukan OWNER.
// - Polling 60 detik + saat window focus; SKIP saat document.hidden; interval
//   dibersihkan saat unmount.
// - Toleran gagal: teks kecil amber "Belum dapat memuat kesehatan akses" +
//   tombol Coba Lagi; data lama dipertahankan; tidak crash.

import { useCallback, useEffect, useState } from "react";
import { Loader2, ShieldCheck, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import type { AccessFinding, AccessFindingSeverity, AccessHealthReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleCard } from "./collapsible-card";
import { apiGet, apiPost, ApiError } from "./api";
import { formatDateTime } from "./format";
import { useAdminSession } from "./admin-context";

const POLL_MS = 60_000;

const LEVEL_BADGE: Record<AccessHealthReport["level"], { label: string; className: string }> = {
  OK: {
    label: "Sehat",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  },
  WARN: {
    label: "Perlu Perhatian",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
  CRIT: {
    label: "Kritis",
    className:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  },
};

const SEVERITY_BADGE: Record<AccessFindingSeverity, { label: string; className: string }> = {
  CRIT: {
    label: "Kritis",
    className:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  },
  WARN: {
    label: "Perhatian",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
  INFO: {
    label: "Info",
    className:
      "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400",
  },
};

function actionErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  return fallback;
}

// Sel ringkasan statistik (gaya MetricCell server-health-card).
function StatCell({
  label,
  value,
  hint,
  danger = false,
}: {
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 truncate text-base font-bold tabular-nums ${
          danger ? "text-rose-600 dark:text-rose-400" : ""
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

// Satu baris temuan akses.
function FindingRow({
  finding,
  revoking,
  onRevoke,
}: {
  finding: AccessFinding;
  revoking: boolean;
  onRevoke: (finding: AccessFinding) => void;
}) {
  const severity = SEVERITY_BADGE[finding.severity] ?? SEVERITY_BADGE.INFO;
  const extra = Math.max(0, finding.targetCount - finding.targets.length);
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={`shrink-0 px-1.5 py-0 text-[10px] ${severity.className}`}>
          {severity.label}
        </Badge>
        <p className="min-w-0 flex-1 text-sm font-medium">{finding.title}</p>
        {finding.action === "revokeSessions" && finding.actionUserId ? (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 border-rose-300 bg-transparent text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950"
            disabled={revoking}
            onClick={() => onRevoke(finding)}
          >
            {revoking ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Undo2 className="size-3.5" aria-hidden="true" />
            )}
            Cabut Sesi
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{finding.detail}</p>
      {finding.targets.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-md bg-muted/60 p-2.5">
          {finding.targets.map((t) => (
            <li key={t.id} className="min-w-0 text-xs">
              <span className="font-medium">{t.label}</span>
              {t.sublabel ? (
                <span className="text-muted-foreground"> — {t.sublabel}</span>
              ) : null}
            </li>
          ))}
          {extra > 0 ? (
            <li className="text-xs text-muted-foreground">+{extra} lainnya</li>
          ) : null}
        </ul>
      ) : extra > 0 ? (
        <p className="text-xs text-muted-foreground">+{extra} lainnya</p>
      ) : null}
    </li>
  );
}

export function AccessHealthCard() {
  const { role } = useAdminSession();
  const [report, setReport] = useState<AccessHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<AccessHealthReport>("/api/admin/access-health");
      setReport(data);
      setFetchFailed(false);
    } catch {
      // Gagal muat: pertahankan data lama, tampilkan catatan kecil.
      setFetchFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Polling 60 dtk + saat fokus jendela; PAUSE total saat document.hidden.
  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.hidden) return;
      void refresh(true);
    };
    const interval = window.setInterval(tick, POLL_MS);
    const onFocus = () => {
      if (document.hidden) return;
      void refresh(true);
    };
    const onVisibility = () => {
      if (!document.hidden) void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  async function handleRevoke(finding: AccessFinding) {
    if (!finding.actionUserId || revokingId) return;
    setRevokingId(finding.actionUserId);
    try {
      const res = await apiPost<{ ok?: boolean; message?: string }>("/api/admin/access-health", {
        action: "revokeUserSessions",
        userId: finding.actionUserId,
      });
      toast.success(res.message ?? "Sesi pengguna dicabut.");
      void refresh(true);
    } catch (err) {
      toast.error(actionErrorMessage(err, "Gagal mencabut sesi pengguna."));
    } finally {
      setRevokingId(null);
    }
  }

  // Guard OWNER — dirender hanya untuk pemilik studio.
  if (role !== "OWNER") return null;

  const levelMeta = report ? LEVEL_BADGE[report.level] : null;

  return (
    <CollapsibleCard
      id="kesehatan-akses"
      icon={ShieldCheck}
      title="Kesehatan Akses"
      description="Audit rutin akun, sesi, dan sandi: temuan risiko akses beserta tindakan cepatnya."
      defaultOpen
      actions={
        levelMeta ? (
          <Badge variant="outline" className={`shrink-0 ${levelMeta.className}`}>
            {levelMeta.label}
          </Badge>
        ) : null
      }
    >
      {fetchFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Belum dapat memuat kesehatan akses.</span>
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

      {loading && !report ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[84px] rounded-lg" />
          ))}
        </div>
      ) : report ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCell
              label="Total Pengguna Aktif"
              value={String(report.stats.activeUsers)}
              hint={`dari ${report.stats.totalUsers} akun · ${report.stats.ownerCount} OWNER`}
            />
            <StatCell
              label="Sesi Aktif"
              value={String(report.stats.activeSessions)}
            />
            <StatCell
              label="Login Gagal (24 jam)"
              value={String(report.stats.failedLogins24h)}
              danger={report.stats.failedLogins24h > 0}
              hint={
                report.stats.dualControlEnabled
                  ? "Persetujuan ganda aktif"
                  : "Persetujuan ganda nonaktif"
              }
            />
          </div>

          {report.findings.length === 0 ? (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
              <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
              Tidak ada temuan — konfigurasi akses aman.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {report.findings.map((finding) => (
                <FindingRow
                  key={finding.key}
                  finding={finding}
                  revoking={finding.actionUserId != null && revokingId === finding.actionUserId}
                  onRevoke={(f) => void handleRevoke(f)}
                />
              ))}
            </ul>
          )}

          <p className="text-xs text-muted-foreground">
            Cek terakhir: {formatDateTime(report.checkedAt)}
          </p>
        </>
      ) : null}
    </CollapsibleCard>
  );
}
