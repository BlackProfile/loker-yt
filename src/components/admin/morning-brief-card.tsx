"use client";

// NR49 Paket C — Kartu "Brief Pagi AI" di Dashboard.
// Brief harian (narasi Kemarin / Hari ini / Perlu ditindak) dibuat LLM dari angka
// konteks rekrutmen; cache per hari di server. OWNER/HR bisa memperbarui manual.
// Semua role bisa membaca. Gagal gate AI (503) ditampilkan sebagai pesan amber
// di dalam kartu — tidak pernah membuat kartu crash.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Sparkles, Sunrise } from "lucide-react";
import { toast } from "sonner";
import { CollapsibleCard, type CardStatus } from "./collapsible-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost, ApiError } from "./api";
import { useAdminSession } from "./admin-context";
import { formatTime } from "./format";

type Brief = { content: string; generatedAt: string };

export function MorningBriefCard() {
  const { role, reportError } = useAdminSession();
  const canManage = role === "OWNER" || role === "HR";

  const [brief, setBrief] = useState<Brief | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [gateMessage, setGateMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ brief: Brief | null }>("/api/admin/morning-brief");
      setBrief(res.brief);
    } catch {
      // kartu tetap tampil — brief hanya opsional
    } finally {
      setLoading(false);
    }
  }, []);

  // Kartu defaultOpen — muat brief saat terpasang (bila belum ada, OWNER/HR
  // melihat tombol "Buat Brief Sekarang", bukan auto-generate, agar hemat kuota).
  useEffect(() => {
    void load();
  }, [load]);

  async function generate(force: boolean) {
    if (busy) return;
    setBusy(true);
    setGateMessage(null);
    try {
      const res = await apiPost<{ brief: Brief }>("/api/admin/morning-brief", { force });
      setBrief(res.brief);
      toast.success(force ? "Brief diperbarui" : "Brief dibuat");
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setGateMessage(err.message);
      } else {
        reportError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  const status: CardStatus = brief
    ? { label: `Hari ini · ${formatTime(brief.generatedAt)}`, tone: "ok" }
    : { label: "Belum dibuat", tone: "neutral" };

  return (
    <CollapsibleCard
      id="morning-brief"
      icon={Sunrise}
      title="Brief Pagi AI"
      description="Ringkasan otomatis: lamaran kemarin, agenda wawancara hari ini, dan yang perlu ditindak."
      // NR62 — kartu ringkas: default TERTUTUP (muat data tetap jalan saat mount,
      // status chip "Hari ini · jam" tetap terlihat di header kartu).
      status={status}
    >
      {gateMessage ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{gateMessage}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <Skeleton className="h-4 w-3/4 rounded-full" />
          <Skeleton className="h-4 w-full rounded-full" />
          <Skeleton className="h-4 w-5/6 rounded-full" />
          <Skeleton className="h-4 w-2/3 rounded-full" />
        </div>
      ) : brief ? (
        <div className="nice-scrollbar max-h-72 overflow-y-auto rounded-xl border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <p className="whitespace-pre-line text-sm leading-relaxed">{brief.content}</p>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          Brief hari ini belum dibuat.
          {canManage
            ? " Buat sekarang untuk merangkum kondisi rekrutmen."
            : " Admin OWNER/HR dapat membuatnya dari kartu ini."}
        </p>
      )}

      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {brief ? (
            <Button
              variant="outline"
              className="h-11 w-fit sm:h-9"
              onClick={() => void generate(true)}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyusun brief...
                </>
              ) : (
                <>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Perbarui Brief
                </>
              )}
            </Button>
          ) : (
            <Button
              className="h-11 w-fit bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99] sm:h-9"
              onClick={() => void generate(false)}
              disabled={busy}
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyusun brief...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden="true" />
                  Buat Brief Sekarang
                </>
              )}
            </Button>
          )}
        </div>
      ) : null}
    </CollapsibleCard>
  );
}
