"use client";

// Tab Laporan & Ekspor (Task 20-f) — 7 fitur:
// 1. Funnel konversi per posisi        -> GET /api/admin/reports/funnel
// 2. Pelacak sumber lamaran            -> GET /api/admin/reports/sources
// 3. Validasi akurasi AI               -> GET /api/admin/reports/ai-validation
// 4. Ekspor profil kandidat (cetak PDF) -> ProfilePrintDialog + data dari
//    /api/admin/applications & /api/admin/positions yang sudah ada.
// 5. Kecepatan proses per tahap        -> GET /api/admin/reports/time-in-stage
// 6. Rekap bulanan (snapshot otomatis + cetak PDF) -> GET/POST /api/admin/reports/monthly
// 7. Rekap survei pengalaman kandidat  -> GET /api/admin/reports/candidate-survey
// Semua fetch memakai helper apiGet; refresh senyap saat event realtime lamaran/posisi.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Filter,
  Inbox,
  Link2,
  Loader2,
  Megaphone,
  Printer,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Tags,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import type { Application, Position } from "@/lib/types";
import { apiGet, apiPost, buildQuery } from "./api";
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

type TimeInStageRow = {
  stage: string;
  label: string;
  count: number;
  avgHours: number | null;
  medianHours: number | null;
  ongoing: number;
};

type TimeInStageResponse = {
  generatedAt: string;
  days: number;
  positionTitle: string | null;
  stages: TimeInStageRow[];
  slowestLabel: string | null;
  totalApplications: number;
};

type MonthlyReportDataUi = {
  month: string;
  activePositions: number;
  newApplications: number;
  interviewsScheduled: number;
  offersSent: number;
  offersAccepted: number;
  hired: number;
  rejected: number;
  topSources: { source: string; count: number }[];
  avgSurveyScore: number | null;
  surveyCount: number;
};

type MonthlyReportRow = {
  id: string;
  month: string;
  createdAt: string;
  data: MonthlyReportDataUi | null;
};

type SurveyRecapResponse = {
  generatedAt: string;
  sent: number;
  answered: number;
  avgScore: number | null;
  distribution: Record<number, number>;
  recent: {
    score: number;
    comment: string | null;
    createdAt: string;
    positionTitle: string | null;
  }[];
};

/* --------------------------------- Helper UI --------------------------------- */

function fmtDays(days: number): string {
  return `${days.toFixed(1).replace(".", ",")} hari`;
}

/** "2026-09" -> "September 2026" (id-ID). Fallback teks asli bila tak terbaca. */
function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return month;
  return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(date);
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

/* ------------------- Helper kecepatan proses (time-in-stage) ------------------- */

/** Durasi ramah: "< 1 jam", "36,5 jam", "2,1 hari" (>= 48 jam tampil hari). */
function fmtHours(hours: number | null): string {
  if (hours == null) return "-";
  if (hours < 1) return "< 1 jam";
  if (hours < 48) return `${hours.toFixed(1).replace(".", ",")} jam`;
  return `${(hours / 24).toFixed(1).replace(".", ",")} hari`;
}

/** Bar proporsi durasi rata-rata: rose untuk tahap terlambat, zinc untuk lainnya. */
function SpeedBar({
  row,
  isSlowest,
  maxAvg,
}: {
  row: TimeInStageRow;
  isSlowest: boolean;
  maxAvg: number;
}) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
      role="img"
      aria-label={`Proporsi durasi ${row.label}: rata-rata ${fmtHours(row.avgHours)}`}
    >
      <div
        className={cn(
          "h-full rounded-full",
          isSlowest ? "bg-rose-600 dark:bg-rose-500" : "bg-zinc-400 dark:bg-zinc-500"
        )}
        style={{ width: barWidth(row.avgHours ?? 0, maxAvg) }}
      />
    </div>
  );
}

/** Satu tahap sebagai kartu bertumpuk (tampilan mobile di bawah md). */
function StageSpeedCard({
  row,
  isSlowest,
  maxAvg,
}: {
  row: TimeInStageRow;
  isSlowest: boolean;
  maxAvg: number;
}) {
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium" title={row.label}>
          {row.label}
        </span>
        {row.ongoing > 0 ? (
          <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
            {row.ongoing} berjalan
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {row.count} selesai · rata-rata {fmtHours(row.avgHours)} · median{" "}
        {fmtHours(row.medianHours)}
      </p>
      <div className="mt-2">
        <SpeedBar row={row} isSlowest={isSlowest} maxAvg={maxAvg} />
      </div>
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

  // Kecepatan proses (time-in-stage) — filter & data section 5.
  const [tisPositionId, setTisPositionId] = useState("ALL");
  const [tisDays, setTisDays] = useState("90");
  const [tis, setTis] = useState<TimeInStageResponse | null>(null);
  const [tisLoading, setTisLoading] = useState(true);

  // Rekap bulanan (section 6) + rekap survei kandidat (section 7).
  const [monthlyReports, setMonthlyReports] = useState<MonthlyReportRow[]>([]);
  const [monthlyLoading, setMonthlyLoading] = useState(true);
  const [monthlyGenerating, setMonthlyGenerating] = useState(false);
  const [printMonth, setPrintMonth] = useState<MonthlyReportRow | null>(null);
  const [survey, setSurvey] = useState<SurveyRecapResponse | null>(null);
  const [surveyLoading, setSurveyLoading] = useState(true);

  // Ref agar handler refresh senyap selalu memakai filter posisi terbaru.
  const positionFilterRef = useRef(positionFilter);
  useEffect(() => {
    positionFilterRef.current = positionFilter;
  }, [positionFilter]);

  // Ref filter kecepatan proses agar refresh senyap selalu memakai nilai terbaru.
  const tisFilterRef = useRef({ positionId: "ALL", days: "90" });
  useEffect(() => {
    tisFilterRef.current = { positionId: tisPositionId, days: tisDays };
  }, [tisPositionId, tisDays]);

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

  const loadTimeInStage = useCallback(
    async (positionId: string, days: string, silent = false) => {
      if (!silent) setTisLoading(true);
      try {
        // buildQuery melewatkan "ALL" sehingga tanpa positionId = semua posisi.
        const res = await apiGet<TimeInStageResponse>(
          `/api/admin/reports/time-in-stage${buildQuery({ positionId, days: Number(days) })}`
        );
        setTis(res);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setTisLoading(false);
      }
    },
    [reportError]
  );

  const loadMonthly = useCallback(
    async (silent = false) => {
      if (!silent) setMonthlyLoading(true);
      try {
        const res = await apiGet<{ reports: MonthlyReportRow[] }>(
          "/api/admin/reports/monthly"
        );
        setMonthlyReports(res.reports);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setMonthlyLoading(false);
      }
    },
    [reportError]
  );

  /** Generate/perbarui snapshot untuk bulan sebelumnya, lalu muat ulang daftar. */
  const generateMonthly = useCallback(async () => {
    setMonthlyGenerating(true);
    try {
      await apiPost("/api/admin/reports/monthly", {});
      await loadMonthly(true);
      toast.success("Snapshot rekap bulanan dibuat.");
    } catch (err) {
      reportError(err);
    } finally {
      setMonthlyGenerating(false);
    }
  }, [loadMonthly, reportError]);

  const loadSurvey = useCallback(
    async (silent = false) => {
      if (!silent) setSurveyLoading(true);
      try {
        const res = await apiGet<SurveyRecapResponse>(
          "/api/admin/reports/candidate-survey"
        );
        setSurvey(res);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setSurveyLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void loadMeta(false);
    void loadFunnel("ALL", false);
    void loadSources(false);
    void loadAi(false);
    void loadTimeInStage("ALL", "90", false);
    void loadMonthly(false);
    void loadSurvey(false);
  }, []);

  useLiveRefresh("applications:changed", () => {
    void loadMeta(true);
    void loadFunnel(positionFilterRef.current, true);
    void loadSources(true);
    void loadAi(true);
    void loadTimeInStage(tisFilterRef.current.positionId, tisFilterRef.current.days, true);
    void loadSurvey(true);
  });
  useLiveRefresh("positions:changed", () => {
    void loadMeta(true);
  });

  function handlePositionChange(value: string) {
    setPositionFilter(value);
    void loadFunnel(value, false);
  }

  function handleTisPositionChange(value: string) {
    setTisPositionId(value);
    void loadTimeInStage(value, tisDays, false);
  }

  function handleTisDaysChange(value: string) {
    setTisDays(value);
    void loadTimeInStage(tisPositionId, value, false);
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

  /* --------------------------- Turunan kecepatan proses --------------------------- */

  const tisStages = tis?.stages ?? [];
  const maxTisAvg = Math.max(0, ...tisStages.map((s) => s.avgHours ?? 0));
  const tisSlowestLabel = tis?.slowestLabel ?? null;
  const tisSlowestRow = tisSlowestLabel
    ? (tisStages.find((s) => s.label === tisSlowestLabel) ?? null)
    : null;

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
            void loadTimeInStage(tisFilterRef.current.positionId, tisFilterRef.current.days, true);
            void loadMonthly(true);
            void loadSurvey(true);
          }}
          disabled={
            metaLoading ||
            funnelLoading ||
            sourcesLoading ||
            aiLoading ||
            tisLoading ||
            monthlyLoading ||
            surveyLoading
          }
          aria-label="Segarkan semua laporan"
        >
          <RefreshCw
            className={cn(
              "size-4",
              (
                metaLoading ||
                funnelLoading ||
                sourcesLoading ||
                aiLoading ||
                tisLoading ||
                monthlyLoading ||
                surveyLoading
              ) &&
                "animate-spin"
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

      {/* 5. Kecepatan proses per tahap (time-in-stage) */}
      <SectionCard
        icon={Timer}
        iconClass="text-amber-500"
        title="Kecepatan Proses"
        description="Berapa lama lamaran mengendap di tiap tahap pipeline, direkonstruksi dari riwayat perubahan status."
      >
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <div className="w-full sm:max-w-xs">
            <Select value={tisPositionId} onValueChange={handleTisPositionChange}>
              <SelectTrigger className="w-full" aria-label="Filter posisi kecepatan proses">
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
          <div className="w-full sm:max-w-44">
            <Select value={tisDays} onValueChange={handleTisDaysChange}>
              <SelectTrigger className="w-full" aria-label="Rentang waktu kecepatan proses">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 hari terakhir</SelectItem>
                <SelectItem value="90">90 hari terakhir</SelectItem>
                <SelectItem value="180">180 hari terakhir</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {tisLoading && !tis ? (
          <SectionSkeleton rows={5} />
        ) : !tis || tis.stages.length === 0 ? (
          <SectionEmpty text="Belum ada data perpindahan tahap." />
        ) : (
          <>
            {/* Kartu ringkas */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <StatCard label="Lamaran dianalisis" value={String(tis.totalApplications)} />
              <StatCard
                label={
                  tisSlowestRow
                    ? `Tahap paling lambat (rata-rata ${fmtHours(tisSlowestRow.avgHours)})`
                    : "Tahap paling lambat"
                }
                value={tis.slowestLabel ?? "-"}
                valueClass="text-lg text-rose-600 dark:text-rose-400"
              />
            </div>

            {/* Tabel per tahap (md ke atas) */}
            <div className="mt-4 hidden rounded-xl border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tahap</TableHead>
                    <TableHead className="text-right">Selesai</TableHead>
                    <TableHead className="text-right">Rata-rata</TableHead>
                    <TableHead className="text-right">Median</TableHead>
                    <TableHead className="text-right">Berjalan</TableHead>
                    <TableHead className="w-[26%]">Proporsi Durasi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tisStages.map((row) => (
                    <TableRow key={row.stage}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHours(row.avgHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtHours(row.medianHours)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.ongoing}</TableCell>
                      <TableCell>
                        <SpeedBar
                          row={row}
                          isSlowest={row.label === tis.slowestLabel}
                          maxAvg={maxTisAvg}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Kartu bertumpuk per tahap (di bawah md) */}
            <div className="mt-4 flex flex-col gap-3 md:hidden">
              {tisStages.map((row) => (
                <StageSpeedCard
                  key={row.stage}
                  row={row}
                  isSlowest={row.label === tis.slowestLabel}
                  maxAvg={maxTisAvg}
                />
              ))}
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Berjalan = lamaran yang masih berada di tahap tersebut saat laporan dibuat dan belum
              ikut dihitung pada rata-rata maupun median.
            </p>
          </>
        )}
      </SectionCard>

      {/* 6. Rekap bulanan (snapshot otomatis cron tanggal 1 + generate manual + cetak PDF) */}
      <SectionCard
        icon={CalendarDays}
        iconClass="text-rose-600"
        title="Rekap Bulanan"
        description="Snapshot statistik rekrutmen per bulan. Dibuat otomatis tanggal 1 (jam 07:00) untuk bulan sebelumnya, atau generate manual di bawah."
      >
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="h-11 sm:h-9"
            disabled={monthlyGenerating || monthlyLoading}
            onClick={() => void generateMonthly()}
          >
            {monthlyGenerating ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <CalendarDays className="size-4" aria-hidden="true" />
            )}
            Generate Rekap Bulan Lalu
          </Button>
        </div>

        {monthlyLoading && monthlyReports.length === 0 ? (
          <SectionSkeleton rows={2} />
        ) : monthlyReports.length === 0 ? (
          <SectionEmpty text="Belum ada rekap bulanan. Generate snapshot pertama dengan tombol di atas." />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {monthlyReports.map((row) => {
              const data = row.data;
              return (
                <div key={row.id} className="rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{monthLabel(row.month)}</p>
                      <p className="text-xs text-muted-foreground">
                        Snapshot dibuat {formatCreated(row.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0"
                      onClick={() => setPrintMonth(row)}
                      disabled={!data}
                    >
                      <Printer className="size-4" aria-hidden="true" />
                      Cetak PDF
                    </Button>
                  </div>
                  {data ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <MiniStat label="Lamaran masuk" value={data.newApplications} />
                        <MiniStat label="Wawancara" value={data.interviewsScheduled} />
                        <MiniStat label="Offer terkirim" value={data.offersSent} />
                        <MiniStat label="Diterima" value={data.hired} tone="emerald" />
                        <MiniStat label="Ditolak" value={data.rejected} tone="rose" />
                        <MiniStat label="Posisi aktif" value={data.activePositions} />
                        <MiniStat label="Survei diisi" value={data.surveyCount} />
                        <MiniStat
                          label="Skor survei"
                          value={data.avgSurveyScore != null ? data.avgSurveyScore : "-"}
                        />
                      </div>
                      {data.topSources.length > 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Sumber teratas:{" "}
                          {data.topSources
                            .slice(0, 3)
                            .map((s) => `${s.source} (${s.count})`)
                            .join(" · ")}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Data snapshot tidak dapat dibaca.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* 7. Rekap survei pengalaman kandidat */}
      <SectionCard
        icon={Star}
        iconClass="text-rose-600"
        title="Survei Pengalaman Kandidat"
        description="Jawaban survei 1 pertanyaan yang tautannya dikirim otomatis pada email status Diterima/Ditolak. Jawaban anonim."
      >
        {surveyLoading && !survey ? (
          <SectionSkeleton rows={3} />
        ) : !survey || survey.sent === 0 ? (
          <SectionEmpty text="Belum ada survei terkirim. Tautan survei otomatis menyertai email status Diterima/Ditolak (aktif di Setelan > Email Kandidat)." />
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatCard label="Survei terkirim" value={String(survey.sent)} />
              <StatCard label="Terjawab" value={String(survey.answered)} />
              <StatCard
                label="Skor rata-rata"
                value={survey.avgScore != null ? `${survey.avgScore}/5` : "-"}
              />
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {[5, 4, 3, 2, 1].map((score) => {
                const count = survey.distribution[score] ?? 0;
                const pct = survey.answered > 0 ? Math.round((count / survey.answered) * 100) : 0;
                return (
                  <div key={score} className="flex items-center gap-2 text-sm">
                    <span className="flex w-16 shrink-0 items-center gap-1 tabular-nums">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                      {score}
                    </span>
                    <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          score >= 4 ? "bg-emerald-500" : score === 3 ? "bg-amber-400" : "bg-rose-500"
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>

            {survey.recent.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Komentar terbaru
                </p>
                <div className="flex max-h-60 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                  {survey.recent.map((item, index) => (
                    <div key={`${item.createdAt}-${index}`} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <Star
                            className="size-3.5 fill-amber-400 text-amber-400"
                            aria-hidden="true"
                          />
                          {item.score}/5
                          {item.positionTitle ? (
                            <span className="font-normal text-muted-foreground">
                              · {item.positionTitle}
                            </span>
                          ) : null}
                        </span>
                        <span>{formatCreated(item.createdAt)}</span>
                      </div>
                      {item.comment ? (
                        <p className="mt-1 text-sm">{item.comment}</p>
                      ) : (
                        <p className="mt-1 text-xs italic text-muted-foreground">
                          Tanpa komentar
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </SectionCard>

      <ProfilePrintDialog
        key={selectedAppId || "none"}
        application={selectedApp}
        positions={positions}
        open={printOpen}
        onOpenChange={setPrintOpen}
      />

      <MonthlyPrintDialog report={printMonth} onOpenChange={(open) => !open && setPrintMonth(null)} />
    </div>
  );
}

/** Kartu angka kecil untuk ringkasan rekap bulanan. */
function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "rose" | "emerald";
}) {
  return (
    <div className="rounded-lg border p-2 text-center">
      <p
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "rose" && "text-rose-600 dark:text-rose-400",
          tone === "emerald" && "text-emerald-600 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/* --------------------------- Cetak rekap bulanan (PDF) --------------------------- */

const MONTHLY_PRINT_STYLE = `
@media print {
  html, body { height: auto !important; overflow: visible !important; }
  body * { visibility: hidden; }
  #print-area, #print-area * { visibility: visible; }
  #print-area {
    position: absolute;
    inset: 0;
    background: #ffffff;
    max-height: none;
    overflow: visible;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
  [data-slot="dialog-overlay"],
  [data-slot="dialog-content"] {
    position: static !important;
    transform: none !important;
    width: auto !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
    animation: none !important;
  }
  .print-hidden { display: none !important; }
  @page { margin: 12mm; }
}
`;

const MONTHLY_DOC_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #18181b; }
  .doc { max-width: 720px; }
  .brand { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.18em; color: #9f1239; }
  h1 { font-size: 20px; font-weight: 700; margin-top: 2px; }
  .meta { font-size: 11px; color: #71717a; margin-top: 4px; }
  .rule { border: none; border-top: 3px solid #9f1239; margin: 10px 0 16px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .stat { border: 1px solid #e4e4e7; border-radius: 8px; padding: 8px; }
  .stat .v { font-size: 20px; font-weight: 700; }
  .stat .k { font-size: 10px; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em; }
  h2 { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #9f1239; margin: 16px 0 6px; border-bottom: 1px solid #e4e4e7; padding-bottom: 3px; }
  .sources { font-size: 12px; color: #3f3f46; line-height: 1.7; }
  .footnote { margin-top: 20px; padding-top: 8px; border-top: 1px solid #f4f4f5; font-size: 10px; color: #a1a1aa; }
`;

/** Dialog cetak rekap bulanan: #print-area + window.print() (pola ProfilePrintDialog). */
function MonthlyPrintDialog({
  report,
  onOpenChange,
}: {
  report: MonthlyReportRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const data = report?.data ?? null;
  const open = Boolean(report && data);

  function handlePrint() {
    window.print();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg nice-scrollbar">
        <style>{MONTHLY_PRINT_STYLE}</style>
        <DialogHeader className="print-hidden">
          <DialogTitle>Pratinjau Cetak — Rekap Bulanan</DialogTitle>
          <DialogDescription>
            Gunakan tombol cetak, lalu pilih "Simpan sebagai PDF" pada dialog printer.
          </DialogDescription>
        </DialogHeader>

        {report && data ? (
          <div id="print-area" className="rounded-xl border bg-white p-5 text-zinc-900">
            <style>{MONTHLY_DOC_CSS}</style>
            <div className="doc">
              <div className="brand">Lumina Studio</div>
              <h1>Rekap Bulanan — {monthLabel(data.month)}</h1>
              <div className="meta">
                Snapshot: {formatCreated(report.createdAt)} · Periode {monthLabel(data.month)}
              </div>
              <hr className="rule" />
              <h2>Aktivitas Bulan Ini</h2>
              <div className="grid">
                <div className="stat">
                  <div className="v">{data.newApplications}</div>
                  <div className="k">Lamaran Masuk</div>
                </div>
                <div className="stat">
                  <div className="v">{data.interviewsScheduled}</div>
                  <div className="k">Wawancara</div>
                </div>
                <div className="stat">
                  <div className="v">{data.offersSent}</div>
                  <div className="k">Offer Terkirim</div>
                </div>
                <div className="stat">
                  <div className="v">{data.offersAccepted}</div>
                  <div className="k">Offer Diterima</div>
                </div>
                <div className="stat">
                  <div className="v">{data.hired}</div>
                  <div className="k">Diterima</div>
                </div>
                <div className="stat">
                  <div className="v">{data.rejected}</div>
                  <div className="k">Ditolak</div>
                </div>
                <div className="stat">
                  <div className="v">{data.activePositions}</div>
                  <div className="k">Posisi Aktif</div>
                </div>
                <div className="stat">
                  <div className="v">
                    {data.avgSurveyScore != null ? data.avgSurveyScore : "-"}
                  </div>
                  <div className="k">Skor Survei ({data.surveyCount})</div>
                </div>
              </div>
              <h2>Sumber Lamaran Teratas</h2>
              <div className="sources">
                {data.topSources.length > 0
                  ? data.topSources.map((s, i) => (
                      <div key={`${s.source}-${i}`}>{`${i + 1}. ${s.source} — ${s.count} lamaran`}</div>
                    ))
                  : "Tidak ada data sumber pada periode ini."}
              </div>
              <div className="footnote">
                Dokumen dihasilkan otomatis oleh Lumina Studio — dicetak{" "}
                {formatCreated(new Date().toISOString())}. Dokumen internal rekrutmen.
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="print-hidden">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          <Button onClick={handlePrint} disabled={!open}>
            <Printer className="size-4" aria-hidden="true" />
            Cetak / Simpan PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
