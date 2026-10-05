"use client";

// Kontrol Simulator Pelamar Demo (Mode Demo) — dipasang di toolbar tab Pelamar.
// Mulai/hentikan simulasi lamaran otomatis: pilih interval & target posisi,
// pantau penghitung, dan bersihkan seluruh data demo dari satu popover.
// API: /api/admin/demo-simulator (GET status, POST start/stop, DELETE bersihkan).

import { useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { FlaskConical, Loader2, Play, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  intervalSec: number;
  positionId: string | null;
  generated: number;
  failed: number;
  startedAt: string | null;
  lastAt: string | null;
  lastError: string | null;
  note: string | null;
  lastApplicant: { name: string; positionTitle: string; trackingCode: string } | null;
};

const INTERVAL_OPTIONS = [
  { value: "10", label: "Setiap 10 detik" },
  { value: "15", label: "Setiap 15 detik" },
  { value: "30", label: "Setiap 30 detik" },
  { value: "60", label: "Setiap 1 menit" },
];

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
  const [intervalChoice, setIntervalChoice] = useState("15");
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
  useEffect(() => {
    if (!open && !running) return;
    const timer = setInterval(() => void loadStatus(), 4000);
    return () => clearInterval(timer);
  }, [open, running, loadStatus]);

  const openPositions = positions.filter((p) => p.isActive && p.applyOpen);
  const targetLabel = status?.positionId
    ? (openPositions.find((p) => p.id === status.positionId)?.title ?? "Posisi")
    : "Semua posisi terbuka";

  async function handleStart() {
    setBusy("start");
    try {
      const data = await apiPost<{ ok: boolean; status: DemoStatus }>(
        "/api/admin/demo-simulator",
        {
          action: "start",
          intervalSec: Number(intervalChoice),
          positionId: positionChoice === "ALL" ? null : positionChoice,
        },
      );
      setStatus(data.status);
      toast.success("Simulasi dimulai — lamaran demo akan masuk otomatis.");
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
          ? `${data.deleted} lamaran demo dibersihkan.`
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
                {status.generated}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>

        <PopoverContent align="end" className="w-80 p-4">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold">Simulator Pelamar Demo</p>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                Lamaran lengkap dibuat otomatis setiap beberapa saat — datanya masuk
                realtime ke tabel ini, kanban, dan dashboard.
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
                <p className="font-medium">
                  Aktif — {status?.intervalSec ?? 15} detik · {targetLabel}
                </p>
              ) : (
                <p className="font-medium">Tidak aktif</p>
              )}
              <p className="mt-1 tabular-nums">
                Dibuat: <span className="font-medium">{status?.generated ?? 0}</span>
                {(status?.failed ?? 0) > 0 ? (
                  <>
                    {" "}· Gagal: <span className="font-medium">{status?.failed}</span>
                  </>
                ) : null}
                {status?.lastAt ? (
                  <>
                    {" "}· Terakhir {timeLabel(status.lastAt)}
                  </>
                ) : null}
              </p>
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
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs font-medium">Interval</span>
                <Select
                  value={intervalChoice}
                  onValueChange={setIntervalChoice}
                  disabled={running || working || !canMutate}
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
                  disabled={running || working || !canMutate}
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
                  Mulai simulasi
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
              — bisa dibersihkan massal kapan saja lewat tombol Bersihkan. Simulator berhenti
              otomatis saat server dimulai ulang.
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
