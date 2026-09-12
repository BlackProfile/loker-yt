"use client";

// Tab Data — backup/restore database (OWNER), impor lamaran massal dari CSV,
// dan mode tutup rekrutmen (Setting "site" -> banner + blokir submit wizard).
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  FileUp,
  Info,
  Loader2,
  PauseCircle,
  RotateCcw,
  ShieldAlert,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import type { SiteContent } from "@/lib/types";
import { apiGet, apiPut } from "./api";
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

/* --------------------------- Kartu (pattern UI) --------------------------- */

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
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
            <Icon className="size-4" aria-hidden="true" />
          </span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {/* ------------------------- Backup & Restore ------------------------- */}
      <DataCard
        icon={DatabaseBackup}
        title="Backup & Restore Database"
        description="Unduh salinan file database SQLite, atau pulihkan isi database dari file backup."
      >
        {isOwner ? (
          <>
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
                  onClick={() => restoreInputRef.current?.click()}
                >
                  {restoring ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="size-4" aria-hidden="true" />
                  )}
                  Pilih File Backup (.db)
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
          </>
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
                  <RotateCcw className="size-4" aria-hidden="true" />
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
