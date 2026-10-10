"use client";

// NR45 — Kartu "Kesehatan Server": snapshot beban real-time dari
// GET /api/admin/server-health (kontrak ServerLoadSnapshot di @/lib/types).
//
// Karakter penting:
// - Polling 30 detik + saat window focus; BERHENTI saat document.hidden
//   (siklus berikutnya otomatis jalan lagi); interval dibersihkan saat unmount.
// - Toleran gagal: endpoint backend (agen paralel) belum ada -> tampil catatan
//   kecil "Backend belum siap", tidak crash, dicoba lagi siklus berikutnya.
// - Kartu TIDAK tahu role: tombol aksi OWNER selalu tampil; bila server
//   menjawab 403 -> toast "Hanya OWNER dapat mengubah ini".
// - Panel "Mode Demo — Uji Cepat" (nested CollapsibleCard) untuk membuktikan
//   cache, antrean AI, log lambat, dan Mode Hemat tanpa data nyata.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Database,
  ExternalLink,
  FlaskConical,
  Info,
  Leaf,
  Loader2,
  PauseCircle,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import type { ServerLoadLevel, ServerLoadSnapshot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleCard } from "./collapsible-card";
import { apiGet, apiPost, ApiError } from "./api";
import { formatDateTime } from "./format";

const POLL_MS = 30_000;
const DEMO_REFRESH_TICKS = 5;
const DEMO_REFRESH_MS = 2_000;

// ------------------------------ helper format ------------------------------

// Uptime ramah id-ID: "2 hari 3 jam", "5 jam 12 menit", "3 menit".
function formatUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const days = Math.floor(sec / 86_400);
  const hours = Math.floor((sec % 86_400) / 3_600);
  const minutes = Math.floor((sec % 3_600) / 60);
  if (days > 0) return `${days} hari ${hours} jam`;
  if (hours > 0) return `${hours} jam ${minutes} menit`;
  if (minutes > 0) return `${minutes} menit`;
  return "<1 menit";
}

// Angka MB gaya id-ID (desimal koma): 12,4 MB.
function formatMb(mb: number): string {
  if (!Number.isFinite(mb)) return "—";
  return `${mb.toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB`;
}

function bytesToMb(bytes: number): number {
  return bytes / (1024 * 1024);
}

// Persen hit-rate 0..1 -> "83%"; null -> "—" (belum ada permintaan cache).
function formatHitRate(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

const LEVEL_BADGE: Record<ServerLoadLevel, { label: string; className: string }> = {
  OK: {
    label: "Sehat",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  },
  WARN: {
    label: "Waspada",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
  CRIT: {
    label: "Kritis",
    className:
      "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  },
};

// Pesan aksi yang toleran: 403 -> pesan OWNER; 404/0 -> backend belum siap.
function actionErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return "Hanya OWNER dapat mengubah ini";
    if (err.status === 404 || err.status === 501 || err.status === 0) {
      return "Backend belum siap — coba lagi beberapa saat.";
    }
    return err.message || fallback;
  }
  return fallback;
}

// ------------------------------ sel metrik ------------------------------

function MetricCell({
  label,
  value,
  hint,
  valueClass,
  badge,
}: {
  label: string;
  value: string;
  hint?: string;
  valueClass?: string;
  badge?: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {label}
        </p>
        {badge ? (
          <Badge className="shrink-0 border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
            {badge}
          </Badge>
        ) : null}
      </div>
      <p
        className={`mt-1 truncate font-bold tabular-nums ${valueClass ?? "text-base"}`}
        title={value}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {Array.from({ length: 9 }).map((_, i) => (
        <Skeleton key={i} className="h-[74px] rounded-lg" />
      ))}
    </div>
  );
}

// ------------------------------ komponen utama ------------------------------

export function ServerHealthCard() {
  const [snap, setSnap] = useState<ServerLoadSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);

  // Status loading tiap aksi demo/owner (semua tombol async punya loading state).
  const [cacheTesting, setCacheTesting] = useState(false);
  const [queueDemoBusy, setQueueDemoBusy] = useState(false);
  const [slowDemoBusy, setSlowDemoBusy] = useState(false);
  const [saveModeBusy, setSaveModeBusy] = useState(false);

  // Interval segarkan berkala setelah "Uji Antrean AI" (2 dtk, maks 5x) —
  // wajib dibersihkan saat unmount agar tidak bocor.
  const demoTimerRef = useRef<number | null>(null);

  // Muat snapshot. silent = tanpa skeleton ulang (polling / refresh aksi).
  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet<ServerLoadSnapshot>("/api/admin/server-health");
      setSnap(data);
      setFetchFailed(false);
    } catch {
      // Endpoint belum siap / sesi habis — catatan kecil, tanpa crash.
      setFetchFailed(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Polling 30 dtk + saat fokus jendela; PAUSE total saat document.hidden.
  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.hidden) return;
      void refresh(true);
    };
    const interval = window.setInterval(tick, POLL_MS);
    const onFocus = () => {
      if (document.hidden) return;
      void refresh(true);
    };
    const onVisibility = () => {
      if (!document.hidden) void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // Bersihkan timer demo saat unmount.
  useEffect(() => {
    return () => {
      if (demoTimerRef.current !== null) window.clearInterval(demoTimerRef.current);
    };
  }, []);

  /** Segarkan kartu berkala 2 dtk sebanyak maks 5x (setelah demo antrean AI). */
  const scheduleDemoRefresh = useCallback(() => {
    if (demoTimerRef.current !== null) window.clearInterval(demoTimerRef.current);
    let ticks = 0;
    demoTimerRef.current = window.setInterval(() => {
      ticks += 1;
      if (document.hidden) return; // hemat saat tab tidak terlihat
      void refresh(true);
      if (ticks >= DEMO_REFRESH_TICKS) {
        if (demoTimerRef.current !== null) {
          window.clearInterval(demoTimerRef.current);
          demoTimerRef.current = null;
        }
      }
    }, DEMO_REFRESH_MS);
  }, [refresh]);

  // ---- Aksi demo (semua respons POST bentuk {ok, ...} — toleran) ----

  /** Uji Cache: 6 fetch berurutan /api/public/content, baca header X-Cache. */
  async function runCacheTest() {
    setCacheTesting(true);
    let outside = 0;
    let fromCache = 0;
    try {
      for (let i = 0; i < 6; i++) {
        const res = await fetch("/api/public/content", { cache: "no-store" });
        const tag = (res.headers.get("X-Cache") ?? "").toUpperCase();
        if (tag.includes("HIT")) fromCache += 1;
        else outside += 1;
      }
      toast.success(`${outside} di luar cache, ${fromCache} dari cache`);
      void refresh(true);
    } catch {
      toast.error("Uji cache gagal dijalankan — periksa koneksi.");
    } finally {
      setCacheTesting(false);
    }
  }

  /** Uji Antrean AI: server membuat tugas dummy supaya angka antrean bergerak. */
  async function runQueueDemo() {
    setQueueDemoBusy(true);
    try {
      await apiPost<{ ok?: boolean }>("/api/admin/server-health", {
        action: "demoQueue",
      });
      toast.success("6 tugas demo masuk antrean — pantau angka Antrean AI");
      scheduleDemoRefresh();
    } catch (err) {
      toast.error(actionErrorMessage(err, "Uji antrean AI gagal dijalankan."));
    } finally {
      setQueueDemoBusy(false);
    }
  }

  /** Uji Log Lambat: server menunda ±900ms lalu mencatat SLOW_REQUEST. */
  async function runSlowDemo() {
    setSlowDemoBusy(true);
    try {
      await apiPost<{ ok?: boolean }>("/api/admin/server-health", {
        action: "demoSlow",
      });
      toast.success("Permintaan lambat demo tercatat (±0,9 dtk) — lihat tab Log");
      void refresh(true);
    } catch (err) {
      toast.error(actionErrorMessage(err, "Uji log lambat gagal dijalankan."));
    } finally {
      setSlowDemoBusy(false);
    }
  }

  /** Mode Hemat manual ON/OFF (OWNER; 403 -> toast). */
  async function toggleSaveMode(on: boolean) {
    setSaveModeBusy(true);
    try {
      await apiPost<{ ok?: boolean }>("/api/admin/server-health", {
        action: on ? "saveModeOn" : "saveModeOff",
      });
      toast.success(
        on
          ? "Mode Hemat diaktifkan (manual) — tugas AI ditunda sampai dinonaktifkan."
          : "Mode Hemat dinonaktifkan — antrean AI berjalan normal.",
      );
      void refresh(true);
    } catch (err) {
      toast.error(actionErrorMessage(err, "Gagal mengubah Mode Hemat."));
    } finally {
      setSaveModeBusy(false);
    }
  }

  const saveModeActive = snap?.saveMode.active === true;
  const levelMeta = snap ? LEVEL_BADGE[snap.level] : null;

  return (
    <CollapsibleCard
      id="kesehatan-server"
      icon={Activity}
      title="Kesehatan Server"
      description="Beban server saat ini: latensi DB, memori, antrean AI, cache, dan Mode Hemat."
      defaultOpen
      actions={
        levelMeta ? (
          <Badge variant="outline" className={`shrink-0 ${levelMeta.className}`}>
            {levelMeta.label}
          </Badge>
        ) : null
      }
    >
      {/* Catatan kecil bila fetch gagal (endpoint backend belum ada) */}
      {fetchFailed ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <span>Backend belum siap — snapshot belum tersedia. Dicoba ulang otomatis.</span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950"
            onClick={() => void refresh(true)}
          >
            Coba Lagi
          </Button>
        </div>
      ) : null}

      {/* Alasan level (bila tidak OK) */}
      {snap && snap.reasons.length > 0 ? (
        <ul className="flex flex-col gap-1 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
          {snap.reasons.map((reason, i) => (
            <li key={`${reason}-${i}`} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500"
              />
              <span className="text-amber-900 dark:text-amber-200">{reason}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Grid metrik (9 sel) */}
      {loading && !snap ? (
        <SkeletonGrid />
      ) : snap ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <MetricCell
            label="Latensi DB"
            value={snap.db.ok ? `${snap.db.latencyMs} ms` : "Tidak merespons"}
            valueClass={
              snap.db.ok ? "text-base" : "text-sm font-semibold text-rose-600 dark:text-rose-400"
            }
          />
          <MetricCell
            label="Memori RSS"
            value={formatMb(snap.memory.rssMb)}
            hint={`Heap ${formatMb(snap.memory.heapUsedMb)}`}
          />
          <MetricCell label="Uptime" value={formatUptime(snap.uptimeSec)} />
          <MetricCell label="Ukuran DB" value={formatMb(bytesToMb(snap.disk.dbBytes))} />
          <MetricCell
            label="Email"
            value={`${snap.email.queued} antre`}
            hint={`${snap.email.failed} gagal`}
          />
          <MetricCell
            label="Permintaan Lambat (24 jam)"
            value={String(snap.slowRequests.count24h)}
            hint={`ambang ${snap.slowRequests.thresholdMs} ms`}
          />
          <MetricCell
            label="Cache Hit-Rate"
            value={formatHitRate(snap.cache.hitRate)}
            hint={`size ${snap.cache.size}`}
          />
          <MetricCell
            label="Antrean AI"
            value={`${snap.aiQueue.waiting} menunggu`}
            hint={`berjalan ${snap.aiQueue.running} · maks ${snap.aiQueue.maxConcurrent}`}
            badge={snap.aiQueue.paused ? "ditunda" : undefined}
          />
          <MetricCell
            label="Realtime"
            value={snap.realtime.ok ? "Hidup" : "Mati"}
            valueClass={
              snap.realtime.ok
                ? "text-base text-emerald-600 dark:text-emerald-400"
                : "text-base text-rose-600 dark:text-rose-400"
            }
          />
        </div>
      ) : null}

      {/* Waktu cek terakhir */}
      {snap ? (
        <p className="text-xs text-muted-foreground">
          Cek terakhir: {formatDateTime(snap.checkedAt)}
        </p>
      ) : null}

      {/* Banner Mode Hemat (bila aktif) */}
      {snap?.saveMode.active ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <Leaf className="size-4 shrink-0" aria-hidden="true" />
              Mode Hemat aktif
              <Badge
                variant="outline"
                className="border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
              >
                {snap.saveMode.source}
              </Badge>
            </p>
            <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
              {snap.saveMode.reason.trim() || "Tugas AI ditunda untuk menghemat beban server."}
            </p>
            {snap.saveMode.since ? (
              <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
                Sejak {formatDateTime(snap.saveMode.since)}
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            className="h-11 shrink-0 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950"
            disabled={saveModeBusy}
            onClick={() => void toggleSaveMode(false)}
          >
            {saveModeBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Leaf className="size-4" aria-hidden="true" />
            )}
            Nonaktifkan Mode Hemat
          </Button>
        </div>
      ) : null}

      {/* Panel Mode Demo — Uji Cepat (kartu collapsible kedua di dalam kartu) */}
      <CollapsibleCard
        id="kesehatan-server-demo"
        icon={FlaskConical}
        title="Mode Demo — Uji Cepat"
        description="Aman dipakai — tidak mengubah data nyata"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-11 justify-start"
            disabled={cacheTesting}
            onClick={() => void runCacheTest()}
          >
            {cacheTesting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Database className="size-4" aria-hidden="true" />
            )}
            {cacheTesting ? "Menguji cache..." : "Uji Cache"}
          </Button>

          <Button
            variant="outline"
            className="h-11 justify-start"
            disabled={queueDemoBusy}
            onClick={() => void runQueueDemo()}
          >
            {queueDemoBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Bot className="size-4" aria-hidden="true" />
            )}
            Uji Antrean AI
          </Button>

          <Button
            variant="outline"
            className="h-11 justify-start"
            disabled={slowDemoBusy}
            onClick={() => void runSlowDemo()}
          >
            {slowDemoBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Timer className="size-4" aria-hidden="true" />
            )}
            {slowDemoBusy ? "Merekam (±1 dtk)..." : "Uji Log Lambat"}
          </Button>

          <Button
            variant="outline"
            className="h-11 justify-start"
            disabled={saveModeBusy}
            onClick={() => void toggleSaveMode(!saveModeActive)}
          >
            {saveModeBusy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : saveModeActive ? (
              <PauseCircle className="size-4" aria-hidden="true" />
            ) : (
              <Leaf className="size-4" aria-hidden="true" />
            )}
            {saveModeActive ? "Nonaktifkan Mode Hemat" : "Aktifkan Mode Hemat (manual)"}
          </Button>
        </div>

        {/* Baris Mode Perawatan: bantuan + tombol buka halaman publik */}
        <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Mode Perawatan:</span>{" "}
            aktifkan lewat Pengaturan &gt; Mode Perawatan.
          </p>
          <Button
            variant="outline"
            className="h-11 shrink-0"
            onClick={() => window.open("/", "_blank", "noopener")}
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            Buka Halaman Publik
          </Button>
        </div>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Ingin antrean AI berisi lamaran nyata? Jalankan Simulator Pelamar di tab Pelamar.
        </p>
      </CollapsibleCard>
    </CollapsibleCard>
  );
}
