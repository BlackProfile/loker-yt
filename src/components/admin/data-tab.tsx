"use client";

// Tab Data — backup/restore database (OWNER), impor lamaran massal dari CSV,
// mode tutup rekrutmen (Setting "site" -> banner + blokir submit wizard),
// tong sampah (soft delete), webhook keluar, dan arsip otomatis.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CollapsibleCard } from "./collapsible-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Archive,
  BarChart3,
  CheckCircle2,
  Copy,
  DatabaseBackup,
  Download,
  FileDown,
  FileSpreadsheet,
  FileUp,
  History,
  Info,
  Loader2,
  PauseCircle,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  ShieldAlert,
  Stethoscope,
  Trash2,
  TriangleAlert,
  Upload,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  WEBHOOK_EVENTS,
  WEBHOOK_EVENT_LABELS,
  type Application,
  type ApplicationStatus,
  type DataHealthReport,
  type SiteContent,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { apiDelete, apiGet, apiPost, apiPut, buildQuery } from "./api";
import { formatDateTime, formatRelative } from "./format";
import { useAdminSession } from "./admin-context";

/* ------------------------------- Util CSV ------------------------------- */

type CsvRow = {
  name: string;
  email: string;
  phone: string;
  positionTitle: string;
  experience: string;
  motivation: string;
};

// Alias kolom header yang dikenali (tidak cocok -> urutan posisi dipakai).
const HEADER_ALIASES: Record<string, keyof CsvRow> = {
  nama: "name",
  name: "name",
  email: "email",
  "e-mail": "email",
  telepon: "phone",
  telp: "phone",
  phone: "phone",
  whatsapp: "phone",
  no_hp: "phone",
  posisi: "positionTitle",
  position: "positionTitle",
  positiontitle: "positionTitle",
  jabatan: "positionTitle",
  experience: "experience",
  pengalaman: "experience",
  motivation: "motivation",
  motivasi: "motivation",
};

const POSITIONAL_KEYS: (keyof CsvRow)[] = [
  "name",
  "email",
  "phone",
  "positionTitle",
  "experience",
  "motivation",
];

/** Parser sederhana: dukung kutip dasar ("..." dan "" escape), toleran pemisah
 *  koma/semicolon (dideteksi otomatis dari isi file). Baris baru di dalam
 *  kutip tetap dianggap satu sel. */
function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell.trim());
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    // Baris yang seluruh selnya kosong dianggap pemisah kosong — lewati.
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      pushCell();
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      cell += char;
    }
  }
  pushRow();
  return rows;
}

/** Pilih pemisah baris pertama: koma vs semicolon (di luar kutip). */
function detectDelimiter(text: string): string {
  let commas = 0;
  let semicolons = 0;
  let inQuotes = false;
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (char === ",") commas++;
      else if (char === ";") semicolons++;
      else if (char === "\n") break;
    }
  }
  return semicolons > commas ? ";" : ",";
}

/** Ubah hasil parse menjadi daftar baris siap kirim (baris pertama = header). */
function toImportRows(records: string[][]): CsvRow[] {
  if (records.length === 0) return [];
  const header = records[0].map((value) => value.toLowerCase().replace(/\s+/g, "_"));
  const mapped = header.map(
    (value) => HEADER_ALIASES[value] ?? null,
  );
  const useHeader = mapped.some((key) => key !== null);
  const keys = useHeader ? mapped : POSITIONAL_KEYS;
  return records
    .slice(useHeader ? 1 : 0)
    .map((cells) => {
      const row: CsvRow = {
        name: "",
        email: "",
        phone: "",
        positionTitle: "",
        experience: "",
        motivation: "",
      };
      cells.forEach((cell, index) => {
        const key = keys[index] ?? null;
        if (key) row[key] = cell;
      });
      return row;
    })
    .filter((row) => Object.values(row).some((value) => value !== ""));
}

/* --------------------- Kesehatan Data (NR-41 G11) --------------------- */

const DATA_HEALTH_SEVERITY: Record<
  string,
  { label: string; dot: string; text: string; border: string; bg: string }
> = {
  CRIT: {
    label: "Kritis",
    dot: "bg-rose-600",
    text: "text-rose-700 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-900",
    bg: "bg-rose-50 dark:bg-rose-950/40",
  },
  WARN: {
    label: "Perlu diperhatikan",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-900",
    bg: "bg-amber-50 dark:bg-amber-950/40",
  },
  INFO: {
    label: "Info",
    dot: "bg-zinc-400",
    text: "text-zinc-600 dark:text-zinc-400",
    border: "border-zinc-200 dark:border-zinc-700",
    bg: "bg-zinc-50 dark:bg-zinc-900/40",
  },
};

/** Pemeriksaan kesehatan data: email invalid, file yatim, dokumen kedaluwarsa, dll. */
function DataHealthCard() {
  const { reportError } = useAdminSession();
  const [report, setReport] = useState<DataHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<DataHealthReport>("/api/admin/data-health");
      setReport(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const issues = report?.issues ?? [];
  const critCount = issues.filter((issue) => issue.severity === "CRIT").length;
  const warnCount = issues.filter((issue) => issue.severity === "WARN").length;

  return (
    <DataCard
      icon={Stethoscope}
      title="Kesehatan Data"
      description="Pemeriksaan otomatis: email tidak valid, berkas yatim, dokumen kedaluwarsa, draft basi, dan anomali lain."
    >
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      ) : loadError ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400">
          <span className="flex items-center gap-2">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {loadError}
          </span>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Coba lagi
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              {issues.length === 0 ? (
                <span className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  Tidak ada masalah terdeteksi
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {critCount > 0 && (
                    <Badge className="bg-rose-600 text-white hover:bg-rose-600">
                      {critCount} kritis
                    </Badge>
                  )}
                  {warnCount > 0 && (
                    <Badge className="bg-amber-500 text-white hover:bg-amber-500">
                      {warnCount} perlu diperhatikan
                    </Badge>
                  )}
                  {issues.length - critCount - warnCount > 0 && (
                    <Badge variant="outline">
                      {issues.length - critCount - warnCount} info
                    </Badge>
                  )}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {report && (
                <span className="text-xs text-muted-foreground">
                  Diperiksa {formatDateTime(report.checkedAt)}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Periksa Ulang
              </Button>
            </div>
          </div>

          {issues.length > 0 && (
            <ul className="space-y-2">
              {issues.map((issue) => {
                const severity =
                  DATA_HEALTH_SEVERITY[issue.severity] ?? DATA_HEALTH_SEVERITY.INFO;
                return (
                  <li
                    key={issue.code}
                    className={cn(
                      "rounded-lg border px-3 py-2",
                      severity.border,
                      severity.bg,
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn("size-2 shrink-0 rounded-full", severity.dot)}
                        aria-hidden="true"
                      />
                      <span className={cn("text-sm font-medium", severity.text)}>
                        {issue.label}
                      </span>
                      <Badge variant="outline" className="font-mono text-xs">
                        {issue.count}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={cn("ml-auto text-xs", severity.text)}
                      >
                        {severity.label}
                      </Badge>
                    </div>
                    {issue.sample.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 pl-4 font-mono text-xs text-muted-foreground">
                        {issue.sample.map((sample, index) => (
                          <li key={`${issue.code}-${index}`} className="truncate">
                            {sample}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </DataCard>
  );
}

/* --------------------------- Kartu (pattern UI) --------------------------- */

// Kartu Data kini bisa DICIUTKAN (dropdown) — default tertutup — lewat
// CollapsibleCard; latar kartu tetap terpisah per section.
function DataCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof DatabaseBackup;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const id = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return (
    <CollapsibleCard id={id} icon={Icon} title={title} description={description}>
      {children}
    </CollapsibleCard>
  );
}

/* ------------------------------ Tong Sampah ------------------------------ */

type TrashPosition = {
  id: string;
  title: string;
  deletedAt: string | null;
  applicationsCount: number;
};

type TrashApplication = {
  id: string;
  name: string;
  positionTitle: string | null;
  deletedAt: string | null;
};

type TrashResponse = {
  positions: TrashPosition[];
  applications: TrashApplication[];
};

type TrashPurgeTarget = {
  type: "position" | "application";
  id: string;
  label: string;
};

function TrashCard() {
  const { reportError } = useAdminSession();
  const [positions, setPositions] = useState<TrashPosition[]>([]);
  const [applications, setApplications] = useState<TrashApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<TrashPurgeTarget | null>(null);
  const purging = busyId !== null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<TrashResponse>("/api/admin/trash");
      setPositions(data.positions ?? []);
      setApplications(data.applications ?? []);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAction(
    type: "position" | "application",
    id: string,
    action: "restore" | "purge",
  ) {
    if (busyId) return;
    setBusyId(id);
    try {
      await apiPost("/api/admin/trash", { type, id, action });
      toast.success(
        action === "restore" ? "Item berhasil dipulihkan." : "Item dihapus permanen.",
      );
      setPurgeTarget(null);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <DataCard
      icon={Trash2}
      title="Tong Sampah"
      description="Posisi dan lamaran yang dihapus masih bisa dipulihkan. Hapus permanen tidak bisa dibatalkan."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat tong sampah...
        </div>
      ) : positions.length === 0 && applications.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Tong sampah kosong — tidak ada posisi atau lamaran terhapus.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-4 overflow-y-auto nice-scrollbar">
          {positions.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Posisi ({positions.length})
              </p>
              {positions.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.title || "(tanpa judul)"}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.applicationsCount} lamaran terkait · dihapus {formatRelative(p.deletedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={busyId !== null}
                      onClick={() => void handleAction("position", p.id, "restore")}
                    >
                      {busyId === p.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="size-4" aria-hidden="true" />
                      )}
                      Pulihkan
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                      disabled={busyId !== null}
                      onClick={() =>
                        setPurgeTarget({ type: "position", id: p.id, label: p.title || "(tanpa judul)" })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Hapus Permanen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {applications.length > 0 ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Lamaran ({applications.length})
              </p>
              {applications.map((a) => (
                <div
                  key={a.id}
                  className="flex flex-col gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.positionTitle ?? "Posisi tidak diketahui"} · dihapus {formatRelative(a.deletedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={busyId !== null}
                      onClick={() => void handleAction("application", a.id, "restore")}
                    >
                      {busyId === a.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <RotateCcw className="size-4" aria-hidden="true" />
                      )}
                      Pulihkan
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                      disabled={busyId !== null}
                      onClick={() =>
                        setPurgeTarget({
                          type: "application",
                          id: a.id,
                          label: `${a.name}${a.positionTitle ? ` — ${a.positionTitle}` : ""}`,
                        })
                      }
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Hapus Permanen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Konfirmasi hapus permanen */}
      <AlertDialog
        open={purgeTarget !== null}
        onOpenChange={(open) => {
          if (!purging && !open) setPurgeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Hapus permanen dari tong sampah?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  <strong>{purgeTarget?.label ?? "Item ini"}</strong> akan dihapus selamanya
                  beserta seluruh data terkait. Tindakan ini tidak bisa dibatalkan.
                </p>
                <p>Gunakan tombol Pulihkan bila item masih diperlukan.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={purging}
              onClick={(event) => {
                event.preventDefault();
                if (purgeTarget) {
                  void handleAction(purgeTarget.type, purgeTarget.id, "purge");
                }
              }}
            >
              {purging ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menghapus...
                </>
              ) : (
                "Ya, Hapus Permanen"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataCard>
  );
}

/* ---------------------------- Webhook Keluar ---------------------------- */

type WebhookEndpointRow = {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  lastStatus: number | null;
  lastFiredAt: string | null;
  failCount: number;
  createdAt: string;
  secretPreview: string;
};

function webhookStatusBadgeClass(status: number | null): string {
  if (status === null) {
    return "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
  }
  if (status >= 200 && status < 300) {
    return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900";
  }
  return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900";
}

function WebhooksCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";

  const [rows, setRows] = useState<WebhookEndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookEndpointRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (role !== "OWNER") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiGet<WebhookEndpointRow[]>("/api/admin/webhooks");
      setRows(data ?? []);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [role, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  const eventOptions = useMemo(
    () => ["*", ...WEBHOOK_EVENTS] as const,
    [],
  );

  function toggleEvent(event: string, checked: boolean) {
    setSelectedEvents((prev) => {
      if (checked) {
        if (event === "*") return ["*"];
        const next = prev.filter((v) => v !== "*");
        return next.includes(event) ? next : [...next, event];
      }
      return prev.filter((v) => v !== event);
    });
  }

  async function handleCreate() {
    if (creating) return;
    if (!url.trim()) {
      toast.error("URL webhook wajib diisi.");
      return;
    }
    if (selectedEvents.length === 0) {
      toast.error("Pilih minimal satu event yang dikirim.");
      return;
    }
    setCreating(true);
    try {
      const res = await apiPost<{ endpoint: WebhookEndpointRow; secret: string }>(
        "/api/admin/webhooks",
        { url: url.trim(), events: selectedEvents },
      );
      setRows((prev) => [res.endpoint, ...prev]);
      setNewSecret(res.secret); // secret penuh hanya tampil SEKALI
      setUrl("");
      setSelectedEvents(["*"]);
      toast.success("Endpoint webhook ditambahkan.");
    } catch (err) {
      reportError(err);
    } finally {
      setCreating(false);
    }
  }

  async function handleTest(id: string) {
    if (testingId) return;
    setTestingId(id);
    try {
      const res = await apiPost<{ ok: boolean; status: number | null }>(
        "/api/admin/webhook-test",
        { id },
      );
      if (res.ok) {
        toast.success(`Tes terkirim — respons ${res.status}.`);
      } else {
        toast.error(
          res.status === null
            ? "Endpoint tidak merespons (timeout / gagal jaringan)."
            : `Endpoint menjawab ${res.status}.`,
        );
      }
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      setTestingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete(`/api/admin/webhooks?id=${encodeURIComponent(deleteTarget.id)}`);
      setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success("Endpoint webhook dihapus.");
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DataCard
      icon={Webhook}
      title="Webhook Keluar"
      description="Kirim event otomatis (lamaran baru, perubahan tahap, arsip, jawaban offer) ke sistem eksternal dengan tanda tangan HMAC pada header X-Lumina-*."
    >
      {!isOwner ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
          role="note"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Kelola webhook keluar hanya dapat dilakukan oleh pemilik studio (OWNER).</span>
        </div>
      ) : (
        <>
          {/* Form tambah endpoint */}
          <div className="flex flex-col gap-3 rounded-lg border bg-zinc-50/60 p-4 dark:bg-zinc-900/40">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="webhook-url">URL Endpoint</Label>
              <Input
                id="webhook-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://contoh.com/webhooks/lumina"
                className="h-10"
                type="url"
                inputMode="url"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Event yang dikirim</Label>
              <div className="grid gap-2 sm:grid-cols-2">
                {eventOptions.map((event) => (
                  <label
                    key={event}
                    className="flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <Checkbox
                      checked={selectedEvents.includes(event)}
                      onCheckedChange={(checked) => toggleEvent(event, checked === true)}
                      aria-label={WEBHOOK_EVENT_LABELS[event] ?? event}
                    />
                    <span className="min-w-0 truncate">
                      {WEBHOOK_EVENT_LABELS[event] ?? event}
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={() => void handleCreate()}
                disabled={creating}
                className="h-11 active:scale-[0.99] sm:h-9"
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Tambah Endpoint
              </Button>
            </div>
            {newSecret ? (
              <div
                className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
                role="alert"
              >
                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                  Simpan secret ini sekarang
                </p>
                <p className="text-xs text-amber-700/90 dark:text-amber-400/90">
                  Secret penuh hanya ditampilkan sekali dan tidak bisa dilihat lagi. Gunakan
                  untuk memverifikasi header X-Lumina-Signature di sistem penerima.
                </p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-amber-100 px-2 py-1.5 font-mono text-xs text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
                    {newSecret}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={() => {
                      void navigator.clipboard.writeText(newSecret).then(() => {
                        toast.success("Secret disalin ke clipboard.");
                      });
                    }}
                  >
                    Salin
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-fit text-amber-700 dark:text-amber-400"
                  onClick={() => setNewSecret(null)}
                >
                  Saya sudah menyimpan
                </Button>
              </div>
            ) : null}
          </div>

          {/* Daftar endpoint */}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Memuat endpoint...
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada endpoint webhook terdaftar.
            </p>
          ) : (
            <div className="flex max-h-96 flex-col gap-2 overflow-y-auto nice-scrollbar">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={row.url}>
                      {row.url}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={webhookStatusBadgeClass(row.lastStatus)}>
                        {row.lastStatus === null
                          ? "Belum terkirim"
                          : `Status ${row.lastStatus}`}
                      </Badge>
                      {row.failCount > 0 ? (
                        <Badge
                          variant="outline"
                          className="border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
                        >
                          {row.failCount} gagal
                        </Badge>
                      ) : null}
                      {row.events.map((ev) => (
                        <Badge
                          key={ev}
                          variant="outline"
                          className="border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                        >
                          {WEBHOOK_EVENT_LABELS[ev] ?? ev}
                        </Badge>
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Secret {row.secretPreview} · terakhir kirim {formatRelative(row.lastFiredAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9"
                      disabled={testingId !== null}
                      onClick={() => void handleTest(row.id)}
                    >
                      {testingId === row.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="size-4" aria-hidden="true" />
                      )}
                      Tes
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                      aria-label={`Hapus endpoint ${row.url}`}
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Konfirmasi hapus endpoint */}
          <AlertDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => {
              if (!deleting && !open) setDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus endpoint webhook?</AlertDialogTitle>
                <AlertDialogDescription>
                  Event tidak akan dikirim lagi ke{" "}
                  <span className="font-medium break-all">{deleteTarget?.url}</span>. Sistem
                  penerima yang masih menyimpan secret lama tidak akan menerima pesan baru.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleting}
                  onClick={(event) => {
                    event.preventDefault();
                    void handleDelete();
                  }}
                >
                  {deleting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Menghapus...
                    </>
                  ) : (
                    "Ya, Hapus Endpoint"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </DataCard>
  );
}

/* ---------------------------- Arsip Otomatis ---------------------------- */

function AutoArchiveCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";

  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState("90");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    if (role !== "OWNER") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiGet<{
        maintenance: { autoArchiveEnabled: boolean; autoArchiveDays: number };
      }>("/api/admin/retention");
      setEnabled(data.maintenance.autoArchiveEnabled);
      setDays(String(data.maintenance.autoArchiveDays));
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [role, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiPut<{
        ok: true;
        maintenance: { autoArchiveEnabled: boolean; autoArchiveDays: number };
      }>("/api/admin/retention", {
        autoArchiveEnabled: enabled,
        autoArchiveDays: Number(days),
      });
      setEnabled(res.maintenance.autoArchiveEnabled);
      setDays(String(res.maintenance.autoArchiveDays));
      toast.success("Pengaturan arsip otomatis disimpan.");
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleRunNow() {
    if (running) return;
    setRunning(true);
    try {
      const res = await apiPost<{
        ok: boolean;
        skipped?: boolean;
        archived: number;
        deleted: number;
        message?: string;
      }>("/api/cron/maintenance");
      if (res.skipped) {
        toast.info(res.message ?? "Perawatan baru saja dijalankan. Coba lagi nanti.");
      } else {
        toast.success(
          `Perawatan selesai: ${res.archived} lamaran diarsipkan, ${res.deleted} dihapus retensi.`,
        );
      }
    } catch (err) {
      reportError(err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <DataCard
      icon={Archive}
      title="Arsip Otomatis"
      description="Lamaran yang tidak berada di tahap final dan tidak aktif lebih dari batas hari akan diarsipkan otomatis oleh sistem."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat pengaturan...
        </div>
      ) : !isOwner ? (
        <p className="text-sm text-muted-foreground">
          Arsip otomatis hanya dapat diatur oleh pemilik studio (OWNER).
        </p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Aktifkan Arsip Otomatis</p>
              <p className="text-xs text-muted-foreground">
                Berjalan saat perawatan data dijalankan (maksimal 1x per jam).
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={saving}
              onCheckedChange={setEnabled}
              aria-label="Aktifkan arsip otomatis"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auto-archive-days">Batas stagnasi (hari)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="auto-archive-days"
                type="number"
                min={7}
                max={365}
                value={days}
                onChange={(e) => setDays(e.target.value)}
                className="h-10 w-32"
                disabled={saving}
              />
              <Button
                variant="outline"
                className="h-10 shrink-0"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                Simpan
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Angka 7 sampai 365 hari. Lamaran di tahap final (ditolak, diterima, hired) tidak
              pernah diarsipkan otomatis.
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed p-4">
            <p className="text-xs text-muted-foreground">
              Jalankan perawatan sekarang (arsip otomatis + retensi data).
            </p>
            <Button
              variant="outline"
              className="h-10 shrink-0"
              disabled={running}
              onClick={() => void handleRunNow()}
            >
              {running ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Play className="size-4" aria-hidden="true" />
              )}
              Jalankan Sekarang
            </Button>
          </div>
        </>
      )}
    </DataCard>
  );
}

/* ------------------------- Backup Otomatis (galeri) ------------------------- */

type AutoBackupEntry = {
  file: string;
  sizeBytes: number;
  createdAt: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function AutoBackupCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";

  const [backups, setBackups] = useState<AutoBackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<AutoBackupEntry | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    if (role !== "OWNER") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiGet<{ ok: boolean; backups: AutoBackupEntry[] }>(
        "/api/admin/backups",
      );
      setBackups(data.backups ?? []);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [role, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRestore() {
    if (!restoreTarget || restoring) return;
    setRestoring(true);
    try {
      await apiPost("/api/admin/backups", { file: restoreTarget.file });
      toast.success(`Database berhasil dipulihkan dari "${restoreTarget.file}".`);
      setRestoreTarget(null);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      setRestoring(false);
    }
  }

  async function handleDelete(entry: AutoBackupEntry) {
    if (busyFile) return;
    setBusyFile(entry.file);
    try {
      await apiDelete(`/api/admin/backups?file=${encodeURIComponent(entry.file)}`);
      toast.success(`Backup "${entry.file}" dihapus.`);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      setBusyFile(null);
    }
  }

  return (
    <DataCard
      icon={History}
      title="Backup Otomatis"
      description="Setiap hari sistem menyimpan salinan database ke backups/auto (7 terakhir disimpan)."
    >
      {!isOwner ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
          role="note"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Mengelola backup otomatis hanya dapat dilakukan oleh pemilik studio (OWNER).
          </span>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat daftar backup...
        </div>
      ) : backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada backup otomatis. Backup dibuat saat perawatan data dijalankan
          (cron/tombol &quot;Jalankan Sekarang&quot;) dan akan muncul di sini.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto nice-scrollbar">
          {backups.map((entry) => (
            <div
              key={entry.file}
              className="flex flex-col gap-2 rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p
                  className="truncate font-mono text-xs font-medium sm:text-sm"
                  title={entry.file}
                >
                  {entry.file}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(entry.sizeBytes)} · {formatDateTime(entry.createdAt)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <a
                  href={`/api/admin/backups?download=${encodeURIComponent(entry.file)}`}
                  download
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "h-9",
                  )}
                  aria-label={`Unduh ${entry.file}`}
                >
                  <Download className="size-4" aria-hidden="true" />
                  Unduh
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  disabled={busyFile !== null || restoring}
                  onClick={() => setRestoreTarget(entry)}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  Pulihkan
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                  aria-label={`Hapus ${entry.file}`}
                  disabled={busyFile !== null || restoring}
                  onClick={() => void handleDelete(entry)}
                >
                  {busyFile === entry.file ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Konfirmasi restore dari backup otomatis */}
      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!restoring && !open) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert
                className="size-5 text-rose-600 dark:text-rose-400"
                aria-hidden="true"
              />
              Pulihkan database dari backup otomatis?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  <strong>Semua data saat ini akan diganti</strong> dengan isi file{" "}
                  <span className="font-mono">{restoreTarget?.file ?? "backup"}</span> —
                  termasuk posisi, lamaran, akun admin, dan pengaturan.
                </p>
                <p>Tindakan ini tidak bisa dibatalkan.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              className="bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600 dark:bg-rose-600 dark:text-white dark:hover:bg-rose-700"
              onClick={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
            >
              {restoring ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Memulihkan...
                </>
              ) : (
                "Ya, Ganti Semua Data"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataCard>
  );
}

/* --------------------------------- Tab --------------------------------- */

export function DataTab() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";

  // --- Backup ---
  const [backingUp, setBackingUp] = useState(false);

  // --- Restore ---
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [restoredCounts, setRestoredCounts] = useState<Record<string, number> | null>(null);
  const restoreInputRef = useRef<HTMLInputElement>(null);

  // --- Import CSV ---
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    created: number;
    skipped: { row: number; reason: string }[];
  } | null>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  // --- Impor dari file (CSV/Excel, NR-19-b) ---
  const [importFileBusy, setImportFileBusy] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  // --- Tutup rekrutmen ---
  const [site, setSite] = useState<SiteContent | null>(null);
  const [siteLoading, setSiteLoading] = useState(true);
  const [savingSite, setSavingSite] = useState(false);

  useEffect(() => {
    let alive = true;
    apiGet<{ site: SiteContent }>("/api/admin/settings")
      .then((res) => {
        if (alive) setSite(res.site);
      })
      .catch((err) => reportError(err))
      .finally(() => {
        if (alive) setSiteLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const parsedRows = useMemo(() => toImportRows(parseCsv(csvText)), [csvText]);

  async function handleBackup() {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const res = await fetch("/api/admin/backup");
      if (!res.ok) {
        const data: unknown = await res.json().catch(() => null);
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Gagal mengunduh backup database.";
        throw new Error(message);
      }
      const blob = await res.blob();
      const dispo = res.headers.get("Content-Disposition") ?? "";
      const filename =
        dispo.match(/filename="([^"]+)"/)?.[1] ?? "lumina-backup.db";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Backup database berhasil diunduh.");
    } catch (err) {
      reportError(err);
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestore() {
    if (!restoreFile || restoring) return;
    setRestoring(true);
    try {
      const fd = new FormData();
      fd.append("file", restoreFile);
      const res = await fetch("/api/admin/restore", { method: "POST", body: fd });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Gagal memulihkan database.";
        throw new Error(message);
      }
      const counts =
        data && typeof data === "object" && "restored" in data
          ? ((data as { restored: Record<string, number> }).restored ?? {})
          : {};
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      setRestoredCounts(counts);
      setRestoreFile(null);
      if (restoreInputRef.current) restoreInputRef.current.value = "";
      setRestoreConfirmOpen(false);
      toast.success(`Database berhasil dipulihkan (${total} baris).`);
    } catch (err) {
      reportError(err);
    } finally {
      setRestoring(false);
    }
  }

  async function handleImport() {
    if (importing) return;
    if (parsedRows.length === 0) {
      toast.error("Tidak ada baris yang bisa dibaca. Tempel data CSV atau unggah file.");
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/import-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: parsedRows }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Gagal mengimpor lamaran.";
        throw new Error(message);
      }
      const result = data as {
        created: number;
        skipped: { row: number; reason: string }[];
      };
      setImportResult({ created: result.created, skipped: result.skipped ?? [] });
      toast.success(`${result.created} lamaran berhasil diimpor.`);
    } catch (err) {
      reportError(err);
    } finally {
      setImporting(false);
    }
  }

  async function handleImportFile(file: File) {
    if (importFileBusy) return;
    if (!isOwner) {
      toast.error("Impor lamaran hanya dapat dilakukan oleh OWNER dan HR.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Ukuran file melebihi batas 5 MB.");
      return;
    }
    setImportFileBusy(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/import-applications", {
        method: "POST",
        body: fd,
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          data && typeof data === "object" && "error" in data
            ? String((data as { error: unknown }).error)
            : "Gagal mengimpor lamaran dari file.";
        throw new Error(message);
      }
      const result = data as {
        created: number;
        skipped?: { row: number; reason: string }[];
        skippedRows?: number;
      };
      const skipped = result.skipped ?? [];
      setImportResult({ created: result.created, skipped });
      toast.success(
        `${result.created} baris diimpor, ${result.skippedRows ?? skipped.length} dilewati.`,
      );
    } catch (err) {
      reportError(err);
    } finally {
      setImportFileBusy(false);
    }
  }

  async function handleSaveSite(closed: boolean, message: string) {
    if (!site || savingSite) return;
    setSavingSite(true);
    try {
      // Merge aman: kirim seluruh konten situs terkini dengan dua field yang diubah.
      const res = await apiPut<{ ok: true; site: SiteContent }>("/api/admin/settings", {
        site: { ...site, recruitmentClosed: closed, recruitmentClosedMessage: message },
      });
      setSite(res.site);
      toast.success(
        closed ? "Rekrutmen ditutup — pengumuman tampil di halaman publik." : "Rekrutmen dibuka kembali.",
      );
    } catch (err) {
      reportError(err);
    } finally {
      setSavingSite(false);
    }
  }

  async function handleCsvFile(file: File) {
    const text = await file.text();
    setCsvText(text);
    setImportResult(null);
    toast.success(`File "${file.name}" dimuat.`);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------- Backup Database ------------------------- */}
      <DataCard
        icon={DatabaseBackup}
        title="Backup Database"
        description="Unduh salinan file database SQLite untuk disimpan di tempat aman."
      >
        {isOwner ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-zinc-50/60 p-4 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Backup Database</p>
              <p className="text-xs text-muted-foreground">
                File SQLite utuh (db/custom.db) diunduh sebagai{" "}
                <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[11px] dark:bg-zinc-800">
                  lumina-backup-TANGGAL.db
                </code>
                . Simpan di tempat aman.
              </p>
            </div>
            <Button
              onClick={() => void handleBackup()}
              disabled={backingUp || restoring}
              className="h-11 shrink-0 active:scale-[0.99] sm:h-9"
            >
              {backingUp ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="size-4" aria-hidden="true" />
              )}
              Unduh Backup Database
            </Button>
          </div>
        ) : (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
            role="note"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Backup dan restore database hanya dapat dilakukan oleh pemilik studio (OWNER).
            </span>
          </div>
        )}
      </DataCard>

      {/* --------------------- Kesehatan Data (NR-41 G11) --------------------- */}
      <DataHealthCard />

      {/* ------------------------- Backup Otomatis ------------------------- */}
      <AutoBackupCard />

      {/* ------------------------- Restore Database ------------------------- */}
      <DataCard
        icon={Upload}
        title="Restore Database"
        description="Pulihkan isi database dari file backup .db sebelumnya."
      >
        {isOwner ? (
          <div className="flex flex-col gap-3 rounded-lg border bg-zinc-50/60 p-4 dark:bg-zinc-900/40 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Pulihkan dari Backup</p>
              <p className="text-xs text-muted-foreground">
                Unggah file .db dari backup sebelumnya. Seluruh data saat ini akan
                diganti dengan isi file (proses dalam satu transaksi — bila gagal,
                tidak ada perubahan yang disimpan).
              </p>
              {restoreFile ? (
                <p className="mt-1 truncate text-xs font-medium text-rose-600 dark:text-rose-400">
                  File dipilih: {restoreFile.name} ({Math.max(1, Math.round(restoreFile.size / 1024))} KB)
                </p>
              ) : null}
              {restoredCounts ? (
                <div className="mt-2 flex flex-col gap-1 rounded-md border border-emerald-200 bg-emerald-50/70 p-2 text-xs dark:border-emerald-900 dark:bg-emerald-950/40">
                  <p className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Restore terakhir berhasil:
                  </p>
                  <p className="text-emerald-700/80 dark:text-emerald-400/80">
                    {Object.entries(restoredCounts)
                      .map(([table, count]) => `${table}: ${count}`)
                      .join(", ")}
                  </p>
                </div>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <Button
                variant="outline"
                className="h-11 active:scale-[0.99] sm:h-9"
                disabled={backingUp || restoring}
                onClick={() => {
                  // File sudah dipilih -> tampilkan konfirmasi lagi; belum -> buka pemilih file.
                  if (restoreFile) setRestoreConfirmOpen(true);
                  else restoreInputRef.current?.click();
                }}
              >
                {restoring ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : restoreFile ? (
                  <TriangleAlert className="size-4" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                {restoreFile ? "Konfirmasi Pulihkan" : "Pilih File Backup (.db)"}
              </Button>
              <input
                ref={restoreInputRef}
                type="file"
                accept=".db,application/octet-stream"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setRestoreFile(file);
                  e.target.value = "";
                  if (file) setRestoreConfirmOpen(true);
                }}
              />
            </div>
          </div>
        ) : (
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
            role="note"
          >
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Backup dan restore database hanya dapat dilakukan oleh pemilik studio (OWNER).
            </span>
          </div>
        )}
      </DataCard>

      {/* ------------------------ Import Lamaran CSV ------------------------ */}
      <DataCard
        icon={FileSpreadsheet}
        title="Impor Lamaran Massal (CSV)"
        description="Tempel data CSV atau unggah file. Kolom: nama,email,telepon,posisi,experience,motivation (baris pertama = header; pemisah koma/semicolon dikenali otomatis)."
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="data-csv">Data CSV</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 active:scale-[0.99] sm:h-9"
              disabled={importing}
              onClick={() => csvInputRef.current?.click()}
            >
              <FileUp className="size-4" aria-hidden="true" />
              Unggah File CSV
            </Button>
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleCsvFile(file);
              }}
            />
          </div>
          <Textarea
            id="data-csv"
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              setImportResult(null);
            }}
            placeholder={
              "nama,email,telepon,posisi,experience,motivation\nBudi Santoso,budi@mail.com,6281234567890,Video Editor,3 tahun editing YouTube,Mau bergabung dengan tim kreatif"
            }
            rows={7}
            className="font-mono text-xs"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {parsedRows.length > 0
                ? `${parsedRows.length} baris lamaran terdeteksi (header dilewati).`
                : "Belum ada baris yang terdeteksi."}
            </p>
            <Button
              onClick={() => void handleImport()}
              disabled={importing || parsedRows.length === 0 || !isOwner}
              className="h-11 active:scale-[0.99] sm:h-9"
            >
              {importing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileUp className="size-4" aria-hidden="true" />
              )}
              Impor {parsedRows.length > 0 ? `(${parsedRows.length})` : ""} Lamaran
            </Button>
          </div>

          {/* Impor langsung dari file CSV/Excel (NR-19-b) — mode tempel tetap ada */}
          <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Impor dari File (CSV/Excel)</p>
              <p className="text-xs text-muted-foreground">
                Unggah .csv, .xlsx, atau .xls (maks 5 MB). Kolom dikenali otomatis dari
                header: nama, email, telepon/WA, posisi/lowongan, pengalaman,
                motivasi/alasan.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11 active:scale-[0.99] sm:h-9"
                disabled={importFileBusy || importing || !isOwner}
                onClick={() => importFileInputRef.current?.click()}
              >
                {importFileBusy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <FileSpreadsheet className="size-4" aria-hidden="true" />
                )}
                Impor dari File
              </Button>
              <input
                ref={importFileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void handleImportFile(file);
                }}
              />
            </div>
          </div>

          {!isOwner ? (
            <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              Impor lamaran hanya dapat dilakukan oleh OWNER dan HR.
            </p>
          ) : null}
        </div>

        {importResult ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              {importResult.created} lamaran dibuat
              {importResult.skipped.length > 0
                ? `, ${importResult.skipped.length} baris dilewati`
                : ", tanpa baris yang dilewati"}
              .
            </p>
            {importResult.skipped.length > 0 ? (
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {importResult.skipped.map((item) => (
                  <li key={`${item.row}-${item.reason}`}>
                    Baris {item.row + 1}: {item.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </DataCard>

      {/* ------------------------ Mode Tutup Rekrutmen ------------------------ */}
      <DataCard
        icon={PauseCircle}
        title="Mode Tutup Rekrutmen"
        description="Saat aktif, halaman publik menampilkan banner pengumuman amber dan tombol kirim lamaran dinonaktifkan."
      >
        {siteLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat pengaturan situs...
          </div>
        ) : site ? (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  Tutup Rekrutmen
                  {site.recruitmentClosed ? (
                    <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                      Aktif
                    </Badge>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  Rekrutmen saat ini {site.recruitmentClosed ? "DITUTUP" : "TERBUKA"} — status berlaku
                  untuk seluruh posisi.
                </p>
              </div>
              <Switch
                checked={site.recruitmentClosed}
                disabled={!isOwner || savingSite}
                onCheckedChange={(checked) =>
                  void handleSaveSite(checked, site.recruitmentClosedMessage)
                }
                aria-label="Tutup rekrutmen"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="data-recruitment-message">Pesan Pengumuman</Label>
              <Textarea
                id="data-recruitment-message"
                value={site.recruitmentClosedMessage}
                onChange={(e) =>
                  setSite({ ...site, recruitmentClosedMessage: e.target.value })
                }
                placeholder="mis. Rekrutmen batch ini telah ditutup. Sampai jumpa di batch berikutnya!"
                rows={3}
                maxLength={300}
                disabled={!isOwner || savingSite}
              />
              <p className="text-xs text-muted-foreground">
                Tampil di banner halaman publik. Kosongkan untuk memakai pesan bawaan.
              </p>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {!isOwner
                  ? "Hanya OWNER yang dapat mengubah status rekrutmen."
                  : "Simpan pesan agar banner memakai teks terbaru."}
              </p>
              <Button
                variant="outline"
                className="h-11 shrink-0 active:scale-[0.99] sm:h-9"
                disabled={!isOwner || savingSite}
                onClick={() =>
                  void handleSaveSite(site.recruitmentClosed, site.recruitmentClosedMessage.trim())
                }
              >
                {savingSite ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                Simpan Pesan
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pengaturan situs tidak dapat dimuat. Coba muat ulang halaman.
          </p>
        )}
      </DataCard>

      {/* ----------------------------- Tong Sampah ----------------------------- */}
      <TrashCard />

      {/* ---------------------------- Webhook Keluar ---------------------------- */}
      <WebhooksCard />

      {/* ---------------------------- Arsip Otomatis ---------------------------- */}
      <AutoArchiveCard />

      {/* ------------- Konfirmasi restore (peringatan kuat) ------------- */}
      <AlertDialog
        open={restoreConfirmOpen}
        onOpenChange={(open) => {
          if (!restoring) setRestoreConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Pulihkan database dari backup?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <p>
                  <strong>Semua data saat ini akan diganti</strong> dengan isi file{" "}
                  {restoreFile ? `"${restoreFile.name}"` : "backup"} — termasuk posisi,
                  lamaran, akun admin, dan pengaturan.
                </p>
                <p>
                  Tindakan ini tidak bisa dibatalkan. Pastikan kamu sudah mengunduh backup
                  terbaru sebelum melanjutkan.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring || !restoreFile}
              onClick={(event) => {
                event.preventDefault();
                void handleRestore();
              }}
            >
              {restoring ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Memulihkan...
                </>
              ) : (
                "Ya, Ganti Semua Data"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
