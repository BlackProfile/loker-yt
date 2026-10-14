"use client";

// NR49 Paket C — Kartu "Risiko Tidak Hadir & Offer" di Dashboard.
// Daftar kandidat berisiko (wawancara berpotensi tidak hadir / offer tak
// dijawab) dengan skor heuristik deterministik dari server. Tombol "Tanya AI"
// meminta penjelasan naratif + saran tindakan (ditampilkan inline di bawah item).
// NR55-C — aksi cepat per item: "Detail" (dialog detail pelamar, pola sama
// dengan dashboard-tab: butuh objek Application penuh) dan "Kirim Reminder"
// untuk item offer saja (endpoint remind hanya berlaku utk offer PENDING).
// Polling 5 menit (detik dilewati saat tab tersembunyi; interval dibersihkan).

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  BellRing,
  Eye,
  Loader2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { Application } from "@/lib/types";
import { CollapsibleCard, type CardStatus } from "./collapsible-card";
import { ApplicationDetailDialog } from "./application-detail-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, apiPost } from "./api";
import { useAdminSession } from "./admin-context";
import { formatRelative } from "./format";
import { cn } from "@/lib/utils";

type RiskItem = {
  kind: "interview" | "offer";
  id: string;
  // NR55-C — id lamaran dari backend (interview & offer sama-sama mengirim).
  applicationId: string;
  name: string;
  positionTitle: string | null;
  when: string | null;
  score: number;
  reasons: string[];
};

type RiskExplain = { reason: string; suggestion: string };

function scoreBadgeClass(score: number): string {
  if (score >= 70) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-400";
  }
  if (score >= 40) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300";
}

function scoreLabel(score: number): string {
  if (score >= 70) return `Tinggi · ${score}`;
  if (score >= 40) return `Sedang · ${score}`;
  return `Rendah · ${score}`;
}

export function RiskScoresCard() {
  const { canMutate, reportError } = useAdminSession();

  const [items, setItems] = useState<RiskItem[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [explain, setExplain] = useState<Record<string, RiskExplain>>({});
  const [explainBusyId, setExplainBusyId] = useState<string | null>(null);
  // NR55-C — dialog detail pelamar (pola dashboard-tab: butuh Application penuh)
  // + status sibuk per aksi (anti dobel klik).
  const [detail, setDetail] = useState<Application | null>(null);
  const [detailBusyId, setDetailBusyId] = useState<string | null>(null);
  const [remindBusyId, setRemindBusyId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await apiGet<{ items: RiskItem[] }>("/api/admin/risk-scores");
      if (!mountedRef.current) return;
      setItems(res.items);
      setLoadFailed(false);
    } catch {
      if (!mountedRef.current) return;
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void load();
    }, 5 * 60 * 1000);
    return () => {
      mountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [load]);

  async function askAi(item: RiskItem) {
    if (explainBusyId) return;
    setExplainBusyId(item.id);
    try {
      const res = await apiPost<RiskExplain>("/api/admin/risk-explain", {
        kind: item.kind,
        id: item.id,
      });
      setExplain((prev) => ({ ...prev, [item.id]: res }));
    } catch (err) {
      reportError(err);
    } finally {
      setExplainBusyId(null);
    }
  }

  // NR55-C — buka dialog detail pelamar. Dialog butuh objek Application penuh
  // (bukan hanya id), jadi ikuti pola dashboard-tab openAppById: ambil daftar
  // lamaran lalu cari barisnya.
  async function openDetail(item: RiskItem) {
    if (detailBusyId) return;
    setDetailBusyId(item.id);
    try {
      const apps = await apiGet<Application[]>("/api/admin/applications");
      if (!mountedRef.current) return;
      const app = apps.find((a) => a.id === item.applicationId);
      if (app) {
        setDetail(app);
      } else {
        toast.error("Lamaran tidak ditemukan.");
      }
    } catch (err) {
      reportError(err);
    } finally {
      if (mountedRef.current) setDetailBusyId(null);
    }
  }

  // NR55-C — kirim email pengingat penawaran (hanya item kind "offer":
  // endpoint remind menolak selain offerStatus PENDING).
  async function sendReminder(item: RiskItem) {
    if (remindBusyId) return;
    if (!canMutate) {
      toast.error("Anda tidak memiliki akses untuk aksi ini.");
      return;
    }
    setRemindBusyId(item.id);
    try {
      const res = await apiPost<{ ok?: boolean; alreadySent?: boolean; message?: string }>(
        `/api/admin/applications/${item.applicationId}/remind`
      );
      if (res.alreadySent) {
        toast.info(res.message ?? "Email pengingat untuk offer ini sudah pernah dikirim.");
      } else {
        toast.success(`Pengingat dikirim ke ${item.name}`);
      }
      // Segarkan daftar risiko (status kandidat bisa berubah setelah email).
      void load();
    } catch (err) {
      reportError(err);
    } finally {
      setRemindBusyId(null);
    }
  }

  const count = items?.length ?? 0;
  const hasHigh = (items ?? []).some((item) => item.score >= 70);
  const status: CardStatus =
    items == null
      ? { label: "Memuat...", tone: "neutral" }
      : count === 0
        ? { label: "Tidak ada", tone: "ok" }
        : { label: `${count} kandidat berisiko`, tone: hasHigh ? "danger" : "warn" };

  return (
    <CollapsibleCard
      id="risk-scores"
      icon={ShieldAlert}
      title="Risiko Tidak Hadir & Offer"
      description="Kandidat wawancara 7 hari ke depan dan offer menunggu jawaban yang perlu diperhatikan."
      status={status}
    >
      {items == null ? (
        loadFailed ? (
          <div className="flex flex-col items-start gap-2">
            <p className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              Belum dapat memuat skor risiko.
            </p>
            <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
              Coba Lagi
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2" aria-live="polite">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-3/4 rounded-xl" />
          </div>
        )
      ) : count === 0 ? (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          Tidak ada kandidat berisiko saat ini.
        </p>
      ) : (
        <ul className="nice-scrollbar flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
          {items.map((item) => {
            const itemExplain = explain[item.id];
            return (
              <li key={`${item.kind}-${item.id}`} className="flex flex-col gap-2 rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{item.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.positionTitle ?? "Posisi telah dihapus"}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0",
                      item.kind === "interview"
                        ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
                    )}
                  >
                    {item.kind === "interview" ? "Wawancara" : "Offer"}
                  </Badge>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatRelative(item.when)}
                  </span>
                  <Badge variant="outline" className={cn("shrink-0 tabular-nums", scoreBadgeClass(item.score))}>
                    {scoreLabel(item.score)}
                  </Badge>
                </div>

                {item.reasons.length > 0 ? (
                  <p className="text-xs leading-relaxed text-muted-foreground">{item.reasons.join(" · ")}</p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 w-fit text-xs sm:h-9"
                    onClick={() => void askAi(item)}
                    disabled={explainBusyId !== null}
                  >
                    {explainBusyId === item.id ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        Menjelaskan...
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3.5" aria-hidden="true" />
                        Tanya AI
                      </>
                    )}
                  </Button>
                  {/* NR55-C — Detail: dialog detail pelamar (butuh Application penuh). */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 w-fit text-xs sm:h-9"
                    onClick={() => void openDetail(item)}
                    disabled={detailBusyId !== null}
                    aria-label={`Buka detail lamaran ${item.name}`}
                  >
                    {detailBusyId === item.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Eye className="size-3.5" aria-hidden="true" />
                    )}
                    Detail
                  </Button>
                  {/* Kirim Reminder hanya utk offer — endpoint remind menolak
                      selain offerStatus PENDING (409 untuk baris wawancara). */}
                  {item.kind === "offer" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 w-fit text-xs sm:h-9"
                      onClick={() => void sendReminder(item)}
                      disabled={remindBusyId !== null}
                      title="Kirim email pengingat jawaban penawaran (maks satu kali per offer)"
                      aria-label={`Kirim pengingat penawaran ke ${item.name}`}
                    >
                      {remindBusyId === item.id ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <BellRing className="size-3.5" aria-hidden="true" />
                      )}
                      Kirim Reminder
                    </Button>
                  ) : null}
                </div>

                {itemExplain ? (
                  <div className="rounded-lg border bg-zinc-50/60 p-2.5 dark:bg-zinc-900/40">
                    <p className="text-sm font-medium leading-relaxed">
                      <BadgeCheck className="mr-1 inline size-3.5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                      {itemExplain.reason}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Saran: {itemExplain.suggestion}
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {/* NR55-C — dialog detail pelamar milik kartu ini (self-sufficient dengan
          objek Application + callback; pola pemasangan sama dengan dashboard-tab). */}
      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={() => {
          // Perubahan dari dialog (status/HOLD/offer dsb.) bisa mengubah skor
          // risiko — segarkan daftar.
          void load();
        }}
        onDeleted={() => {
          setDetail(null);
          void load();
        }}
      />
    </CollapsibleCard>
  );
}
