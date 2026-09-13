"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { History, Loader2, RefreshCw, ShieldCheck, UserSearch } from "lucide-react";
import type { Application, LogEntry } from "@/lib/types";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import {
  actionLabel,
  actorBadgeClass,
  formatDateTime,
} from "./format";
import { ApplicationDetailDialog } from "./application-detail-dialog";

const LIMIT = 100;

/* ------------------------------ Audit Login ------------------------------ */

/** Baris dari GET /api/admin/logins. */
type LoginAuditEntry = {
  id: string;
  email: string;
  userId: string | null;
  success: boolean;
  reason: string | null;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
};

// Label alasan kegagalan (LoginAudit.reason) — tanpa detail teknis berlebih.
const AUDIT_REASON_LABELS: Record<string, string> = {
  PASSWORD_SALAH: "Password salah",
  TOTP_SALAH: "Kode 2FA salah",
  LOCKOUT: "Diblokir sementara",
  AKUN_NONAKTIF: "Akun nonaktif",
};

function auditReasonLabel(reason: string | null): string {
  if (!reason) return "-";
  return AUDIT_REASON_LABELS[reason] ?? reason;
}

// Ringkasan user-agent singkat: "Chrome · Windows" (fallback: potongan 40 karakter).
function summarizeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "-";
  let browser = "";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  const inside = /\(([^)]*)\)/.exec(ua)?.[1] ?? "";
  const rawPlatform = inside.split(";")[0]?.trim() ?? "";
  let platform = rawPlatform.slice(0, 20);
  if (/windows/i.test(rawPlatform)) platform = "Windows";
  else if (/macintosh|mac os/i.test(rawPlatform)) platform = "macOS";
  else if (/android/i.test(rawPlatform)) platform = "Android";
  else if (/iphone|ipad|ios/i.test(rawPlatform)) platform = "iOS";
  else if (/linux/i.test(rawPlatform)) platform = "Linux";
  const label = [browser, platform].filter(Boolean).join(" · ");
  return label || ua.slice(0, 40);
}

// Badge status audit: Sukses (emerald) / Gagal (rose).
function auditBadgeClass(success: boolean): string {
  return success
    ? "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
    : "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400";
}

// Section Audit Login: 100 percobaan login terakhir.
// OWNER melihat semua akun + filter email; role lain hanya login miliknya sendiri.
function LoginAuditCard() {
  const { reportError, role } = useAdminSession();
  const [audits, setAudits] = useState<LoginAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [emailFilter, setEmailFilter] = useState("all");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<LoginAuditEntry[]>("/api/admin/logins");
      setAudits(data);
    } catch (err) {
      reportError(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const emails = Array.from(new Set(audits.map((a) => a.email))).sort((a, b) =>
    a.localeCompare(b)
  );
  const filtered =
    emailFilter === "all" ? audits : audits.filter((a) => a.email === emailFilter);

  return (
    <Card className="gap-0 rounded-2xl py-6">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 px-6">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck
              className="size-4 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
            Audit Login
          </CardTitle>
          <CardDescription className="mt-1">
            100 percobaan login terakhir
            {role === "OWNER" ? " dari semua akun." : " pada akun Anda."}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {role === "OWNER" ? (
            <Select value={emailFilter} onValueChange={setEmailFilter}>
              <SelectTrigger className="h-10 w-36 sm:w-52" aria-label="Filter email audit login">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua email</SelectItem>
                {emails.map((email) => (
                  <SelectItem key={email} value={email}>
                    {email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-10 active:scale-[0.99] sm:h-9"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Segarkan audit login"
          >
            <RefreshCw
              className={`size-4 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Segarkan
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-6">
        {loading && audits.length === 0 ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <ShieldCheck className="size-8 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Belum ada percobaan login tercatat.</p>
          </div>
        ) : (
          <>
            {/* Desktop: table */}
            <div className="nice-scrollbar hidden max-h-96 overflow-y-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="px-4 py-3">Waktu</TableHead>
                    <TableHead className="px-4 py-3">Email</TableHead>
                    <TableHead className="px-4 py-3">Status</TableHead>
                    <TableHead className="px-4 py-3">Perangkat</TableHead>
                    <TableHead className="px-4 py-3">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap px-4 py-3 text-sm text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-56 px-4 py-3">
                        <p className="truncate text-sm">{entry.email}</p>
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        {entry.success ? (
                          <Badge variant="outline" className={auditBadgeClass(true)}>
                            Sukses
                          </Badge>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className={auditBadgeClass(false)}>
                              Gagal
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {auditReasonLabel(entry.reason)}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="px-4 py-3 text-sm text-muted-foreground">
                        {summarizeUserAgent(entry.userAgent)}
                      </TableCell>
                      <TableCell className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {entry.ip ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: daftar card */}
            <div className="nice-scrollbar flex max-h-96 flex-col gap-3 overflow-y-auto md:hidden">
              {filtered.map((entry) => (
                <div key={entry.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                    <Badge
                      variant="outline"
                      className={`px-1.5 py-0 text-[10px] ${auditBadgeClass(entry.success)}`}
                    >
                      {entry.success ? "Sukses" : `Gagal · ${auditReasonLabel(entry.reason)}`}
                    </Badge>
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium">{entry.email}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {summarizeUserAgent(entry.userAgent)} · {entry.ip ?? "-"}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Tab Log: riwayat aktivitas sistem, AI, dan admin.
export function LogsTab() {
  const { reportError } = useAdminSession();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Application | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const appCacheRef = useRef<Map<string, Application>>(new Map());

  // silent: refresh senyap (dipakai event realtime) — log lama tetap tampil
  // sampai data baru siap, tanpa skeleton ulang.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<LogEntry[]>(
        `/api/admin/logs?limit=${LIMIT}`
      );
      setLogs(data);
    } catch (err) {
      reportError(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: aktivitas lamaran baru/perubahan status langsung tercatat.
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });

  // Buka detail kandidat: cek cache lalu cari via GET applications?q=nama.
  async function openCandidate(log: LogEntry) {
    if (!log.applicationId) return;
    const cached = appCacheRef.current.get(log.applicationId);
    if (cached) {
      setDetail(cached);
      return;
    }
    setDetailLoadingId(log.applicationId);
    try {
      const query = log.applicationName
        ? `?q=${encodeURIComponent(log.applicationName)}`
        : "";
      const results = await apiGet<Application[]>(
        `/api/admin/applications${query}`
      );
      const found =
        results.find((a) => a.id === log.applicationId) ??
        (results.length === 1 ? results[0] : undefined);
      if (found) {
        appCacheRef.current.set(found.id, found);
        setDetail(found);
      } else {
        reportError(new Error("Detail kandidat tidak ditemukan."));
      }
    } catch (err) {
      reportError(err);
    } finally {
      setDetailLoadingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Audit login (percobaan masuk admin) */}
      <LoginAuditCard />

      <Card className="gap-0 rounded-2xl py-6">
        <CardHeader className="flex-row items-center justify-between px-6">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Log Aktivitas
            </CardTitle>
            <CardDescription className="mt-1">
              100 aktivitas terakhir dari sistem, AI, dan admin.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-10 active:scale-[0.99] sm:h-9"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Segarkan log aktivitas"
          >
            <RefreshCw
              className={`size-4 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            Segarkan
          </Button>
        </CardHeader>
        <CardContent className="px-6">
          {/* Skeleton hanya saat pemuatan pertama; refresh senyap mempertahankan
              tabel lama sampai data baru siap. */}
          {loading && logs.length === 0 ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <History className="size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Belum ada aktivitas tercatat.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop: table */}
              <div className="hidden max-h-[70vh] overflow-y-auto md:block nice-scrollbar">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="px-4 py-3">Waktu</TableHead>
                      <TableHead className="px-4 py-3">Aktor</TableHead>
                      <TableHead className="px-4 py-3">Aksi</TableHead>
                      <TableHead className="px-4 py-3">Detail</TableHead>
                      <TableHead className="px-4 py-3">Kandidat</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
                          {formatDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge
                            variant="outline"
                            className={actorBadgeClass(log.actor)}
                          >
                            {log.actor}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge variant="secondary">{actionLabel(log.action)}</Badge>
                        </TableCell>
                        <TableCell className="max-w-72 px-4 py-3">
                          <p className="truncate text-sm text-muted-foreground">
                            {log.detail ?? "-"}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {log.applicationName && log.applicationId ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 text-xs"
                              disabled={detailLoadingId === log.applicationId}
                              onClick={() => void openCandidate(log)}
                            >
                              {detailLoadingId === log.applicationId ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <UserSearch className="size-3.5" aria-hidden="true" />
                              )}
                              <span className="max-w-40 truncate">
                                {log.applicationName}
                              </span>
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: daftar card */}
              <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto md:hidden nice-scrollbar">
                {logs.map((log) => (
                  <div key={log.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(log.createdAt)}
                      </span>
                      <Badge
                        variant="outline"
                        className={`px-1.5 py-0 text-[10px] ${actorBadgeClass(log.actor)}`}
                      >
                        {log.actor}
                      </Badge>
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {actionLabel(log.action)}
                      </Badge>
                    </div>
                    {log.detail ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">{log.detail}</p>
                    ) : null}
                    {log.applicationName && log.applicationId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 h-8 text-xs"
                        disabled={detailLoadingId === log.applicationId}
                        onClick={() => void openCandidate(log)}
                      >
                        {detailLoadingId === log.applicationId ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <UserSearch className="size-3.5" aria-hidden="true" />
                        )}
                        Detail {log.applicationName}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={(updated) => {
          appCacheRef.current.set(updated.id, updated);
          setDetail(updated);
        }}
        onDeleted={(id) => {
          appCacheRef.current.delete(id);
          setDetail(null);
          void load();
        }}
      />
    </div>
  );
}
