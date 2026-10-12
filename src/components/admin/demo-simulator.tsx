"use client";

// Kontrol Simulator Pelamar Demo (Mode Demo) — dipasang di toolbar tab Pelamar.
// Dua mode simulasi (NR48):
//   - Santai (interval): satu lamaran tiap beberapa detik.
//   - Lonjakan trafik (burst): N pelamar per detik selama durasi tertentu —
//     meniru trafik asli (mis. 217 pelamar dalam 1 detik) lengkap dengan
//     kecepatan aktual yang terukur jujur dan bilah kemajuan.
// Mulai/hentikan simulasi, pantau penghitung, dan bersihkan seluruh data demo
// dari satu popover.
// API: /api/admin/demo-simulator (GET status, POST start/stop, DELETE bersihkan).

import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { FlaskConical, Loader2, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
import { cn } from "@/lib/utils";
import type { Position } from "@/lib/types";
import { apiDelete, apiGet, apiPost } from "./api";
import { useAdminSession } from "./admin-context";

/** Bentuk payload API (mirror DemoSimulatorStatus dari lib server). */
type DemoStatus = {
  running: boolean;
  mode: "interval" | "burst";
  intervalSec: number;
  ratePerSec: number;
  durationSec: number | null;
  targetTotal: number | null;
  inFlight: number;
  recentPerSec: number;
  runGenerated: number;
  positionId: string | null;
  generated: number;
  failed: number;
  startedAt: string | null;
  lastAt: string | null;
  lastError: string | null;
  note: string | null;
  lastApplicant: { name: string; positionTitle: string; trackingCode: string } | null;
};

type DemoModeChoice = "interval" | "burst";

const INTERVAL_OPTIONS = [
  { value: "10", label: "Setiap 10 detik" },
  { value: "15", label: "Setiap 15 detik" },
  { value: "30", label: "Setiap 30 detik" },
  { value: "60", label: "Setiap 1 menit" },
];

const RATE_PRESETS = [50, 100, 217, 350, 500];
const MIN_RATE = 5;
const MAX_RATE = 500;
const MAX_BURST_TOTAL = 3000; // harus sama dengan rem di lib server

const DURATION_OPTIONS = [
  { value: "10", label: "10 detik" },
  { value: "30", label: "30 detik" },
  { value: "60", label: "1 menit" },
  { value: "0", label: "Terus sampai dihentikan" },
];

const fmtId = (n: number): string => n.toLocaleString("id-ID");

function timeLabel(iso: string | null): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function DemoSimulatorControl({ positions }: { positions: Position[] }) {
  const { canMutate } = useAdminSession();
  const reducedMotion = useReducedMotion();

  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"" | "start" | "stop" | "clean">("");
  const [modeChoice, setModeChoice] = useState<DemoModeChoice>("interval");
  const [intervalChoice, setIntervalChoice] = useState("15");
  const [rateInput, setRateInput] = useState("100");
  const [durationChoice, setDurationChoice] = useState("30");
  const [positionChoice, setPositionChoice] = useState("ALL");
  const [confirmCleanup, setConfirmCleanup] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiGet<DemoStatus>("/api/admin/demo-simulator");
      setStatus(data);
    } catch {
      // Senyap — kontrol demo tidak boleh mengganggu halaman Pelamar.
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const running = status?.running ?? false;
  // Polling saat popover terbuka ATAU simulator sedang berjalan (indikator hidup).
  // Lonjakan berjalan cepat -> polling dipercepat agar bilah kemajuan hidup.
  useEffect(() => {
    if (!open && !running) return;
    const timer = setInterval(() => void loadStatus(), running ? 1500 : 4000);
    return () => clearInterval(timer);
  }, [open, running, loadStatus]);

  const openPositions = positions.filter((p) => p.isActive && p.applyOpen);
  const targetLabel = status?.positionId
    ? (openPositions.find((p) => p.id === status.positionId)?.title ?? "Posisi")
    : "Semua posisi terbuka";

  const rateNum = Math.round(Number(rateInput) || 0);
  const durationNum = durationChoice === "0" ? null : Number(durationChoice);
  const estimate = durationNum != null ? rateNum * durationNum : null;
  const estimateLabel =
    estimate == null
      ? `hingga ${fmtId(MAX_BURST_TOTAL)} (batas aman)`
      : estimate > MAX_BURST_TOTAL
        ? `${fmtId(estimate)} — dibatasi ${fmtId(MAX_BURST_TOTAL)}`
        : `${fmtId(estimate)} lamaran`;

  async function handleStart() {
    if (modeChoice === "burst" && (rateNum < MIN_RATE || rateNum > MAX_RATE)) {
      toast.warning(`Isi jumlah pelamar per detik antara ${MIN_RATE}-${MAX_RATE}.`);
      return;
    }
    setBusy("start");
    try {
      const body: Record<string, unknown> = {
        action: "start",
        mode: modeChoice,
        positionId: positionChoice === "ALL" ? null : positionChoice,
      };
      if (modeChoice === "interval") {
        body.intervalSec = Number(intervalChoice);
      } else {
        body.ratePerSec = rateNum;
        body.durationSec = durationChoice === "0" ? null : Number(durationChoice);
      }
      const data = await apiPost<{ ok: boolean; status: DemoStatus }>(
        "/api/admin/demo-simulator",
        body,
      );
      setStatus(data.status);
      if (modeChoice === "burst") {
        toast.success(`Lonjakan dimulai — target ${fmtId(rateNum)} pelamar per detik.`);
      } else {
        toast.success("Simulasi dimulai — lamaran demo akan masuk otomatis.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal memulai simulasi.");
    } finally {
      setBusy("");
    }
  }

  async function handleStop() {
    setBusy("stop");
    try {
      const data = await apiPost<{ ok: boolean; status: DemoStatus }>(
        "/api/admin/demo-simulator",
        { action: "stop" },
      );
      setStatus(data.status);
      toast.success("Simulasi dihentikan.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal menghentikan simulasi.");
    } finally {
      setBusy("");
    }
  }

  async function handleCleanup() {
    setBusy("clean");
    try {
      const data = await apiDelete<{
        ok: boolean;
        deleted: number;
        status: DemoStatus;
      }>("/api/admin/demo-simulator");
      setStatus(data.status);
      toast.success(
        data.deleted > 0
          ? `${fmtId(data.deleted)} lamaran demo dibersihkan.`
          : "Tidak ada data demo untuk dibersihkan.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal membersihkan data demo.");
    } finally {
      setBusy("");
      setConfirmCleanup(false);
    }
  }

  const working = busy !== "";
  const isBurstRunning = running && status?.mode === "burst";
  // Progres lonjakan memakai runGenerated (lamaran LARI INI), bukan kumulatif —
  // agar bilah kemajuan tetap benar bila lonjakan dijalankan dua kali tanpa
  // bersih-bersih (penghitung kumulatif tetap tampil di badge tombol Demo).
  const progressPct =
    isBurstRunning && status?.targetTotal
      ? Math.min(100, Math.round((status.runGenerated / status.targetTotal) * 100))
      : 0;
  const settingsDisabled = running || working || !canMutate;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn("h-10 rounded-xl", running && "border-rose-300 text-rose-700 dark:text-rose-400")}
            aria-label="Simulator pelamar demo"
          >
            <FlaskConical className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Demo</span>
            {running ? (
              <span className="relative flex size-2" aria-hidden="true">
                {!reducedMotion && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" />
                )}
                <span className="relative inline-flex size-2 rounded-full bg-rose-600" />
              </span>
            ) : null}
            {status && status.generated > 0 ? (
              <span
                className="rounded-full bg-rose-100 px-1.5 text-xs font-medium text-rose-700 tabular-nums dark:bg-rose-950 dark:text-rose-300"
                aria-label={`${status.generated} lamaran demo dibuat`}
              >
                {fmtId(status.generated)}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 p-4">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold">Simulator Pelamar Demo</p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                Lamaran lengkap dibuat otomatis — pilih mode santai (satu per beberapa
                detik) atau lonjakan trafik (banyak pelamar per detik, seperti trafik
                asli). Datanya masuk realtime ke tabel ini, kanban, dan dashboard.
              </p>
            </div>

            {/* Status simulasi */}
            <div
              className={cn(
                "rounded-lg border p-3 text-xs",
                running
                  ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                  : "bg-muted/50 text-muted-foreground",
              )}
              role="status"
            >
              {running ? (
                isBurstRunning ? (
                  <p className="font-medium">
                    Lonjakan aktif — target {fmtId(status?.ratePerSec ?? 0)}/s ·{" "}
                    {status?.durationSec != null
                      ? `${fmtId(status.durationSec)} detik`
                      : "terus"}
                  </p>
                ) : (
                  <p className="font-medium">
                    Aktif — {status?.intervalSec ?? 15} detik · {targetLabel}
                  </p>
                )
              ) : (
                <p className="font-medium">Tidak aktif</p>
              )}
              <p className="mt-1 tabular-nums">
                {isBurstRunning ? (
                  <>
                    Lonjakan ini: <span className="font-medium">{fmtId(status?.runGenerated ?? 0)}</span>
                    {status?.targetTotal ? <> dari ±{fmtId(status.targetTotal)}</> : null}
                    {" "}· Aktual ±<span className="font-medium">{fmtId(status?.recentPerSec ?? 0)}</span>/s
                    {" "}· Kumulatif {fmtId(status?.generated ?? 0)}
                  </>
                ) : (
                  <>
                    Dibuat: <span className="font-medium">{fmtId(status?.generated ?? 0)}</span>
                  </>
                )}
                {(status?.failed ?? 0) > 0 ? (
                  <>
                    {" "}· Gagal: <span className="font-medium">{fmtId(status?.failed ?? 0)}</span>
                  </>
                ) : null}
                {isBurstRunning && (status?.inFlight ?? 0) > 0 ? (
                  <>
                    {" "}· Dalam proses: <span className="font-medium">{fmtId(status?.inFlight ?? 0)}</span>
                  </>
                ) : null}
                {!isBurstRunning && status?.lastAt ? (
                  <>
                    {" "}· Terakhir {timeLabel(status.lastAt)}
                  </>
                ) : null}
              </p>
              {isBurstRunning && status?.targetTotal ? (
                <div
                  className="bg-rose-200 mt-1.5 h-1.5 overflow-hidden rounded-full dark:bg-rose-900"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Kemajuan lonjakan"
                >
                  <div
                    className={cn("bg-rose-600 h-full rounded-full", !reducedMotion && "transition-all duration-500")}
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              ) : null}
              {status?.lastApplicant ? (
                <p className="mt-1 truncate">
                  Terakhir: {status.lastApplicant.name} — {status.lastApplicant.positionTitle} (
                  {status.lastApplicant.trackingCode})
                </p>
              ) : null}
              {status?.lastError ? (
                <p className="mt-1 text-amber-700 dark:text-amber-400">{status.lastError}</p>
              ) : null}
              {status?.note ? (
                <p className="mt-1 text-amber-700 dark:text-amber-400">{status.note}</p>
              ) : null}
            </div>

            {/* Pengaturan (berlaku saat Mulai berikutnya) */}
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs font-medium">Mode</span>
              <Select
                value={modeChoice}
                onValueChange={(value) => setModeChoice(value as DemoModeChoice)}
                disabled={settingsDisabled}
              >
                <SelectTrigger size="sm" aria-label="Mode simulasi">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interval">Santai — satu per beberapa detik</SelectItem>
                  <SelectItem value="burst">Lonjakan trafik — banyak per detik</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {modeChoice === "interval" ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">Interval</span>
                  <Select
                    value={intervalChoice}
                    onValueChange={setIntervalChoice}
                    disabled={settingsDisabled}
                  >
                    <SelectTrigger size="sm" aria-label="Interval simulasi">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTERVAL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">Posisi</span>
                  <Select
                    value={positionChoice}
                    onValueChange={setPositionChoice}
                    disabled={settingsDisabled}
                  >
                    <SelectTrigger size="sm" aria-label="Posisi target simulasi">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua posisi terbuka</SelectItem>
                      {openPositions.map((position) => (
                        <SelectItem key={position.id} value={position.id}>
                          {position.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">
                    Pelamar per detik
                  </span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={MIN_RATE}
                    max={MAX_RATE}
                    step={1}
                    value={rateInput}
                    onChange={(event) => setRateInput(event.target.value)}
                    disabled={settingsDisabled}
                    className="h-9 tabular-nums"
                    aria-label="Jumlah pelamar per detik"
                  />
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {RATE_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setRateInput(String(preset))}
                        disabled={settingsDisabled}
                        aria-pressed={rateNum === preset}
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-xs tabular-nums transition-colors disabled:opacity-50",
                          rateNum === preset
                            ? "border-rose-300 bg-rose-50 font-medium text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                            : "text-muted-foreground hover:border-rose-200 hover:text-rose-700 dark:hover:border-rose-900 dark:hover:text-rose-300",
                        )}
                      >
                        {preset}/dtk
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">Durasi lonjakan</span>
                  <Select
                    value={durationChoice}
                    onValueChange={setDurationChoice}
                    disabled={settingsDisabled}
                  >
                    <SelectTrigger size="sm" aria-label="Durasi lonjakan">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-muted-foreground text-xs font-medium">Posisi</span>
                  <Select
                    value={positionChoice}
                    onValueChange={setPositionChoice}
                    disabled={settingsDisabled}
                  >
                    <SelectTrigger size="sm" aria-label="Posisi target simulasi">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Semua posisi terbuka</SelectItem>
                      {openPositions.map((position) => (
                        <SelectItem key={position.id} value={position.id}>
                          {position.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  Perkiraan total: {estimateLabel}. Lonjakan membebani server sungguhan
                  (AI, notifikasi, database) — memang itulah tujuan latihannya.
                  {durationChoice === "0"
                    ? ` Mode terus berjalan sampai tombol Hentikan ditekan atau batas ${fmtId(MAX_BURST_TOTAL)} lamaran tercapai.`
                    : ""}
                </p>
              </div>
            )}

            {/* Aksi */}
            <div className="flex items-center gap-2">
              {running ? (
                <Button
                  variant="outline"
                  className="h-9 flex-1 rounded-lg border-rose-300 text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  onClick={() => void handleStop()}
                  disabled={working}
                >
                  {busy === "stop" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Square className="size-4" aria-hidden="true" />
                  )}
                  Hentikan
                </Button>
              ) : (
                <Button
                  className="h-9 flex-1 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                  onClick={() => void handleStart()}
                  disabled={working || !canMutate}
                >
                  {busy === "start" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="size-4" aria-hidden="true" />
                  )}
                  {modeChoice === "burst" ? "Mulai lonjakan" : "Mulai simulasi"}
                </Button>
              )}
              <Button
                variant="ghost"
                className="text-muted-foreground h-9 rounded-lg hover:text-rose-700"
                onClick={() => setConfirmCleanup(true)}
                disabled={working || !canMutate}
                aria-label="Bersihkan seluruh data demo"
              >
                {busy === "clean" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" aria-hidden="true" />
                )}
                Bersihkan
              </Button>
            </div>

            <Separator />

            <p className="text-muted-foreground text-xs leading-relaxed">
              Lamaran demo bertanda sumber <span className="font-medium">“Demo Simulator”</span>{" "}
              — bisa dibersihkan massal kapan saja lewat tombol Bersihkan (antrean AI
              miliknya ikut dibatalkan). Lonjakan berhenti sendiri saat durasi habis;
              simulator berhenti otomatis saat server dimulai ulang.
            </p>
          </div>
        </PopoverContent>
      </Popover>

      {/* Konfirmasi pembersihan data demo */}
      <AlertDialog open={confirmCleanup} onOpenChange={setConfirmCleanup}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bersihkan seluruh data demo?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua lamaran bertanda sumber “Demo Simulator” akan dihapus permanen,
              termasuk berkas CV/audio dan log aktivitasnya. Simulator juga akan
              dihentikan. Lamaran asli tidak terpengaruh.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "clean"}>Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={(event) => {
                event.preventDefault();
                void handleCleanup();
              }}
              disabled={busy === "clean"}
            >
              {busy === "clean" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Ya, bersihkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
