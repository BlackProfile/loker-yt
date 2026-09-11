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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { History, Loader2, RefreshCw, UserSearch } from "lucide-react";
import type { Application, LogEntry } from "@/lib/types";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import {
  actionLabel,
  actorBadgeClass,
  formatDateTime,
} from "./format";
import { ApplicationDetailDialog } from "./application-detail-dialog";

const LIMIT = 100;

// Tab Log: riwayat aktivitas sistem, AI, dan admin.
export function LogsTab() {
  const { reportError } = useAdminSession();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Application | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const appCacheRef = useRef<Map<string, Application>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<LogEntry[]>(
        `/api/admin/logs?limit=${LIMIT}`
      );
      setLogs(data);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

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
          {loading ? (
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
