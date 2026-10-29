"use client";

// NR70 (Fitur #3) — kartu statistik program referral di panel admin.
// GET /api/admin/referrals -> { total, used, rewarded, conversionPct, recent[] }.
// Hanya OWNER/HR yang bisa melihat; VIEWER di-filter di sisi server (403 -> empty).
//
// Pola render: ringkasan angka (StatCard lama) + tabel kode terbaru (Table).
// Memakai helper apiGet + useLiveRefresh agar mutakhir saat ada lamaran baru.
import { useCallback, useEffect, useRef, useState } from "react";
import { Gift, RefreshCw, type LucideIcon } from "lucide-react";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { apiGet } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";

type ReferralRowDto = {
  id: string;
  code: string;
  referrerName: string | null;
  referrerEmail: string;
  applicationId: string | null;
  createdAt: string;
  usedAt: string | null;
  rewardedAt: string | null;
};

type ReferralsStatsResponse = {
  total: number;
  used: number;
  rewarded: number;
  conversionPct: number;
  recent: ReferralRowDto[];
};

/** Angka kecil ringkasan (mirip StatCard reports-tab — dijiplak ringkas agar
 *  kartu mandiri tanpa import private component dari reports-tab). */
function MiniStat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border p-3">
      <p className={cn("font-bold tabular-nums", valueClass ?? "text-xl")}>{value}</p>
      <p className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</p>
    </div>
  );
}

/** Tanggal ramah "29 Okt 2026, 14.30" (id-ID). */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ReferralCard({ icon: Icon }: { icon: LucideIcon }) {
  const { reportError } = useAdminSession();
  const [data, setData] = useState<ReferralsStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const filterRef = useRef(true);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await apiGet<ReferralsStatsResponse>("/api/admin/referrals");
        setData(res);
        setDenied(false);
      } catch (err) {
        // 403 = VIEWER (role kurang) — kartu ditampilkan dalam mode terbatas.
        if (err instanceof Error && "status" in err && err.status === 403) {
          setDenied(true);
          setData(null);
        } else {
          reportError(err);
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [reportError],
  );

  useEffect(() => {
    filterRef.current = true;
    void load(false);
  }, [load]);

  // Refresh senyap saat ada perubahan lamaran (referral ditandai saat submit).
  useLiveRefresh("applications:changed", () => {
    if (filterRef.current) void load(true);
  });

  const total = data?.total ?? 0;
  const used = data?.used ?? 0;
  const rewarded = data?.rewarded ?? 0;
  const conversionPct = data?.conversionPct ?? 0;
  const recent = data?.recent ?? [];

  return (
    <Card className="rounded-2xl p-4 sm:p-6">
      <CardTitle className="flex items-center justify-between gap-2 text-base">
        <span className="flex items-center gap-2">
          <Icon className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
          Program Referral
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 px-2"
          onClick={() => void load(false)}
          disabled={loading}
          aria-label="Segarkan statistik referral"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden="true" />
          Segarkan
        </Button>
      </CardTitle>
      <CardDescription className="mt-1">
        Kode referral yang dibuat pelamar publik + jumlah yang sudah dipakai saat apply. Hadiah
        perujuk dilunasi manual (kolom rewarded) — pelacakan ringkas, bukan otomatis.
      </CardDescription>

      {denied ? (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
          Statistik referral hanya dapat dilihat oleh OWNER/HR. Hubungi admin OWNER bila perlu akses.
        </p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="Total Kode" value={String(total)} />
            <MiniStat
              label="Sudah Dipakai"
              value={String(used)}
              valueClass="text-xl text-rose-600 dark:text-rose-400"
            />
            <MiniStat
              label="Konversi"
              value={`${conversionPct}%`}
              valueClass="text-xl text-amber-600 dark:text-amber-400"
            />
            <MiniStat
              label="Diberi Hadiah"
              value={String(rewarded)}
              valueClass="text-xl text-emerald-600 dark:text-emerald-400"
            />
          </div>

          {recent.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Belum ada kode referral. Kandidat dapat membuat kode lewat tautan program referral
              di halaman lamaran.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="px-3 py-2">Kode</TableHead>
                    <TableHead className="px-3 py-2">Perujuk</TableHead>
                    <TableHead className="px-3 py-2">Status</TableHead>
                    <TableHead className="px-3 py-2">Dibuat</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((row) => {
                    const used = !!row.usedAt;
                    const rewarded = !!row.rewardedAt;
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="px-3 py-2 font-mono text-xs font-medium">
                          {row.code}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-sm">
                          <span className="block truncate">{row.referrerName || "-"}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {row.referrerEmail}
                          </span>
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          {rewarded ? (
                            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                              Sudah dihadiahi
                            </Badge>
                          ) : used ? (
                            <Badge className="bg-rose-600 text-white hover:bg-rose-600">
                              Dipakai
                            </Badge>
                          ) : (
                            <Badge variant="outline">Belum dipakai</Badge>
                          )}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-xs tabular-nums text-muted-foreground">
                          {fmtDateTime(row.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/** Re-export ikon Gift agar reports-tab tinggal pakai (default-nya dipakai). */
export const ReferralIcon: LucideIcon = Gift;
