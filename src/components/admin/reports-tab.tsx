"use client";

// Tab Laporan & Ekspor (Task 20-f) — 4 fitur:
// 1. Funnel konversi per posisi        -> GET /api/admin/reports/funnel
// 2. Pelacak sumber lamaran            -> GET /api/admin/reports/sources
// 3. Validasi akurasi AI               -> GET /api/admin/reports/ai-validation
// 4. Ekspor profil kandidat (cetak PDF) -> ProfilePrintDialog + data dari
//    /api/admin/applications & /api/admin/positions yang sudah ada.
// Semua fetch memakai helper apiGet; refresh senyap saat event realtime lamaran/posisi.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Filter,
  Inbox,
  Link2,
  Megaphone,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";
import type { Application, Position } from "@/lib/types";
import { apiGet, buildQuery } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { ProfilePrintDialog } from "./profile-print-dialog";

/* ------------------------------ Bentuk data API ------------------------------ */

type FunnelStage = {
  key: string;
  label: string;
  count: number;
  conversionPct_dari_sebelumnya: number;
  basisLabel?: string | null;
};

type FunnelResponse = {
  stages: FunnelStage[];
  avgDaysPerStage: { from: string; to: string; days: number }[];
};

type CountRow = { label: string; count: number };

type SourcesResponse = {
  sources: CountRow[];
  utm: CountRow[];
  referrers: CountRow[];
};

type AiValidationResponse = {
  totalAnalyzed: number;
  notFinal: number;
  avgScoreAccepted: number | null;
  avgScoreRejected: number | null;
  accuracyPct: number | null;
  threshold: number;
  matrix: { tp: number; fp: number; fn: number; tn: number };
  misses: {
    id: string;
    name: string;
    positionTitle: string | null;
    aiScore: number;
    outcome: "DITERIMA" | "DITOLAK";
    kind: "tinggi_ditolak" | "rendah_diterima";
    gap: number;
  }[];
};

/* --------------------------------- Helper UI --------------------------------- */

function fmtDays(days: number): string {
  return `${days.toFixed(1).replace(".", ",")} hari`;
}

/** Lebar bar (persen) relatif ke nilai maksimum; minimal 4% agar masih terlihat. */
function barWidth(count: number, max: number): string {
  if (max <= 0 || count <= 0) return "0%";
  return `${Math.max(4, Math.round((count / max) * 100))}%`;
}

function SectionCard({
  icon: Icon,
  iconClass,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  iconClass: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-2xl p-4 sm:p-6">
      <CardTitle className="flex items-center gap-2 text-base">
        <Icon className={cn("size-4 shrink-0", iconClass)} aria-hidden="true" />
        {title}
      </CardTitle>
      <CardDescription className="mt-1">{description}</CardDescription>
      {children}
    </Card>
  );
}

function SectionSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-lg" />
      ))}
    </div>
  );
}

function SectionEmpty({ text }: { text: string }) {
  return (
    <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
      <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/** Satu kolom dimensi sumber: daftar label + jumlah + bar mini. */
function DimensionList({
  icon: Icon,
  title,
  rows,
  barClass,
  emptyText,
}: {
  icon: LucideIcon;
  title: string;
  rows: CountRow[];
  barClass: string;
  emptyText: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-xl border p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="mt-3 flex max-h-64 flex-col gap-2.5 overflow-y-auto nice-scrollbar">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate" title={row.label}>
                  {row.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {row.count}
                </span>
              </div>
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                role="img"
                aria-label={`${row.label}: ${row.count} lamaran`}
              >
                <div
                  className={cn("h-full rounded-full", barClass)}
                  style={{ width: barWidth(row.count, max) }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Kartu angka kecil untuk ringkasan validasi AI. */
function StatCard({
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

/* --------------------------------- Komponen --------------------------------- */

export function ReportsTab() {
  const { reportError } = useAdminSession();

  const [positions, setPositions] = useState<Position[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  const [positionFilter, setPositionFilter] = useState("ALL");
  const [funnel, setFunnel] = useState<FunnelResponse | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(true);

  const [sources, setSources] = useState<SourcesResponse | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  const [ai, setAi] = useState<AiValidationResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(true);

  const [candidateQuery, setCandidateQuery] = useState("");
  const [selectedAppId, setSelectedAppId] = useState("");
  const [printOpen, setPrintOpen] = useState(false);

  // Ref agar handler refresh senyap selalu memakai filter posisi terbaru.
  const positionFilterRef = useRef(positionFilter);
  useEffect(() => {
    positionFilterRef.current = positionFilter;
  }, [positionFilter]);

  const loadMeta = useCallback(
    async (silent = false) => {
      if (!silent) setMetaLoading(true);
      try {
        const [pos, apps] = await Promise.all([
          apiGet<Position[]>("/api/admin/positions"),
          apiGet<Application[]>("/api/admin/applications"),
        ]);
        setPositions(pos);
        setApplications(apps);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setMetaLoading(false);
      }
    },
    [reportError]
  );

  const loadFunnel = useCallback(
    async (positionId: string, silent = false) => {
      if (!silent) setFunnelLoading(true);
      try {
        // buildQuery melewatkan "ALL" sehingga tanpa positionId = semua posisi.
        const res = await apiGet<FunnelResponse>(
          `/api/admin/reports/funnel${buildQuery({ positionId })}`
        );
        setFunnel(res);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setFunnelLoading(false);
      }
    },
    [reportError]
  );

  const loadSources = useCallback(
    async (silent = false) => {
      if (!silent) setSourcesLoading(true);
      try {
        const res = await apiGet<SourcesResponse>("/api/admin/reports/sources");
        setSources(res);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setSourcesLoading(false);
      }
    },
    [reportError]
  );

  const loadAi = useCallback(
    async (silent = false) => {
      if (!silent) setAiLoading(true);
      try {
        const res = await apiGet<AiValidationResponse>("/api/admin/reports/ai-validation");
        setAi(res);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setAiLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void loadMeta(false);
    void loadFunnel("ALL", false);
    void loadSources(false);
    void loadAi(false);
  }, []);

  useLiveRefresh("applications:changed", () => {
    void loadMeta(true);
    void loadFunnel(positionFilterRef.current, true);
    void loadSources(true);
    void loadAi(true);
  });
  useLiveRefresh("positions:changed", () => {
    void loadMeta(true);
  });

  function handlePositionChange(value: string) {
    setPositionFilter(value);
    void loadFunnel(value, false);
  }

  const selectedApp = applications.find((a) => a.id === selectedAppId) ?? null;

  const filteredCandidates = useMemo(() => {
    const q = candidateQuery.trim().toLowerCase();
    if (!q) return applications;
    return applications.filter(
      (a) =>
        a.name.toLowerCase().includes(q) || (a.positionTitle ?? "").toLowerCase().includes(q)
    );
  }, [applications, candidateQuery]);

  /* ------------------------------- Turunan funnel ------------------------------ */

  const funnelStages = funnel?.stages ?? [];
  const funnelTotal = funnelStages.find((s) => s.key === "MASUK")?.count ?? 0;
  const maxStageCount = Math.max(1, ...funnelStages.map((s) => s.count));
  const avgDays = funnel?.avgDaysPerStage ?? [];

  /* ------------------------------- Turunan sumber ------------------------------ */

  const sourcesTotal =
    (sources?.sources ?? []).reduce((sum, r) => sum + r.count, 0) ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold">Laporan &amp; Ekspor</h2>
          <p className="text-xs text-muted-foreground">
            Funnel konversi, sumber lamaran, validasi akurasi AI, dan cetak profil kandidat.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-11 active:scale-[0.99] sm:h-9"
          onClick={() => {
            void loadMeta(true);
            void loadFunnel(positionFilterRef.current, true);
            void loadSources(true);
            void loadAi(true);
          }}
          disabled={metaLoading || funnelLoading || sourcesLoading || aiLoading}
          aria-label="Segarkan semua laporan"
        >
          <RefreshCw
            className={cn(
              "size-4",
              (metaLoading || funnelLoading || sourcesLoading || aiLoading) && "animate-spin"
            )}
            aria-hidden="true"
          />
          Segarkan
        </Button>
      </div>

      {/* 1. Funnel konversi per posisi */}
      <SectionCard
        icon={Filter}
        iconClass="text-rose-600"
        title="Funnel Konversi Lamaran"
        description="Jumlah lamaran yang pernah mencapai tiap tahap, dihitung dari status saat ini plus riwayat perubahan status."
      >
        <div className="mt-3 w-full sm:max-w-xs">
          <Select value={positionFilter} onValueChange={handlePositionChange}>
            <SelectTrigger className="w-full" aria-label="Filter posisi funnel">
              <SelectValue placeholder="Semua posisi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua posisi</SelectItem>
              {positions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {funnelLoading && !funnel ? (
          <SectionSkeleton rows={5} />
        ) : funnelTotal === 0 ? (
          <SectionEmpty text="Belum ada lamaran untuk cakupan posisi ini. Funnel terisi otomatis setelah ada lamaran masuk." />
        ) : (
          <>
            {/* Bar horizontal bertingkat */}
            <div className="mt-4 flex flex-col gap-3">
              {funnelStages.map((stage, idx) => (
                <div key={stage.key} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                    <span className="text-sm font-medium">{stage.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {stage.count} lamaran
                      {idx > 0 ? (
                        <>
                          {" · "}
                          <span
                            className={cn(
                              "font-medium",
                              stage.key === "DITERIMA" &&
                                "text-emerald-600 dark:text-emerald-400",
                              stage.key === "DITOLAK" && "text-rose-600 dark:text-rose-400"
                            )}
                          >
                            {stage.conversionPct_dari_sebelumnya}%
                          </span>{" "}
                          dari {stage.basisLabel ?? "tahap sebelumnya"}
                        </>
                      ) : (
                        " · 100% dasar funnel"
                      )}
                    </span>
                  </div>
                  <div
                    className="h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                    role="img"
                    aria-label={`${stage.label}: ${stage.count} lamaran`}
                  >
                    <div
                      className={cn(
                        "h-full rounded-full",
                        stage.key === "DITERIMA"
                          ? "bg-emerald-600"
                          : stage.key === "TES"
                            ? "bg-amber-500"
                            : "bg-rose-600"
                      )}
                      style={{ width: barWidth(stage.count, maxStageCount) }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Rata-rata hari per tahap */}
            <div className="mt-5 rounded-xl border bg-zinc-50/60 p-4 dark:bg-zinc-900/40">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Timer className="size-4 shrink-0 text-amber-500" aria-hidden="true" />
                Rata-rata Hari per Tahap
              </p>
              {avgDays.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Belum ada riwayat perubahan status yang bisa dihitung.
                </p>
              ) : (
                <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {avgDays.map((row) => (
                    <li
                      key={`${row.from}-${row.to}`}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="min-w-0 truncate text-muted-foreground">
                        {row.from} → {row.to}
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">
                        {fmtDays(row.days)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </SectionCard>

      {/* 2. Pelacak sumber lamaran */}
      <SectionCard
        icon={Megaphone}
        iconClass="text-rose-600"
        title="Pelacak Sumber Lamaran"
        description="Asal usul lamaran: pilihan sumber, parameter UTM, dan domain referrer (tanpa referrer dihitung sebagai akses langsung)."
      >
        {sourcesLoading && !sources ? (
          <SectionSkeleton rows={3} />
        ) : sourcesTotal === 0 ? (
          <SectionEmpty text="Belum ada lamaran sehingga sumber belum bisa dihitung." />
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <DimensionList
              icon={Megaphone}
              title="Sumber"
              rows={sources?.sources ?? []}
              barClass="bg-rose-500"
              emptyText="Belum ada data sumber."
            />
            <DimensionList
              icon={Tags}
              title="UTM (Source / Campaign)"
              rows={sources?.utm ?? []}
              barClass="bg-amber-400"
              emptyText="Belum ada data UTM."
            />
            <DimensionList
              icon={Link2}
              title="Referrer (Domain)"
              rows={sources?.referrers ?? []}
              barClass="bg-zinc-500"
              emptyText="Belum ada data referrer."
            />
          </div>
        )}
      </SectionCard>

      {/* 3. Validasi akurasi AI */}
      <SectionCard
        icon={Sparkles}
        iconClass="text-amber-500"
        title="Validasi Akurasi AI"
        description="Perbandingan skor AI dengan keputusan akhir pada lamaran yang sudah selesai (diterima atau ditolak)."
      >
        {aiLoading && !ai ? (
          <SectionSkeleton rows={4} />
        ) : (ai?.totalAnalyzed ?? 0) === 0 ? (
          <SectionEmpty
            text={
              ai && ai.notFinal > 0
                ? `${ai.notFinal} lamaran sudah dianalisis AI tetapi belum final (masih diproses). Validasi terisi setelah ada keputusan akhir.`
                : "Belum ada lamaran dengan skor AI yang sudah final (diterima atau ditolak)."
            }
          />
        ) : ai ? (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Total Dianalisis" value={String(ai.totalAnalyzed)} />
              <StatCard
                label={`Akurasi Rule (skor >= ${ai.threshold} diprediksi diterima)`}
                value={ai.accuracyPct != null ? `${ai.accuracyPct}%` : "-"}
                valueClass="text-3xl text-rose-600"
              />
              <StatCard
                label="Rata-rata Skor Diterima"
                value={
                  ai.avgScoreAccepted != null
                    ? ai.avgScoreAccepted.toFixed(1).replace(".", ",")
                    : "-"
                }
                valueClass="text-xl text-emerald-600 dark:text-emerald-400"
              />
              <StatCard
                label="Rata-rata Skor Ditolak"
                value={
                  ai.avgScoreRejected != null
                    ? ai.avgScoreRejected.toFixed(1).replace(".", ",")
                    : "-"
                }
                valueClass="text-xl text-rose-600 dark:text-rose-400"
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Matriks 2x2 */}
              <div className="rounded-xl border p-4">
                <p className="text-sm font-semibold">Matriks 2x2</p>
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium" />
                      <th className="pb-2 font-medium">Kenyataan Diterima</th>
                      <th className="pb-2 font-medium">Kenyataan Ditolak</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    <tr className="border-t">
                      <td className="py-2 text-xs text-muted-foreground">Prediksi Diterima</td>
                      <td className="py-2 font-semibold">
                        {ai.matrix.tp}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          benar-positif
                        </span>
                      </td>
                      <td className="py-2 font-semibold">
                        {ai.matrix.fp}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          salah-positif
                        </span>
                      </td>
                    </tr>
                    <tr className="border-t">
                      <td className="py-2 text-xs text-muted-foreground">Prediksi Ditolak</td>
                      <td className="py-2 font-semibold">
                        {ai.matrix.fn}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          salah-negatif
                        </span>
                      </td>
                      <td className="py-2 font-semibold">
                        {ai.matrix.tn}
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          benar-negatif
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
                {ai.notFinal > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {ai.notFinal} lamaran lain sudah dianalisis AI tetapi belum final sehingga
                    tidak ikut dihitung.
                  </p>
                ) : null}
              </div>

              {/* Daftar miss terbesar */}
              <div className="rounded-xl border p-4">
                <p className="text-sm font-semibold">5 Miss Terbesar</p>
                {ai.misses.length === 0 ? (
                  <p className="mt-3 text-xs text-muted-foreground">
                    Tidak ada miss — semua prediksi rule sesuai keputusan akhir.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead className="text-right">Skor</TableHead>
                        <TableHead className="text-right">Hasil</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ai.misses.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>
                            <span className="font-medium">{m.name}</span>
                            <span className="block text-xs text-muted-foreground">
                              {m.kind === "tinggi_ditolak"
                                ? "Skor tinggi tapi ditolak"
                                : "Skor rendah tapi diterima"}
                              {m.positionTitle ? ` · ${m.positionTitle}` : ""}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{m.aiScore}</TableCell>
                          <TableCell className="text-right">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                m.outcome === "DITERIMA"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
                                  : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
                              )}
                            >
                              {m.outcome === "DITERIMA" ? "Diterima" : "Ditolak"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>

            <p className="mt-3 text-xs italic text-muted-foreground">
              Metrik indikatif, keputusan akhir tetap manusia.
            </p>
          </>
        ) : null}
      </SectionCard>

      {/* 4. Ekspor profil kandidat (cetak PDF) */}
      <SectionCard
        icon={Printer}
        iconClass="text-rose-600"
        title="Ekspor Profil Kandidat"
        description="Pilih kandidat, buka pratinjau profil siap cetak, lalu simpan sebagai PDF lewat dialog cetak browser."
      >
        {metaLoading && applications.length === 0 ? (
          <SectionSkeleton rows={2} />
        ) : applications.length === 0 ? (
          <SectionEmpty text="Belum ada kandidat untuk diekspor." />
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="w-full sm:max-w-56">
                <Label htmlFor="cari-kandidat-laporan">Cari kandidat</Label>
                <div className="relative mt-1.5">
                  <Search
                    className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="cari-kandidat-laporan"
                    value={candidateQuery}
                    onChange={(e) => setCandidateQuery(e.target.value)}
                    placeholder="Nama atau posisi..."
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="w-full sm:max-w-sm">
                <Label htmlFor="pilih-kandidat-laporan">Kandidat</Label>
                <Select value={selectedAppId} onValueChange={setSelectedAppId}>
                  <SelectTrigger id="pilih-kandidat-laporan" className="mt-1.5 w-full">
                    <SelectValue placeholder="Pilih kandidat" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCandidates.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name} — {a.positionTitle ?? "Tanpa posisi"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {filteredCandidates.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Tidak ada kandidat yang cocok dengan pencarian.
                  </p>
                ) : null}
              </div>
              <Button
                className="sm:ml-auto"
                onClick={() => setPrintOpen(true)}
                disabled={!selectedApp}
              >
                <Printer className="size-4" aria-hidden="true" />
                Pratinjau &amp; Cetak
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Profil mencakup kontak, status, skor dan ringkasan AI, rating, pengalaman,
              motivasi, rubrik, riwayat wawancara ringkas, serta 10 aktivitas terakhir.
            </p>
          </>
        )}
      </SectionCard>

      <ProfilePrintDialog
        application={selectedApp}
        positions={positions}
        open={printOpen}
        onOpenChange={setPrintOpen}
      />
    </div>
  );
}
