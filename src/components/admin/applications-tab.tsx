"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Archive,
  ArchiveRestore,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  Inbox,
  LayoutGrid,
  Loader2,
  MapPin,
  RotateCcw,
  Rows3,
  Rows4,
  Search,
  Send,
  Sparkles,
  Star,
  Table2,
  Tag,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  APPLICATION_SOURCES,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type Application,
  type KomuterPlan,
  type Position,
  type RejectionReason,
  type StageKey,
} from "@/lib/types";
import type { PaginatedApplications } from "@/lib/types";
import {
  DEFAULT_STAGES,
  OTHER_STAGE_KEY,
  isBuiltInStage,
  stageLabel,
  stagesForPosition,
} from "@/lib/stages";
import type { TalentMatchResult } from "@/lib/talent-match"; // PL-2b — tipe hasil cocok talent pool (lib murni, aman klien)
import { apiDelete, apiGet, apiPatch, apiPost, buildQuery } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { ApplicationDetailDialog } from "./application-detail-dialog";
import { ApplicationsTable } from "./applications-table";
import { KanbanBoard } from "./kanban-board";
import { ComparisonDialog } from "./comparison-dialog";
import { AiScoreBadge } from "./status-badge";
import { Reveal } from "./motion-primitives";
import { takePendingApplicationId } from "./command-palette";
import { DemoSimulatorControl } from "./demo-simulator";
import { cn } from "@/lib/utils";
// NR38-B — tampilan tersimpan, bandingkan massal, ekspor CSV, tipe baris.
import { formatDate } from "./format";
import { SavedViewsBar, type AdminFilterSnapshot } from "./saved-views";
import { CompareApplicantsDialog } from "./compare-applicants-dialog";
import { ageOf, type ApplicationRow } from "./applicant-row-types";
import type {
  TableDensity,
  HeaderSort,
  HeaderSortField,
} from "./applications-table";

const ALL = "ALL";

const FILTER_TRIGGER_CLASS = "h-10 w-full rounded-xl";

const SORT_OPTIONS = [
  { value: "newest", label: "Terbaru" },
  { value: "oldest", label: "Terlama" },
  { value: "aiScore", label: "Skor AI" },
  { value: "followup", label: "Tindak lanjut terdekat" }, // NR-24 — sort=followup (snoozeUntil asc)
] as const;

// Opsi filter rencana komuter (info kehadiran posisi on-site/hybrid).
const KOMUTER_FILTER_OPTIONS: { value: KomuterPlan; label: string }[] = [
  { value: "SIAP_KOMUTER", label: "Siap komuter" },
  { value: "PERLU_RELOKASI", label: "Perlu relokasi" },
  { value: "TIDAK", label: "Belum bisa" },
];

type ViewMode = "table" | "kanban";

// NR-41 I22 — tipe HeaderSort/HeaderSortField diimpor dari applications-table
// (menghindari impor melingkar); pembanding client-side di bawah.

/** Pembanding client-side untuk legacy mode / sort followup pada halaman. */
function compareRows(
  a: ApplicationRow,
  b: ApplicationRow,
  field: HeaderSortField,
  dir: "asc" | "desc"
): number {
  const mul = dir === "asc" ? 1 : -1;
  switch (field) {
    case "name":
      return a.name.localeCompare(b.name, "id") * mul;
    case "createdAt":
      return (
        (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * mul
      );
    case "updatedAt":
      // Aplikasi tidak membawa updatedAt di payload daftar — proxy klien:
      // perubahan tahap terakhir (stageUpdatedAt).
      return (
        (new Date(a.stageUpdatedAt ?? a.createdAt).getTime() -
          new Date(b.stageUpdatedAt ?? b.createdAt).getTime()) * mul
      );
    case "aiScore":
      return ((a.aiScore ?? -1) - (b.aiScore ?? -1)) * mul;
    case "status":
      return stageLabel(a.status).localeCompare(stageLabel(b.status), "id") * mul;
    default:
      return 0;
  }
}

/** Urutan snooze terdekat di atas (null paling bawah) — tiruan sort followup. */
function compareSnoozeAsc(a: ApplicationRow, b: ApplicationRow): number {
  const aKey = a.snoozeUntil ?? a.followUpAt ?? null;
  const bKey = b.snoozeUntil ?? b.followUpAt ?? null;
  if (aKey === bKey) return 0;
  if (!aKey) return 1;
  if (!bKey) return -1;
  return new Date(aKey).getTime() - new Date(bKey).getTime();
}

// Hasil pencarian semantik AI (POST /api/admin/applications/semantic-search).
type SemanticSearchEntryUI = { id: string; name: string; score: number; reason: string };

export function ApplicationsTab() {
  const { session, canMutate, reportError } = useAdminSession();

  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [positionFilter, setPositionFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [sort, setSort] = useState<string>("newest");
  const [ratingMin, setRatingMin] = useState<string>("");
  const [tag, setTag] = useState<string>(ALL);
  const [talentPool, setTalentPool] = useState(false);
  const [hasInterview, setHasInterview] = useState(false);
  // Filter "Ditandai" (NR-24 fitur 2): hanya lamaran yang saya beri bintang
  // (client-side memakai starredBy milik admin aktif).
  const [starredOnly, setStarredOnly] = useState(false);
  const [followupOnly, setFollowupOnly] = useState(false);
  const [holdOnly, setHoldOnly] = useState(false);
  // Filter arsip (client-side memakai field archivedAt): Semua / Aktif / Diarsip.
  const [archiveFilter, setArchiveFilter] = useState<string>("ACTIVE");
  // Filter info kehadiran (client-side, posisi on-site/hybrid): rencana komuter
  // + pencarian domisili (case-insensitive contains).
  const [komuterFilter, setKomuterFilter] = useState<string>(ALL);
  const [domisiliFilter, setDomisiliFilter] = useState<string>("");
  // NR38-B fitur 1 — filter "Belum dilihat": hanya lamaran yang belum pernah
  // dibuka admin (adminSeenAt null). Pencatatan adminSeenAt dikerjakan dialog detail.
  const [unseenOnly, setUnseenOnly] = useState(false);

  // NR-41 E1/I22 — pagination server + urutan header.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [headerSort, setHeaderSort] = useState<HeaderSort | null>(null);

  const [allTags, setAllTags] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("table");

  // NR38-B fitur 5 — kepadatan tabel (persist "lumina.admin.density").
  const [density, setDensity] = useState<TableDensity>(() => {
    if (typeof window === "undefined") return "cozy";
    try {
      return window.localStorage.getItem("lumina.admin.density") === "compact"
        ? "compact"
        : "cozy";
    } catch {
      return "cozy";
    }
  });
  // NR38-B fitur 9 — mode kartu vs tabel (persist "lumina.admin.cardMode").
  const [cardMode, setCardMode] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem("lumina.admin.cardMode") === "1";
    } catch {
      return false;
    }
  });

  const changeDensity = useCallback((next: TableDensity) => {
    setDensity(next);
    try {
      window.localStorage.setItem("lumina.admin.density", next);
    } catch {
      /* penyimpanan tidak tersedia — abaikan */
    }
  }, []);
  const changeCardMode = useCallback((next: boolean) => {
    setCardMode(next);
    try {
      window.localStorage.setItem("lumina.admin.cardMode", next ? "1" : "0");
    } catch {
      /* penyimpanan tidak tersedia — abaikan */
    }
  }, []);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState<RejectionReason | "">("");
  const [bulkRejectNote, setBulkRejectNote] = useState("");
  // Dialog "Atur Tag" massal: chip siap kirim + input tag aktif.
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [tagChips, setTagChips] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const [detail, setDetail] = useState<Application | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  // NR38-B fitur 6 — dialog bandingkan dari seleksi massal (2-3 terpilih).
  const [bulkCompareOpen, setBulkCompareOpen] = useState(false);
  // NR-28 (item 13): hormati reduced motion pada animasi bulk bar.
  const reducedMotion = useReducedMotion();

  // Deteksi duplikat: id lamaran ganda (fitur Task 20-a) untuk badge kanban.
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(new Set());

  // Pencarian semantik AI.
  const [semanticInput, setSemanticInput] = useState("");
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticOpen, setSemanticOpen] = useState(false);
  const [semanticResults, setSemanticResults] = useState<SemanticSearchEntryUI[]>([]);

  // PL-2b (butir 12) — re-engagement talent pool: cocokkan kandidat lama dengan
  // posisi target lalu kirim undangan lamar ulang.
  const [talentOpen, setTalentOpen] = useState(false);
  const [talentPositionId, setTalentPositionId] = useState("");
  const [talentLoading, setTalentLoading] = useState(false);
  const [talentMatched, setTalentMatched] = useState(false);
  const [talentMatches, setTalentMatches] = useState<TalentMatchResult[]>([]);
  const [talentChecked, setTalentChecked] = useState<Set<string>>(new Set());
  const [talentSending, setTalentSending] = useState(false);

  // Posisi terpilih menentukan opsi tahap (pipeline kustom vs bawaan).
  const selectedPosition = useMemo(
    () =>
      positionFilter !== ALL
        ? positions.find((p) => p.id === positionFilter) ?? null
        : null,
    [positions, positionFilter]
  );

  // Posisi aktif untuk target re-engagement talent pool (PL-2b).
  const activePositions = useMemo(() => positions.filter((p) => p.isActive), [positions]);

  // Opsi filter tahap: dengan posisi -> tahap milik posisi;
  // tanpa posisi -> 5 bawaan + "Lainnya" (tahap kustom, disaring client-side).
  const stageOptions = useMemo<StageKey[]>(
    () =>
      selectedPosition
        ? stagesForPosition(selectedPosition.stages)
        : [...DEFAULT_STAGES, OTHER_STAGE_KEY],
    [selectedPosition]
  );

  // Tahap nyata untuk bulk change (tanpa opsi "Lainnya").
  const bulkStageOptions = useMemo<StageKey[]>(
    () =>
      selectedPosition ? stagesForPosition(selectedPosition.stages) : [...DEFAULT_STAGES],
    [selectedPosition]
  );

  const isOtherStageFilter = statusFilter === OTHER_STAGE_KEY;

  const activeQuery = useMemo(() => {
    return buildQuery({
      q: q || undefined,
      // "Lainnya" tidak dikirim ke server: fetch tanpa filter status,
      // lalu disaring client-side (status bukan 5 bawaan).
      status:
        statusFilter !== ALL && !isOtherStageFilter ? statusFilter : undefined,
      positionId: positionFilter !== ALL ? positionFilter : undefined,
      source: sourceFilter !== ALL ? sourceFilter : undefined,
      sort: sort !== "newest" ? sort : undefined,
      ratingMin: ratingMin !== "" ? ratingMin : undefined,
      tag: tag !== ALL ? tag : undefined,
      talentPool: talentPool ? "1" : undefined,
      hasInterview: hasInterview ? "1" : undefined,
      starred: starredOnly ? "1" : undefined, // NR-24 — milik admin login (server pakai session)
      followup: followupOnly ? "1" : undefined, // NR-24 — snoozeUntil != null
      hold: holdOnly ? "1" : undefined, // NR-24 — holdReason != null
    });
  }, [
    q,
    statusFilter,
    isOtherStageFilter,
    positionFilter,
    sourceFilter,
    sort,
    ratingMin,
    tag,
    talentPool,
    hasInterview,
    starredOnly,
    followupOnly,
    holdOnly,
  ]);

  const hasActiveFilter =
    q !== "" ||
    statusFilter !== ALL ||
    positionFilter !== ALL ||
    sourceFilter !== ALL ||
    sort !== "newest" ||
    ratingMin !== "" ||
    tag !== ALL ||
    talentPool ||
    hasInterview ||
    starredOnly ||
    followupOnly ||
    holdOnly ||
    unseenOnly ||
    archiveFilter !== "ACTIVE" ||
    komuterFilter !== ALL ||
    domisiliFilter.trim() !== "" ||
    headerSort !== null;

  // ---------------------------------------------------------------------
  // NR-41 E1 — dua mode fetch daftar lamaran:
  // 1) SERVER (paginate=1): tampilan tabel tanpa filter yang hanya bisa
  //    diputuskan di klien → halaman + urutan dihitung server (envelope
  //    PaginatedApplications).
  // 2) LEGACY (array penuh): tampilan kanban ATAU filter arsip ARCHIVED/ALL,
  //    tahap "Lainnya", belum-dilihat, komuter, atau domisili — semuanya
  //    menyaring field yang tidak didukung server, sehingga butuh seluruh
  //    data untuk hasil yang benar (perilaku lama dipertahankan).
  // ---------------------------------------------------------------------
  const needsFullList =
    view !== "table" ||
    archiveFilter === "ARCHIVED" ||
    archiveFilter === "ALL" ||
    isOtherStageFilter ||
    unseenOnly ||
    komuterFilter !== ALL ||
    domisiliFilter.trim() !== "";

  // NR-41 I22 — param sort API: header sort (field:dir) lebih diutamakan,
  // lalu pemetaan nilai select lama ke format server (mode paginate hanya
  // memahami "field:dir"). followup & newest memakai urutan default server.
  const sortParam = useMemo(() => {
    if (headerSort) return `${headerSort.field}:${headerSort.dir}`;
    if (sort === "oldest") return "createdAt:asc";
    if (sort === "aiScore") return "aiScore:desc";
    return undefined;
  }, [headerSort, sort]);

  const fetchUrl = useMemo(() => {
    if (needsFullList) {
      // Mode legacy: query lama persis (server memahami sort newest/oldest/...).
      return `/api/admin/applications${activeQuery}`;
    }
    const sp = new URLSearchParams(
      activeQuery.startsWith("?") ? activeQuery.slice(1) : activeQuery
    );
    sp.set("paginate", "1");
    sp.set("page", String(page));
    sp.set("pageSize", String(pageSize));
    if (sortParam) sp.set("sort", sortParam);
    const qs = sp.toString();
    return `/api/admin/applications${qs ? `?${qs}` : ""}`;
  }, [needsFullList, activeQuery, page, pageSize, sortParam]);

  // Kembali ke halaman 1 tiap filter/urutan/ukuran halaman berubah.
  const pageResetKey = `${activeQuery}|${needsFullList ? "full" : "paged"}|${
    sortParam ?? ""
  }|${pageSize}`;
  const prevPageResetKeyRef = useRef(pageResetKey);
  useEffect(() => {
    if (prevPageResetKeyRef.current !== pageResetKey) {
      prevPageResetKeyRef.current = pageResetKey;
      setPage(1);
    }
  }, [pageResetKey]);

  const loadPositions = useCallback(async () => {
    try {
      const data = await apiGet<Position[]>("/api/admin/positions");
      setPositions(data);
    } catch {
      // Filter posisi opsional; abaikan error fetch daftar posisi.
    }
  }, []);

  const loadDuplicates = useCallback(async () => {
    try {
      const data = await apiGet<{ ids: string[] }>("/api/admin/duplicates");
      setDuplicateIds(new Set(data.ids));
    } catch {
      // Badge duplikat bersifat pelengkap; biarkan data lama saat gagal.
    }
  }, []);

  // Command palette dapat menahan id lamaran saat navigasi lintas tab (event
  // "lumina-open-application" dikirim sebelum listener tab ini terpasang).
  // Ambil id yang ditahan lalu buka detailnya bila ada di daftar yang dimuat;
  // bila tidak ada di daftar, abaikan.
  const openPendingApplication = useCallback((list: Application[]) => {
    const pendingId = takePendingApplicationId();
    if (!pendingId) return;
    const app = list.find((a) => a.id === pendingId);
    if (app) setDetail(app);
  }, []);

  // silent: refresh senyap (dipakai event realtime) — daftar lama tetap tampil
  // sampai data baru siap, tanpa skeleton ulang dan tanpa flash kosong.
  // Guard seq: respons paling baru selalu menang (mencegah balapan saat
  // filter berubah dan halaman direset dalam satu commit).
  const fetchSeqRef = useRef(0);
  const fetchUrlRef = useRef(fetchUrl);
  const loadApplications = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      const seq = ++fetchSeqRef.current;
      try {
        const url = fetchUrlRef.current;
        if (url.includes("paginate=1")) {
          const data = await apiGet<PaginatedApplications>(url);
          if (seq !== fetchSeqRef.current) return;
          const items = Array.isArray(data.items) ? (data.items as ApplicationRow[]) : [];
          setApplications(items);
          setServerTotal(data.total);
          setServerTotalPages(data.totalPages);
          openPendingApplication(items);
          // Kumpulkan tag unik untuk pilihan filter.
          setAllTags((prev) => {
            const set = new Set(prev);
            for (const app of items) for (const t of app.tags) set.add(t);
            return Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
          });
        } else {
          const data = await apiGet<ApplicationRow[]>(url);
          if (seq !== fetchSeqRef.current) return;
          setApplications(data);
          openPendingApplication(data);
          // Kumpulkan tag unik untuk pilihan filter.
          setAllTags((prev) => {
            const set = new Set(prev);
            for (const app of data) for (const t of app.tags) set.add(t);
            return Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
          });
        }
      } catch (err) {
        if (seq !== fetchSeqRef.current) return;
        reportError(err);
      } finally {
        if (seq === fetchSeqRef.current && !silent) setLoading(false);
      }
    },
    [reportError, openPendingApplication]
  );

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  useEffect(() => {
    void loadDuplicates();
  }, [loadDuplicates]);

  // Fetch daftar: effect bergantung pada URL final (filter + paginate + sort).
  // Ref diperbarui di sini agar refresh senyap realtime selalu memakai URL
  // terkini tanpa membuat loadApplications berganti identitas.
  useEffect(() => {
    fetchUrlRef.current = fetchUrl;
    void loadApplications();
  }, [fetchUrl, loadApplications]);

  // Realtime: lamaran baru/perubahan status/skor AI → segarkan daftar senyap.
  useLiveRefresh("applications:changed", () => {
    void loadApplications(true);
    void loadDuplicates();
  });
  // Posisi baru/diubah/hapus → opsi filter posisi tetap segar (senyap).
  useLiveRefresh("positions:changed", () => {
    void loadPositions();
  });

  // Command palette: buka dialog detail pelamar dari event global
  // "lumina-open-application". Detail diambil dari daftar yang sudah dimuat;
  // id yang tidak ada di daftar diabaikan.
  useEffect(() => {
    const onOpenApplication = (event: Event) => {
      const payload = (event as CustomEvent<{ id?: unknown }>).detail;
      const id = typeof payload?.id === "string" ? payload.id : "";
      if (!id) return;
      const app = applications.find((a) => a.id === id);
      if (app) setDetail(app);
    };
    window.addEventListener("lumina-open-application", onOpenApplication);
    return () =>
      window.removeEventListener("lumina-open-application", onOpenApplication);
  }, [applications]);

  function applySearch() {
    setQ(searchInput.trim());
  }

  // Saat konteks posisi berubah, buang filter tahap yang tak berlaku lagi
  // (mis. tahap kustom posisi lain atau opsi "Lainnya").
  function changePositionFilter(value: string) {
    setPositionFilter(value);
    if (value === ALL) {
      // Kembali ke semua posisi: hanya tahap bawaan yang tetap berlaku.
      if (statusFilter !== ALL && !isBuiltInStage(statusFilter)) {
        setStatusFilter(ALL);
      }
      return;
    }
    const position = positions.find((p) => p.id === value);
    const options = position ? stagesForPosition(position.stages) : [];
    if (statusFilter !== ALL && !options.includes(statusFilter)) {
      setStatusFilter(ALL);
    }
  }

  function resetFilters() {
    setSearchInput("");
    setQ("");
    setStatusFilter(ALL);
    setPositionFilter(ALL);
    setSourceFilter(ALL);
    setSort("newest");
    setRatingMin("");
    setTag(ALL);
    setTalentPool(false);
    setHasInterview(false);
    setStarredOnly(false);
    setFollowupOnly(false);
    setHoldOnly(false);
    setUnseenOnly(false);
    setArchiveFilter("ACTIVE");
    setKomuterFilter(ALL);
    setDomisiliFilter("");
    setHeaderSort(null);
  }

  // NR38-B fitur 2 — snapshot filter aktif utk tampilan tersimpan.
  const currentSnapshot = useMemo<AdminFilterSnapshot>(
    () => ({
      q: q || undefined,
      status: statusFilter !== ALL ? statusFilter : undefined,
      positionId: positionFilter !== ALL ? positionFilter : undefined,
      source: sourceFilter !== ALL ? sourceFilter : undefined,
      sort: sort !== "newest" ? sort : undefined,
      ratingMin: ratingMin && ratingMin !== "all-rating" ? ratingMin : undefined,
      tag: tag !== ALL ? tag : undefined,
      talentPool: talentPool || undefined,
      hasInterview: hasInterview || undefined,
      starred: starredOnly || undefined,
      followup: followupOnly || undefined,
      hold: holdOnly || undefined,
      unseen: unseenOnly || undefined,
      archive: archiveFilter !== "ACTIVE" ? archiveFilter : undefined,
      komuter: komuterFilter !== ALL ? komuterFilter : undefined,
      domisili: domisiliFilter.trim() || undefined,
    }),
    [
      q,
      statusFilter,
      positionFilter,
      sourceFilter,
      sort,
      ratingMin,
      tag,
      talentPool,
      hasInterview,
      starredOnly,
      followupOnly,
      holdOnly,
      unseenOnly,
      archiveFilter,
      komuterFilter,
      domisiliFilter,
    ]
  );

  // Terapkan snapshot tampilan tersimpan ke seluruh state filter.
  function applySnapshot(filters: AdminFilterSnapshot) {
    setSearchInput(filters.q ?? "");
    setQ(filters.q ?? "");
    setStatusFilter(filters.status ?? ALL);
    setPositionFilter(filters.positionId ?? ALL);
    setSourceFilter(filters.source ?? ALL);
    setSort(filters.sort ?? "newest");
    setRatingMin(filters.ratingMin ?? "");
    setTag(filters.tag ?? ALL);
    setTalentPool(filters.talentPool ?? false);
    setHasInterview(filters.hasInterview ?? false);
    setStarredOnly(filters.starred ?? false);
    setFollowupOnly(filters.followup ?? false);
    setHoldOnly(filters.hold ?? false);
    setUnseenOnly(filters.unseen ?? false);
    setArchiveFilter(filters.archive ?? "ACTIVE");
    setKomuterFilter(filters.komuter ?? ALL);
    setDomisiliFilter(filters.domisili ?? "");
    setHeaderSort(null);
  }

  // NR-41 I22 — klik header: siklus desc → asc → netral.
  function cycleHeaderSort(field: HeaderSortField) {
    setHeaderSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: "desc" };
      if (prev.dir === "desc") return { field, dir: "asc" };
      return null;
    });
  }

  // NR-41 E1 — ganti ukuran halaman (25/50/100); reset halaman lewat efek.
  function changePageSize(next: number) {
    setPageSize(next);
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Lamaran tampil: tanpa yang di tong sampah (soft delete — pemulihan di tab
  // Data), mengikuti filter arsip (archivedAt), dan dengan filter "Lainnya"
  // menyisakan yang tahapnya di luar 5 bawaan. Baris yang diarsip tetap bisa
  // dipilih/dilepas dari seleksi massal seperti baris biasa.
  const displayedApplications = useMemo(() => {
    let list = applications.filter((a) => !a.deletedAt);
    if (archiveFilter === "ACTIVE") {
      list = list.filter((a) => !a.archivedAt);
    } else if (archiveFilter === "ARCHIVED") {
      list = list.filter((a) => a.archivedAt);
    }
    if (isOtherStageFilter) {
      list = list.filter((a) => !isBuiltInStage(a.status));
    }
    // Filter info kehadiran (on-site/hybrid): rencana komuter + domisili.
    if (komuterFilter !== ALL) {
      list = list.filter((a) => a.komuterPlan === komuterFilter);
    }
    const domisiliQuery = domisiliFilter.trim().toLowerCase();
    if (domisiliQuery) {
      list = list.filter((a) => (a.domisili ?? "").toLowerCase().includes(domisiliQuery));
    }
    // Filter "Ditandai" (NR-24 fitur 2): bintang bersifat personal per admin.
    if (starredOnly) {
      list = list.filter((a) => a.starredBy?.includes(session.id) ?? false);
    }
    // NR38-B fitur 1 — filter "Belum dilihat": adminSeenAt masih null.
    if (unseenOnly) {
      list = list.filter((a) => !a.adminSeenAt);
    }
    // NR-41 I22 — sort client-side:
    // - legacy mode + header sort → urutkan seluruh daftar di klien
    //   (server legacy tidak memahami format "field:dir");
    // - server mode + sort "followup" → urutkan halaman ini berdasarkan
    //   snooze terdekat (sort snooze tidak didukung parseSortedOrderBy server).
    if (needsFullList) {
      if (headerSort) {
        list = [...list].sort((a, b) =>
          compareRows(a, b, headerSort.field, headerSort.dir)
        );
      }
    } else if (!headerSort && sort === "followup") {
      list = [...list].sort(compareSnoozeAsc);
    }
    return list;
  }, [
    applications,
    archiveFilter,
    isOtherStageFilter,
    komuterFilter,
    domisiliFilter,
    starredOnly,
    unseenOnly,
    session.id,
    needsFullList,
    headerSort,
    sort,
  ]);

  // NR-41 E1 — baris halaman untuk tabel: server mode = halaman dari API;
  // legacy mode = potongan dari daftar penuh hasil filter.
  const pageRows = useMemo(() => {
    if (!needsFullList) return displayedApplications;
    const start = (page - 1) * pageSize;
    return displayedApplications.slice(start, start + pageSize);
  }, [needsFullList, displayedApplications, page, pageSize]);

  const paginationTotal = needsFullList
    ? displayedApplications.length
    : serverTotal;
  const paginationTotalPages = needsFullList
    ? Math.max(1, Math.ceil(displayedApplications.length / pageSize))
    : serverTotalPages;

  // NR38-B fitur 1 — hitung lamaran yang belum dilihat admin (adminSeenAt kosong).
  const unseenCount = useMemo(
    () => applications.filter((a) => !a.deletedAt && !a.adminSeenAt).length,
    [applications]
  );

  // Jumlah lamaran terarsip (untuk keterangan kecil pada baris filter).
  const archivedCount = useMemo(
    () => applications.filter((a) => a.archivedAt).length,
    [applications]
  );

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const app of displayedApplications) next.add(app.id);
      } else {
        for (const app of displayedApplications) next.delete(app.id);
      }
      return next;
    });
  }

  function toggleCompare(app: Application) {
    setCompareIds((prev) => {
      if (prev.includes(app.id)) {
        return prev.filter((id) => id !== app.id);
      }
      if (prev.length >= 3) {
        toast.info("Maksimal 3 kandidat — kandidat pertama diganti.");
        return [...prev.slice(1), app.id];
      }
      return [...prev, app.id];
    });
  }

  function updateAppInList(updated: Application) {
    // NR38-B — merge (bukan replace): respons PATCH tidak membawa field tambahan
    // NR38-B (adminSeenAt/snoozeUntil/gaji posisi) sehingga dipertahankan dari
    // baris lama; field inti tetap terganti dari respons terbaru.
    setApplications((prev) =>
      prev.map((a) =>
        a.id === updated.id ? ({ ...a, ...updated } as ApplicationRow) : a
      )
    );
    setDetail((prev) =>
      prev && prev.id === updated.id
        ? ({ ...prev, ...updated } as ApplicationRow)
        : prev
    );
  }

  // Toggle bintang personal per admin (NR-24 fitur 2): update optimistik,
  // PATCH {star} ke server, lalu sinkron dari respons. Revert + laporkan bila gagal.
  function handleToggleStar(app: Application) {
    const isStarred = app.starredBy?.includes(session.id) ?? false;
    const previous = applications;
    setApplications((prev) =>
      prev.map((a) =>
        a.id === app.id
          ? {
              ...a,
              starredBy: isStarred
                ? (a.starredBy ?? []).filter((id) => id !== session.id)
                : [...(a.starredBy ?? []), session.id],
            }
          : a
      )
    );
    apiPatch<Application>(`/api/admin/applications/${app.id}`, { star: !isStarred })
      .then((updated) => {
        updateAppInList(updated);
      })
      .catch((err) => {
        setApplications(previous);
        reportError(err);
      });
  }

  async function handleRate(app: Application, rating: number) {
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { rating }
      );
      toast.success(`Rating disimpan (${rating}/5)`);
      updateAppInList(updated);
    } catch (err) {
      reportError(err);
    }
  }

  // Pindah kolom kanban: optimistik + PATCH, revert bila gagal.
  function handleKanbanMove(id: string, status: StageKey) {
    const previous = applications;
    const target = stageLabel(status);
    setApplications((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );
    apiPatch<Application>(`/api/admin/applications/${id}`, { status })
      .then((updated) => {
        toast.success(`Status diubah ke ${target}`);
        updateAppInList(updated);
      })
      .catch((err) => {
        setApplications(previous);
        reportError(err);
      });
  }

  async function runBulk(body: Record<string, unknown>, successMessage: string) {
    if (bulkWorking) return;
    setBulkWorking(true);
    try {
      const res = await apiPost<{ ok: boolean; affected: number }>(
        "/api/admin/applications/bulk",
        body
      );
      toast.success(successMessage.replace("{n}", String(res.affected)));
      setSelectedIds(new Set());
      setBulkStatus("");
      // Refresh senyap (tanpa skeleton) agar baris terlihat berubah mulus.
      await loadApplications(true);
    } catch (err) {
      reportError(err);
    } finally {
      setBulkWorking(false);
      setBulkDeleteOpen(false);
    }
  }

  // Tolak massal dengan alasan terstruktur (POST /api/admin/applications/bulk).
  async function handleBulkReject() {
    if (!bulkRejectReason) {
      toast.error("Pilih alasan penolakan terlebih dahulu.");
      return;
    }
    await runBulk(
      {
        ids: Array.from(selectedIds),
        action: "reject",
        reason: bulkRejectReason,
        note: bulkRejectNote.trim() || undefined,
      },
      "{n} lamaran ditolak"
    );
    setBulkRejectOpen(false);
    setBulkRejectReason("");
    setBulkRejectNote("");
  }

  // Tambah tag dari input (pisahkan koma untuk beberapa sekaligus).
  function addTagsFromInput() {
    const parts = tagInput
      .split(",")
      .map((part) => part.trim().slice(0, 24))
      .filter((part) => part.length > 0);
    if (parts.length === 0) return;
    setTagChips((prev) => {
      const next = [...prev];
      for (const part of parts) {
        if (!next.includes(part)) next.push(part);
      }
      return next.slice(0, 12);
    });
    setTagInput("");
  }

  // Simpan tag massal (POST /api/admin/applications/bulk action "tag").
  async function handleBulkTag() {
    if (tagChips.length === 0) {
      toast.error("Tulis minimal satu tag.");
      return;
    }
    await runBulk(
      { ids: Array.from(selectedIds), action: "tag", tags: tagChips },
      "Tag {n} lamaran diperbarui"
    );
    setBulkTagOpen(false);
    setTagChips([]);
    setTagInput("");
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(
        `/api/admin/applications/${deleteTarget.id}`
      );
      toast.success("Lamaran dihapus");
      setApplications((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDetail(null);
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  // Pencarian semantik AI (fitur Task 20-a): kueri bebas -> top 10 kandidat.
  async function runSemanticSearch() {
    const query = semanticInput.trim();
    if (semanticLoading) return;
    if (query.length < 3) {
      toast.error("Tulis kueri minimal 3 karakter.");
      return;
    }
    setSemanticLoading(true);
    toast.loading("AI mencari kandidat...", { id: "semantic-search" });
    try {
      const res = await apiPost<{ results: SemanticSearchEntryUI[] }>(
        "/api/admin/applications/semantic-search",
        { query }
      );
      setSemanticResults(res.results);
      setSemanticOpen(true);
      if (res.results.length === 0) {
        toast.info("Tidak ada kandidat yang cocok dengan kueri.", { id: "semantic-search" });
      } else {
        toast.success(`${res.results.length} kandidat ditemukan`, { id: "semantic-search" });
      }
    } catch (err) {
      toast.dismiss("semantic-search");
      reportError(err);
    } finally {
      setSemanticLoading(false);
    }
  }

  // PL-2b (butir 12) — re-engagement talent pool.
  function openTalentDialog() {
    setTalentPositionId("");
    setTalentMatched(false);
    setTalentMatches([]);
    setTalentChecked(new Set());
    setTalentOpen(true);
  }

  async function runTalentMatch() {
    if (!talentPositionId || talentLoading) return;
    setTalentLoading(true);
    try {
      const res = await apiGet<{
        position: { id: string; title: string; slug: string | null };
        matches: TalentMatchResult[];
      }>(`/api/admin/talent-pool?positionId=${encodeURIComponent(talentPositionId)}`);
      setTalentMatches(res.matches);
      setTalentMatched(true);
      // Default: semua kandidat hasil cocok tercentang.
      setTalentChecked(new Set(res.matches.map((m) => m.applicationId)));
      if (res.matches.length > 0) {
        toast.success(`${res.matches.length} kandidat lama cocok`);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setTalentLoading(false);
    }
  }

  function toggleTalentCandidate(id: string, checked: boolean) {
    setTalentChecked((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function sendTalentInvites() {
    if (talentSending || !talentPositionId || talentChecked.size === 0) return;
    setTalentSending(true);
    try {
      const res = await apiPost<{
        sent: number;
        skipped: { applicationId: string; name: string; reason: string }[];
      }>("/api/admin/talent-pool", {
        positionId: talentPositionId,
        applicationIds: Array.from(talentChecked),
      });
      const skippedNote = res.skipped
        .map((s) => `${s.name || "Kandidat"} — ${s.reason}`)
        .join("; ");
      if (res.sent > 0 && res.skipped.length === 0) {
        toast.success(`Undangan talent pool terkirim (${res.sent} kandidat)`);
      } else if (res.sent > 0) {
        toast.success(`Undangan terkirim (${res.sent} kandidat). Dilewati: ${skippedNote}`);
      } else {
        toast.info(`Tidak ada undangan terkirim. Dilewati: ${skippedNote}`);
      }
      setTalentOpen(false);
      setTalentMatches([]);
      setTalentChecked(new Set());
      setTalentMatched(false);
    } catch (err) {
      reportError(err);
    } finally {
      setTalentSending(false);
    }
  }

  // NR38-B fitur 10 — ekspor CSV sisi klien: baris terpilih bila ada, kalau
  // tidak semua baris yang lolos filter aktif. BOM + delimiter ";" + escaping.
  function exportCsv() {
    const rows =
      selectedIds.size > 0
        ? displayedApplications.filter((a) => selectedIds.has(a.id))
        : displayedApplications;
    if (rows.length === 0) {
      toast.info("Tidak ada baris untuk diekspor.");
      return;
    }
    const header = [
      "Nama",
      "Email",
      "Telepon",
      "Posisi",
      "Tahap",
      "Skor AI",
      "Rating",
      "Gaji Harapan",
      "Domisili",
      "Umur",
      "NIK",
      "Sumber",
      "Tanggal Daftar",
      "Kode Pelacakan",
      "Tag",
    ];
    // Escape: bungkus kutip bila berisi delimiter/kutip/garis baru; kutip digandakan.
    const escapeCell = (value: string) =>
      /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const lines = [header.join(";")];
    for (const a of rows) {
      lines.push(
        [
          a.name,
          a.email,
          a.phone ?? "",
          a.positionTitle ?? "",
          stageLabel(a.status),
          a.aiScore == null ? "" : String(a.aiScore),
          String(a.rating ?? 0),
          a.salaryExpectation == null ? "" : String(a.salaryExpectation),
          a.domisili ?? "",
          ageOf(a.birthDate) ?? "",
          a.nik ?? "",
          a.source ?? "",
          formatDate(a.createdAt),
          a.trackingCode ?? "",
          a.tags.join(", "),
        ]
          .map(escapeCell)
          .join(";")
      );
    }
    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
    const link = document.createElement("a");
    link.href = url;
    link.download = `lamaran-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success(`CSV diekspor (${rows.length} baris)`);
  }

  const comparedApps = useMemo(
    () =>
      compareIds
        .map((id) => displayedApplications.find((a) => a.id === id))
        .filter((a): a is Application => Boolean(a)),
    [compareIds, displayedApplications]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar filter */}
      <div className="flex flex-col gap-3">
        {/* NR38-B fitur 2 — baris chip tampilan tersimpan, di atas bar filter. */}
        <SavedViewsBar currentSnapshot={currentSnapshot} onApply={applySnapshot} />

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              onBlur={applySearch}
              placeholder="Cari nama atau email..."
              aria-label="Cari nama atau email pelamar"
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Toggle tampilan */}
            <div className="flex items-center gap-1 rounded-xl border p-1">
              <Button
                variant={view === "table" ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-8", view === "table" && "shadow-xs")}
                onClick={() => setView("table")}
                aria-pressed={view === "table"}
              >
                <Table2 className="size-4" aria-hidden="true" />
                Tabel
              </Button>
              <Button
                variant={view === "kanban" ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-8", view === "kanban" && "shadow-xs")}
                onClick={() => setView("kanban")}
                aria-pressed={view === "kanban"}
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
                Kanban
              </Button>
            </div>
            {/* NR38-B fitur 5+9 — kepadatan tabel & mode kartu (hanya saat tampilan tabel). */}
            {view === "table" ? (
              <>
                <div
                  className="flex items-center gap-1 rounded-xl border p-1"
                  role="group"
                  aria-label="Kepadatan tabel"
                >
                  <Button
                    variant={density === "compact" ? "secondary" : "ghost"}
                    size="icon"
                    className={cn("size-8", density === "compact" && "shadow-xs")}
                    onClick={() => changeDensity("compact")}
                    aria-pressed={density === "compact"}
                    aria-label="Tabel padat"
                    title="Tabel padat — padding rapat, kolom ringkas"
                  >
                    <Rows3 className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant={density === "cozy" ? "secondary" : "ghost"}
                    size="icon"
                    className={cn("size-8", density === "cozy" && "shadow-xs")}
                    onClick={() => changeDensity("cozy")}
                    aria-pressed={density === "cozy"}
                    aria-label="Tabel nyaman"
                    title="Tabel nyaman — padding lega, semua kolom"
                  >
                    <Rows4 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div
                  className="flex items-center gap-1 rounded-xl border p-1"
                  role="group"
                  aria-label="Mode daftar"
                >
                  <Button
                    variant={!cardMode ? "secondary" : "ghost"}
                    size="icon"
                    className={cn("size-8", !cardMode && "shadow-xs")}
                    onClick={() => changeCardMode(false)}
                    aria-pressed={!cardMode}
                    aria-label="Tampilan tabel"
                    title="Tampilan tabel"
                  >
                    <Table2 className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant={cardMode ? "secondary" : "ghost"}
                    size="icon"
                    className={cn("size-8", cardMode && "shadow-xs")}
                    onClick={() => changeCardMode(true)}
                    aria-pressed={cardMode}
                    aria-label="Tampilan kartu"
                    title="Tampilan kartu"
                  >
                    <LayoutGrid className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </>
            ) : null}
            {/* NR38-B fitur 10 — ekspor CSV klien: terpilih bila ada, selain itu filter aktif. */}
            <Button
              variant="outline"
              className="h-10 rounded-xl"
              onClick={exportCsv}
              aria-label="Ekspor CSV (baris terpilih bila ada, selain itu hasil filter aktif)"
              title="Ekspor CSV — baris terpilih bila ada, selain itu hasil filter aktif"
            >
              <Download className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Ekspor CSV</span>
            </Button>
            {/* Ekspor: dropdown CSV / Excel XLSX (NR-19-b) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-10 rounded-xl"
                  aria-label="Ekspor daftar lamaran"
                >
                  <Download className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Ekspor</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem asChild>
                  <a
                    href={`/api/admin/applications/export${activeQuery}`}
                    download
                    aria-label="Unduh CSV"
                  >
                    <FileText className="size-4" aria-hidden="true" />
                    Unduh CSV
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href={`/api/admin/applications/export${activeQuery}${activeQuery ? "&" : "?"}format=xlsx`}
                    download
                    aria-label="Unduh Excel (XLSX)"
                  >
                    <FileSpreadsheet className="size-4" aria-hidden="true" />
                    Unduh Excel (XLSX)
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* PL-2b (butir 12) — re-engagement talent pool: undang kandidat lama */}
            {canMutate ? (
              <Button
                variant="outline"
                className="h-10 rounded-xl"
                onClick={openTalentDialog}
                aria-label="Cari kandidat talent pool untuk posisi target"
                title="Cari Kandidat Talent Pool — cocokkan kandidat lama dengan posisi aktif lalu kirim undangan lamar ulang"
              >
                <Users className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">Cari Kandidat Talent Pool</span>
              </Button>
            ) : null}
            {/* Simulator Pelamar Demo: lamaran lengkap masuk otomatis tiap beberapa detik */}
            <DemoSimulatorControl positions={positions} />
          </div>
        </div>

        {/* Pencarian semantik AI (fitur Task 20-a): kueri bebas, AI memilih kandidat. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Sparkles
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-rose-500"
              aria-hidden="true"
            />
            <Input
              value={semanticInput}
              onChange={(e) => setSemanticInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSemanticSearch();
              }}
              placeholder={'Cari dengan AI — mis. "editor yang kuat di motion graphics dan pernah di agensi"'}
              aria-label="Cari kandidat dengan AI"
              maxLength={300}
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <Button
            className="h-10 rounded-xl active:scale-[0.99]"
            onClick={() => void runSemanticSearch()}
            disabled={semanticLoading}
          >
            {semanticLoading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            Cari dengan AI
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter tahap">
              <SelectValue placeholder="Semua Tahap" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Tahap</SelectItem>
              {stageOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === OTHER_STAGE_KEY ? "Lainnya (tahap kustom)" : stageLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={positionFilter}
            onValueChange={changePositionFilter}
          >
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter posisi">
              <SelectValue placeholder="Semua Posisi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Posisi</SelectItem>
              {positions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter sumber pelamar">
              <SelectValue placeholder="Semua Sumber" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Sumber</SelectItem>
              {APPLICATION_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* NR-41 I22 — nilai kustom saat urutan diatur dari header tabel. */}
          <Select
            value={headerSort ? "__custom" : sort}
            onValueChange={(v) => {
              setSort(v);
              setHeaderSort(null);
            }}
          >
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Urutkan">
              <SelectValue placeholder="Urutkan" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
              {headerSort ? (
                <SelectItem value="__custom" disabled>
                  Urutan kolom (klik header tabel)
                </SelectItem>
              ) : null}
            </SelectContent>
          </Select>

          <Select value={ratingMin} onValueChange={setRatingMin}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter rating minimum">
              <SelectValue placeholder="Semua Rating" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-rating">Semua Rating</SelectItem>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Rating &#8805; {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={tag === ALL ? "all-tag" : tag}
            onValueChange={(v) => setTag(v === "all-tag" ? ALL : v)}
          >
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter tag">
              <SelectValue placeholder="Semua Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-tag">Semua Tag</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={archiveFilter} onValueChange={setArchiveFilter}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter status arsip">
              <SelectValue placeholder="Aktif" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Aktif</SelectItem>
              <SelectItem value="ARCHIVED">Diarsip</SelectItem>
              <SelectItem value="ALL">Semua</SelectItem>
            </SelectContent>
          </Select>

          <Select value={komuterFilter} onValueChange={setKomuterFilter}>
            <SelectTrigger
              className={FILTER_TRIGGER_CLASS}
              aria-label="Filter rencana komuter"
            >
              <SelectValue placeholder="Semua Komuter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Komuter</SelectItem>
              {KOMUTER_FILTER_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <MapPin
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={domisiliFilter}
              onChange={(e) => setDomisiliFilter(e.target.value)}
              placeholder="Filter domisili..."
              aria-label="Filter domisili pelamar"
              maxLength={80}
              className={cn(FILTER_TRIGGER_CLASS, "pl-9")}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch
              checked={talentPool}
              onCheckedChange={setTalentPool}
              aria-label="Filter Talent Pool"
            />
            Talent Pool
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch
              checked={hasInterview}
              onCheckedChange={setHasInterview}
              aria-label="Filter ada jadwal wawancara"
            />
            Ada Jadwal Wawancara
          </label>
          {/* Toggle "Ditandai" (NR-24 fitur 2): hanya lamaran berbintang milik saya. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-9 rounded-xl",
              starredOnly &&
                "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900/60"
            )}
            onClick={() => setStarredOnly((v) => !v)}
            aria-pressed={starredOnly}
            aria-label="Hanya tampilkan lamaran yang saya tandai"
          >
            <Star
              className={cn(
                "size-4",
                starredOnly ? "fill-amber-400 text-amber-500" : "text-muted-foreground"
              )}
              aria-hidden="true"
            />
            Ditandai
          </Button>
          {/* NR38-B fitur 1 — chip filter "Belum dilihat" + hitungan. */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-9 rounded-xl",
              unseenOnly &&
                "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400 dark:hover:bg-rose-900/60"
            )}
            onClick={() => setUnseenOnly((v) => !v)}
            aria-pressed={unseenOnly}
            aria-label="Hanya tampilkan lamaran yang belum dilihat"
          >
            <EyeOff
              className={cn(
                "size-4",
                unseenOnly ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
              )}
              aria-hidden="true"
            />
            Belum dilihat ({unseenCount})
          </Button>
          {hasActiveFilter ? (
            <Button
              variant="outline"
              onClick={resetFilters}
              className="h-9 rounded-xl"
              aria-label="Reset filter"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Reset Filter
            </Button>
          ) : null}
          <p className="ml-auto text-xs text-muted-foreground">
            {loading
              ? "Memuat..."
              : `${paginationTotal} lamaran ditampilkan${
                  archiveFilter === "ALL" && archivedCount > 0
                    ? ` · ${archivedCount} diarsip`
                    : ""
                }`}
          </p>
        </div>
      </div>

      {/* Loading — skeleton hanya saat pemuatan pertama (belum ada data); saat
          refresh (filter/event realtime) daftar lama tetap tampil. */}
      {loading && applications.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : paginationTotal === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada lamaran yang cocok dengan filter.
            </p>
          </CardContent>
        </Card>
      ) : view === "table" ? (
        <ApplicationsTable
          applications={pageRows}
          positions={positions}
          canMutate={canMutate}
          currentUserId={session.id}
          onToggleStar={handleToggleStar}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          compareIds={compareIds}
          onToggleCompare={toggleCompare}
          onOpenDetail={setDetail}
          onDeleteRequest={setDeleteTarget}
          onRate={(app, rating) => void handleRate(app, rating)}
          density={density}
          cardMode={cardMode}
          page={page}
          pageSize={pageSize}
          total={paginationTotal}
          totalPages={paginationTotalPages}
          onPageChange={setPage}
          onPageSizeChange={changePageSize}
          headerSort={headerSort}
          onHeaderSortToggle={cycleHeaderSort}
        />
      ) : (
        <KanbanBoard
          apps={displayedApplications}
          canMutate={canMutate}
          stages={selectedPosition?.stages}
          hasPositionFilter={positionFilter !== ALL}
          duplicateIds={duplicateIds}
          onMove={handleKanbanMove}
          onOpenDetail={setDetail}
          onUpdated={updateAppInList}
        />
      )}

      {/* NR-28 (item 13): bar aksi massal melayang di bawah layar. Posisi
          terpusat (setara fixed left-1/2 -translate-x-1/2) dicapai dengan
          flex justify-center agar tidak bentrok dengan transform
          framer-motion. Mobile: melebar penuh + jarak aman safe-area.
          Animasi slide-up via AnimatePresence; reduced motion = fade saja. */}
      <AnimatePresence>
        {canMutate && selectedIds.size > 0 ? (
          <div
            key="bulk-bar"
            className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pb-4"
          >
            <motion.div
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="pointer-events-auto w-full sm:w-auto sm:max-w-[calc(100vw-2rem)]"
            >
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/95 p-3 shadow-lg backdrop-blur dark:border-rose-900 dark:bg-rose-950/90">
                <span className="text-sm font-semibold">
                  {selectedIds.size} lamaran dipilih
                </span>
                <Select value={bulkStatus || "bulk-empty"} onValueChange={setBulkStatus}>
                  <SelectTrigger
                    className="h-9 w-full rounded-lg bg-background sm:w-48"
                    aria-label="Ubah tahap terpilih"
                  >
                    <SelectValue placeholder="Ubah tahap ke..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bulk-empty" disabled>
                      Ubah tahap ke...
                    </SelectItem>
                    {bulkStageOptions.map((s) => (
                      <SelectItem key={s} value={s}>
                        {stageLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-9 active:scale-[0.99]"
                  disabled={!bulkStatus || bulkWorking}
                  onClick={() =>
                    void runBulk(
                      { ids: Array.from(selectedIds), action: "status", status: bulkStatus },
                      "{n} lamaran diperbarui"
                    )
                  }
                >
                  {bulkWorking ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Terapkan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 bg-background"
                  disabled={bulkWorking}
                  onClick={() =>
                    void runBulk(
                      { ids: Array.from(selectedIds), action: "talentPool", talentPool: true },
                      "{n} lamaran masuk Talent Pool"
                    )
                  }
                >
                  Talent Pool
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 bg-background"
                  disabled={bulkWorking}
                  onClick={() => {
                    setTagChips([]);
                    setTagInput("");
                    setBulkTagOpen(true);
                  }}
                >
                  <Tag className="size-4" aria-hidden="true" />
                  Atur Tag
                </Button>
                {/* NR38-B fitur 6 — bandingkan 2-3 pelamar terpilih berdampingan. */}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 bg-background"
                  disabled={selectedIds.size < 2 || selectedIds.size > 3 || bulkWorking}
                  title={
                    selectedIds.size < 2 || selectedIds.size > 3
                      ? "Pilih tepat 2-3 lamaran untuk dibandingkan"
                      : "Bandingkan lamaran terpilih berdampingan"
                  }
                  onClick={() => setBulkCompareOpen(true)}
                >
                  <LayoutGrid className="size-4" aria-hidden="true" />
                  Bandingkan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 bg-background"
                  disabled={bulkWorking}
                  onClick={() =>
                    void runBulk(
                      { ids: Array.from(selectedIds), action: "archive" },
                      "{n} lamaran diarsipkan"
                    )
                  }
                >
                  <Archive className="size-4" aria-hidden="true" />
                  Arsipkan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 bg-background"
                  disabled={bulkWorking}
                  onClick={() =>
                    void runBulk(
                      { ids: Array.from(selectedIds), action: "unarchive" },
                      "{n} lamaran dikeluarkan dari arsip"
                    )
                  }
                >
                  <ArchiveRestore className="size-4" aria-hidden="true" />
                  Batalkan Arsip
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 border-rose-200 bg-background text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                  disabled={bulkWorking}
                  onClick={() => setBulkRejectOpen(true)}
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  Tolak
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-9"
                  disabled={bulkWorking}
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Hapus
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setSelectedIds(new Set())}
                  disabled={bulkWorking}
                >
                  Batal
                </Button>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Bar perbandingan melayang — naik di atas bulk bar (desktop) dan
          disembunyikan di mobile saat seleksi massal aktif agar tidak tumpuk. */}
      {comparedApps.length > 0 && !compareOpen ? (
        <div
          className={cn(
            "pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4",
            canMutate && selectedIds.size > 0
              ? "bottom-4 max-sm:hidden sm:bottom-44"
              : "bottom-4"
          )}
        >
          <Reveal
            slideY={10}
            duration={0.25}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="pointer-events-auto"
          >
            <Button
              className="h-11 rounded-full px-5 shadow-lg"
              onClick={() => setCompareOpen(true)}
              aria-label={`Bandingkan ${comparedApps.length} kandidat`}
            >
              Bandingkan ({comparedApps.length})
            </Button>
          </Reveal>
        </div>
      ) : null}

      <ComparisonDialog
        apps={compareOpen ? comparedApps : []}
        onOpenChange={setCompareOpen}
      />

      {/* NR38-B fitur 6 — bandingkan dari seleksi massal (2-3 lamaran). */}
      <CompareApplicantsDialog
        apps={
          bulkCompareOpen
            ? Array.from(selectedIds)
                .map((id) => displayedApplications.find((a) => a.id === id))
                .filter((a): a is ApplicationRow => Boolean(a))
            : []
        }
        open={bulkCompareOpen}
        onOpenChange={setBulkCompareOpen}
        currentUserId={session.id}
      />

      {/* Dialog hasil pencarian semantik AI */}
      <Dialog open={semanticOpen} onOpenChange={setSemanticOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-rose-600" aria-hidden="true" />
              Hasil Pencarian AI
            </DialogTitle>
            <DialogDescription>
              Kandidat paling cocok dengan kueri Anda, dinilai AI (0-100).
            </DialogDescription>
          </DialogHeader>
          {semanticResults.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Tidak ada kandidat yang cocok dengan kueri.
            </p>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
              {semanticResults.map((entry, index) => {
                const app = applications.find((a) => a.id === entry.id);
                return (
                  <div key={entry.id} className="flex flex-col gap-1.5 rounded-xl border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                        aria-label={`Peringkat ${index + 1}`}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{entry.name}</span>
                      <AiScoreBadge score={entry.score} />
                    </div>
                    <p className="text-xs text-muted-foreground">{entry.reason}</p>
                    {app ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-fit"
                        onClick={() => {
                          setSemanticOpen(false);
                          setDetail(app);
                        }}
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                        Buka Detail Kandidat
                      </Button>
                    ) : (
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Kandidat tidak ada di daftar yang sedang ditampilkan — sesuaikan filter untuk membuka detailnya.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* PL-2b (butir 12) — dialog re-engagement talent pool */}
      <Dialog open={talentOpen} onOpenChange={setTalentOpen}>
        <DialogContent className="rounded-2xl sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="size-4 text-rose-600" aria-hidden="true" />
              Cari Kandidat Talent Pool
            </DialogTitle>
            <DialogDescription>
              Cocokkan kandidat lama (ditolak, ditahan, atau ditandai talent pool)
              dengan posisi target, lalu kirim undangan untuk melamar ulang.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="talent-position">Posisi target</Label>
              <Select
                value={talentPositionId}
                onValueChange={(v) => {
                  setTalentPositionId(v);
                  setTalentMatched(false);
                  setTalentMatches([]);
                  setTalentChecked(new Set());
                }}
              >
                <SelectTrigger id="talent-position" className="h-10 rounded-xl" aria-label="Pilih posisi target">
                  <SelectValue placeholder="Pilih posisi aktif" />
                </SelectTrigger>
                <SelectContent>
                  {activePositions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              className="h-10 rounded-xl"
              onClick={() => void runTalentMatch()}
              disabled={!talentPositionId || talentLoading}
            >
              {talentLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="size-4" aria-hidden="true" />
              )}
              Cocokkan
            </Button>
          </div>

          {talentLoading ? (
            <div className="flex flex-col gap-2" aria-live="polite" aria-label="Mencocokkan kandidat">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : talentMatched && talentMatches.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Tidak ada kandidat lama yang cocok.
            </p>
          ) : talentMatches.length > 0 ? (
            <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar" aria-label="Hasil kandidat talent pool">
              {talentMatches.map((m) => {
                const checked = talentChecked.has(m.applicationId);
                const scoreBadge =
                  m.score >= 70
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                    : m.score >= 40
                      ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                      : "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
                const originText = m.holdAt
                  ? `Ditahan ${formatDate(m.holdAt)}`
                  : m.rejectedAt
                    ? `Ditolak ${formatDate(m.rejectedAt)}`
                    : "Talent pool";
                return (
                  <li key={m.applicationId} className="flex flex-col gap-1.5 rounded-xl border p-3">
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggleTalentCandidate(m.applicationId, v === true)}
                        aria-label={`Undang ${m.name} melamar ulang`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{m.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {m.positionTitle ?? "Tanpa posisi"} · {originText} · {stageLabel(m.status)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("shrink-0 tabular-nums", scoreBadge)}
                        title={`Skor kecocokan ${m.score}/100`}
                      >
                        {m.score}
                      </Badge>
                    </div>
                    {m.reasons.length > 0 ? (
                      <div className="flex flex-wrap gap-1 pl-7">
                        {m.reasons.map((reason) => (
                          <Badge
                            key={reason}
                            variant="outline"
                            className="text-[11px] font-normal text-zinc-600 dark:text-zinc-300"
                          >
                            {reason}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Pilih posisi target lalu klik Cocokkan untuk melihat kandidat lama yang cocok.
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTalentOpen(false)} disabled={talentSending}>
              Tutup
            </Button>
            <Button
              onClick={() => void sendTalentInvites()}
              disabled={talentSending || talentChecked.size === 0}
            >
              {talentSending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              Kirim Undangan ({talentChecked.size})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={updateAppInList}
        onDeleted={(id) =>
          setApplications((prev) => prev.filter((a) => a.id !== id))
        }
        /* Navigasi antar pelamar di dalam dialog (NR-24 fitur 1). */
        list={displayedApplications}
        onNavigate={(app) => setDetail(app)}
        onListRefresh={() => void loadApplications(true)}
      />

      {/* Konfirmasi hapus dari baris */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus lamaran ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Lamaran ${deleteTarget.name} akan dihapus permanen. Tindakan tidak bisa dibatalkan.`
                : "Tindakan tidak bisa dibatalkan."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleting}
            >
              {deleting ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi hapus massal — soft delete: masuk tong sampah, bisa dipulihkan */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {selectedIds.size} lamaran?</AlertDialogTitle>
            <AlertDialogDescription>
              Lamaran terpilih akan dipindahkan ke Tong Sampah dan keluar dari
              daftar kerja. Kamu masih bisa memulihkannya kapan saja dari tab
              Data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkWorking}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runBulk(
                  { ids: Array.from(selectedIds), action: "delete" },
                  "{n} lamaran masuk Tong Sampah"
                );
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={bulkWorking}
            >
              {bulkWorking ? "Menghapus..." : "Ya, Hapus Semua"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* NR-28 (item 13): konfirmasi tolak massal memakai AlertDialog — aksi
          berbahaya dengan semantik alert (Esc/overlay tidak menutup diam-diam
          tanpa pilihan eksplisit), alasan tetap wajib sesuai kontrak API. */}
      <AlertDialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <AlertDialogContent className="rounded-2xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Tolak {selectedIds.size} lamaran?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua lamaran terpilih akan berstatus Ditolak dengan alasan yang sama.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-reject-reason">Alasan Penolakan</Label>
              <Select
                value={bulkRejectReason || "__pilih__"}
                onValueChange={(v) => setBulkRejectReason(v as RejectionReason)}
                disabled={bulkWorking}
              >
                <SelectTrigger
                  id="bulk-reject-reason"
                  className="h-11 w-full sm:h-10"
                  aria-label="Alasan penolakan massal"
                >
                  <SelectValue placeholder="Pilih alasan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__pilih__" disabled>
                    Pilih alasan
                  </SelectItem>
                  {REJECTION_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {REJECTION_REASON_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-reject-note">Catatan (opsional)</Label>
              <Textarea
                id="bulk-reject-note"
                value={bulkRejectNote}
                onChange={(e) => setBulkRejectNote(e.target.value)}
                placeholder="Catatan internal untuk seluruh lamaran terpilih"
                rows={3}
                maxLength={1000}
                disabled={bulkWorking}
              />
            </div>
          </div>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel disabled={bulkWorking}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // Cegah penutupan otomatis agar state loading terlihat sampai
                // permintaan selesai (pola sama dengan konfirmasi hapus massal).
                e.preventDefault();
                void handleBulkReject();
              }}
              disabled={bulkWorking || !bulkRejectReason}
              className="h-11 bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99] sm:h-10"
            >
              {bulkWorking ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menolak...
                </>
              ) : (
                `Tolak ${selectedIds.size} Lamaran`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog atur tag massal */}
      <Dialog open={bulkTagOpen} onOpenChange={setBulkTagOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="size-4 text-rose-600" aria-hidden="true" />
              Atur Tag — {selectedIds.size} lamaran
            </DialogTitle>
            <DialogDescription>
              Tag akan digabungkan (tanpa duplikat) ke setiap lamaran
              terpilih. Maksimal 12 tag, masing-masing maksimal 24 karakter.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex gap-2">
              <Input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTagsFromInput();
                  }
                }}
                placeholder="Tulis tag, tekan Enter — pisahkan koma untuk beberapa"
                aria-label="Tag baru untuk lamaran terpilih"
                maxLength={24}
                disabled={bulkWorking}
              />
              <Button
                variant="outline"
                className="h-11 shrink-0 sm:h-10"
                onClick={addTagsFromInput}
                disabled={bulkWorking || tagInput.trim().length === 0}
              >
                Tambah
              </Button>
            </div>
            {tagChips.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 rounded-xl border p-3">
                {tagChips.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
                  >
                    {chip}
                    <button
                      type="button"
                      className="rounded-full p-0.5 transition-colors hover:bg-zinc-200 dark:hover:bg-zinc-700"
                      onClick={() =>
                        setTagChips((prev) => prev.filter((t) => t !== chip))
                      }
                      aria-label={`Hapus tag ${chip}`}
                      disabled={bulkWorking}
                    >
                      <XCircle className="size-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Belum ada tag. Pratinjau tag akan tampil di sini sebelum
                disimpan.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkTagOpen(false)}
              disabled={bulkWorking}
              className="h-11 sm:h-9"
            >
              Batal
            </Button>
            <Button
              onClick={() => void handleBulkTag()}
              disabled={bulkWorking || tagChips.length === 0}
              className="h-11 active:scale-[0.99] sm:h-9"
            >
              {bulkWorking ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : (
                `Simpan Tag ke ${selectedIds.size} Lamaran`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
