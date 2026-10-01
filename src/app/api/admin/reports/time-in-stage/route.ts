// GET /api/admin/reports/time-in-stage?positionId=&days=90 — laporan kecepatan proses
// per tahap pipeline (time-in-stage). Semua role admin boleh melihat (mengikuti pola
// reports/funnel yang hanya memakai getSession()).
//
// Algoritma rekonstruksi timeline per lamaran (deletedAt null, createdAt >= ambang):
//   a. Waktu masuk tahap pertama = application.createdAt.
//   b. Tiap ActivityLog action STATUS_CHANGE (urut createdAt) yang detailnya memuat
//      panah " → " (format route PATCH applications: `${labelLama} → ${labelBaru}`)
//      menandakan tahap sebelumnya BERAKHIR di createdAt log; durasi tahap =
//      createdAt(log) - waktuMasukTahap, lalu tahap baru mulai.
//   c. Tahap terakhir yang belum berakhir:
//      - bila lamaran berstatus REJECTED/ACCEPTED dan ada log STATUS_CHANGE setelah
//        tahap itu dimulai -> tahap ditutup pada log terakhir (segmen selesai);
//      - selain itu tahap masih berjalan = now - waktuMasukTahap (penanda "berjalan").
//      Untuk lamaran tanpa log panah cukup, tahap berjalan diambil dari status live
//      (labelOf(status)) dengan waktu masuk stageUpdatedAt ?? createdAt.
//
// Log STATUS_CHANGE tanpa panah (mis. "Ditolak — alasan: ...") tidak membentuk segmen,
// tetapi tetap dihitung sebagai penutup tahap pada aturan (c).
//
// Efisiensi: lamaran & log diambil sekali (where applicationId IN ids terfilter +
// action STATUS_CHANGE + createdAt >= ambang) lalu dikelompokkan di memori.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { isBuiltInStage } from "@/lib/stages";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Posisi tidak ditemukan." };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const ARROW = " → "; // simbol yang sama dengan route PATCH applications/[id]
const ALLOWED_DAYS: readonly number[] = [30, 90, 180];
const DEFAULT_DAYS = 90;

/** Urutan pipeline tahap bawaan (tahap kustom selalu mengikuti di akhir). */
const BUILT_IN_ORDER: ApplicationStatus[] = [
  "NEW",
  "REVIEWED",
  "INTERVIEW",
  "ACCEPTED",
  "REJECTED",
];

/** Peta label tampilan -> kunci tahap bawaan (kebalikan STATUS_LABELS). */
const LABEL_TO_STAGE = new Map<string, ApplicationStatus>(
  (Object.entries(STATUS_LABELS) as [ApplicationStatus, string][]).map(
    ([key, label]) => [label, key]
  )
);

const BUILT_IN_LABELS = new Set<string>(Object.values(STATUS_LABELS));

function labelOf(status: string): string {
  return isBuiltInStage(status) ? STATUS_LABELS[status as ApplicationStatus] : status;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

type Agg = { count: number; hoursList: number[]; ongoing: number };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const positionId = searchParams.get("positionId")?.trim() ?? "";
    const rawDays = Number(searchParams.get("days") ?? "");
    const days = ALLOWED_DAYS.includes(rawDays) ? rawDays : DEFAULT_DAYS;
    const threshold = new Date(Date.now() - days * DAY_MS);

    let positionTitle: string | null = null;
    if (positionId) {
      const pos = await db.position.findUnique({
        where: { id: positionId },
        select: { title: true },
      });
      if (!pos) {
        return NextResponse.json(NOT_FOUND, { status: 404 });
      }
      positionTitle = pos.title;
    }

    const apps = await db.application.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: threshold },
        ...(positionId ? { positionId } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        createdAt: true,
        stageUpdatedAt: true,
      },
    });

    const ids = apps.map((a) => a.id);
    const logs =
      ids.length > 0
        ? await db.activityLog.findMany({
            where: {
              action: "STATUS_CHANGE",
              applicationId: { in: ids },
              createdAt: { gte: threshold },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: { applicationId: true, detail: true, createdAt: true },
          })
        : [];

    const logsByApp = new Map<string, { detail: string | null; createdAt: Date }[]>();
    for (const log of logs) {
      if (!log.applicationId) continue;
      const list = logsByApp.get(log.applicationId) ?? [];
      list.push({ detail: log.detail, createdAt: log.createdAt });
      logsByApp.set(log.applicationId, list);
    }

    const aggByLabel = new Map<string, Agg>();
    // Urutan kemunculan pertama tahap kustom (untuk pengurutan di akhir pipeline).
    const customOrder: string[] = [];
    const aggFor = (label: string): Agg => {
      let agg = aggByLabel.get(label);
      if (!agg) {
        agg = { count: 0, hoursList: [], ongoing: 0 };
        aggByLabel.set(label, agg);
        if (!BUILT_IN_LABELS.has(label)) customOrder.push(label);
      }
      return agg;
    };

    for (const app of apps) {
      const appLogs = logsByApp.get(app.id) ?? [];
      const liveStatus = app.status && app.status.trim().length > 0 ? app.status : "NEW";

      let segStartMs = app.createdAt.getTime();
      let segStage: string | null = null; // label tahap yang sedang terbuka
      let lastStatusLogMs: number | null = null;

      for (const log of appLogs) {
        const atMs = log.createdAt.getTime();
        if (lastStatusLogMs === null || atMs > lastStatusLogMs) lastStatusLogMs = atMs;

        const detail = (log.detail ?? "").trim();
        const idx = detail.lastIndexOf(ARROW);
        if (idx < 0) continue; // STATUS_CHANGE tanpa panah — tidak membentuk segmen
        const fromLabel = detail.slice(0, idx).trim();
        const toLabel = detail.slice(idx + ARROW.length).trim();
        if (!fromLabel || !toLabel) continue;

        // Tahap sebelumnya berakhir pada log ini. Segmen pertama memakai label lama
        // dari log itu sendiri (sumber terbaik untuk tahap awal lamaran).
        const openLabel = segStage ?? fromLabel;
        const agg = aggFor(openLabel);
        agg.count += 1;
        agg.hoursList.push(Math.max(0, (atMs - segStartMs) / HOUR_MS));

        segStage = toLabel;
        segStartMs = atMs;
      }

      const hasArrows = segStage !== null;
      const residualStartMs = hasArrows
        ? segStartMs
        : (app.stageUpdatedAt ?? app.createdAt).getTime();
      const residualLabel = hasArrows ? (segStage as string) : labelOf(liveStatus);
      const isTerminal = liveStatus === "REJECTED" || liveStatus === "ACCEPTED";

      if (
        hasArrows &&
        isTerminal &&
        lastStatusLogMs !== null &&
        lastStatusLogMs > residualStartMs
      ) {
        // (c) Lamaran final: tahap terakhir ditutup pada log STATUS_CHANGE terakhir.
        const agg = aggFor(residualLabel);
        agg.count += 1;
        agg.hoursList.push(Math.max(0, (lastStatusLogMs - residualStartMs) / HOUR_MS));
      } else {
        // Tahap masih berjalan s.d. now (tidak ikut rata-rata/median).
        const agg = aggFor(residualLabel);
        agg.ongoing += 1;
      }
    }

    // Urutkan: tahap bawaan mengikuti alur pipeline, tahap kustom di akhir.
    const orderedLabels: string[] = [];
    for (const key of BUILT_IN_ORDER) {
      const label = STATUS_LABELS[key];
      if (aggByLabel.has(label)) orderedLabels.push(label);
    }
    for (const label of customOrder) {
      if (aggByLabel.has(label) && !orderedLabels.includes(label)) orderedLabels.push(label);
    }

    const stages = orderedLabels.map((label) => {
      const agg = aggByLabel.get(label)!;
      const avg =
        agg.hoursList.length > 0
          ? agg.hoursList.reduce((sum, v) => sum + v, 0) / agg.hoursList.length
          : null;
      const median = medianOf(agg.hoursList);
      return {
        stage: LABEL_TO_STAGE.get(label) ?? label,
        label,
        count: agg.count,
        avgHours: avg === null ? null : round1(avg),
        medianHours: median === null ? null : round1(median),
        ongoing: agg.ongoing,
      };
    });

    // Tahap paling lambat: avgHours terbesar di antara tahap dengan segmen selesai.
    let slowestLabel: string | null = null;
    let slowestAvg = -1;
    for (const row of stages) {
      if (row.avgHours !== null && row.avgHours > slowestAvg) {
        slowestAvg = row.avgHours;
        slowestLabel = row.label;
      }
    }

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      days,
      positionTitle,
      stages,
      slowestLabel,
      totalApplications: apps.length,
    });
  } catch (error) {
    console.error("[GET /api/admin/reports/time-in-stage]", error);
    return NextResponse.json(
      { error: "Gagal memuat laporan kecepatan proses. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
