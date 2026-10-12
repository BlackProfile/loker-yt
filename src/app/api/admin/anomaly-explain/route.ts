// POST /api/admin/anomaly-explain — Penjelasan Anomali angka dashboard (NR49 Paket B).
// Server mengumpulkan ANGKA KONKRET sesuai metric (4 metrik), lalu LLM menjelaskan
// kemungkinan penyebab berdasarkan angka tersebut (tanpa mengarang) + 3 saran
// tindakan. Semua role yang login boleh memakai (hanya baca, tanpa aksi).
// Gate AI terpusat (withAiGate) — diblokir Pusat Kendali AI -> 503 pesan gate.
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage } from "@/lib/ai-json";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { stageLabel } from "@/lib/stages";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

const METRICS = ["applications_7d", "dropoff_7d", "stage_stuck", "offers_pending"] as const;
type AnomalyMetric = (typeof METRICS)[number];
const METRIC_SET = new Set<string>(METRICS);

type StatLine = string[];

/** Metrik 1 — jumlah lamaran 7 hari vs 7 hari sebelumnya + posisi teratas. */
async function statApplications7d(): Promise<StatLine> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  const [current, previous, topRows, positions] = await Promise.all([
    db.application.count({ where: { createdAt: { gte: weekAgo }, deletedAt: null } }),
    db.application.count({
      where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo }, deletedAt: null },
    }),
    db.application.groupBy({
      by: ["positionId"],
      where: { createdAt: { gte: weekAgo }, deletedAt: null, positionId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { positionId: "desc" } },
      take: 3,
    }),
    db.position.findMany({ select: { id: true, title: true } }),
  ]);

  const titleOf = new Map(positions.map((p) => [p.id, p.title]));
  const topLines =
    topRows.length > 0
      ? topRows
          .map(
            (row) =>
              `- ${row.positionId ? titleOf.get(row.positionId) ?? "(posisi terhapus)" : "(tanpa posisi)"}: ${row._count._all} lamaran`
          )
          .join("\n")
      : "- (belum ada lamaran 7 hari terakhir)";

  const change =
    previous === 0
      ? current === 0
        ? "0 vs 0 (netral)"
        : `naik dari 0 menjadi ${current}`
      : `${current > previous ? "naik" : current < previous ? "turun" : "tetap"} ${Math.abs(
          Math.round(((current - previous) / previous) * 100)
        )}%`;

  return [
    `Lamaran 7 hari terakhir: ${current}`,
    `Lamaran 7 hari sebelumnya: ${previous}`,
    `Perubahan: ${change}`,
    "Posisi teratas 7 hari terakhir:",
    topLines,
  ];
}

/** Metrik 2 — drop-off formulir (FormStepStat) 7 hari vs sebelumnya. */
async function statDropoff7d(): Promise<StatLine> {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const twoWeeksAgo = new Date(now.getTime() - 14 * DAY_MS);

  const [currentRows, previousRows] = await Promise.all([
    db.formStepStat.groupBy({
      by: ["step", "event"],
      where: { createdAt: { gte: weekAgo } },
      _count: { _all: true },
    }),
    db.formStepStat.groupBy({
      by: ["event"],
      where: { createdAt: { gte: twoWeeksAgo, lt: weekAgo } },
      _count: { _all: true },
    }),
  ]);

  // Akumulasi per langkah untuk periode berjalan (pola rute /api/admin/dropoff).
  const byStep = new Map<number, { entered: number; advanced: number; submitted: number }>();
  for (const row of currentRows) {
    const acc = byStep.get(row.step) ?? { entered: 0, advanced: 0, submitted: 0 };
    if (row.event === "enter") acc.entered += row._count._all;
    else if (row.event === "advance") acc.advanced += row._count._all;
    else if (row.event === "submit") acc.submitted += row._count._all;
    byStep.set(row.step, acc);
  }

  const lastStep = [...byStep.keys()].reduce((max, s) => Math.max(max, s), 0);
  const stepLines: string[] = [];
  let worstStep: { step: number; dropPercent: number } | null = null;
  for (const step of [...byStep.keys()].sort((a, b) => a - b)) {
    const acc = byStep.get(step)!;
    const completed = step === lastStep ? acc.submitted : acc.advanced;
    const dropPercent =
      acc.entered > 0 ? Math.max(0, Math.min(100, 100 - (completed / acc.entered) * 100)) : 0;
    stepLines.push(
      `- Langkah ${step}: masuk ${acc.entered}, lanjut ${acc.advanced}, submit ${acc.submitted} (drop ${Math.round(dropPercent * 10) / 10}%)`
    );
    // Langkah dengan drop terbesar — hanya bila cukup sampel agar tidak berisik.
    if (acc.entered >= 5 && (!worstStep || dropPercent > worstStep.dropPercent)) {
      worstStep = { step, dropPercent: Math.round(dropPercent * 10) / 10 };
    }
  }

  const prevEvent = new Map<string, number>();
  for (const row of previousRows) prevEvent.set(row.event, row._count._all);

  return [
    "DROP-OFF FORMULIR 7 HARI TERAKHIR (per langkah wizard):",
    ...(stepLines.length > 0 ? stepLines : ["- (belum ada data langkah formulir)"]),
    worstStep
      ? `Langkah dengan drop terbesar: langkah ${worstStep.step} (drop ${worstStep.dropPercent}%)`
      : "Langkah dengan drop terbesar: belum dapat ditentukan (sampel kurang).",
    `Perbandingan 7 hari sebelumnya: masuk ${prevEvent.get("enter") ?? 0}, submit ${prevEvent.get("submit") ?? 0}, tinggalkan ${prevEvent.get("abandon") ?? 0}.`,
  ];
}

/** Metrik 3 — lamaran menetap per tahap lebih dari 14 hari (stageUpdatedAt). */
async function statStageStuck(): Promise<StatLine> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 14 * DAY_MS);

  const [rows, totalApplications] = await Promise.all([
    db.application.groupBy({
      by: ["status"],
      where: { stageUpdatedAt: { not: null, lt: cutoff }, deletedAt: null },
      _count: { _all: true },
      orderBy: { _count: { status: "desc" } },
    }),
    db.application.count({ where: { deletedAt: null } }),
  ]);

  const lines = rows
    .slice(0, 8)
    .map((row) => `- ${stageLabel(row.status.trim() || "NEW")} (${row.status}): ${row._count._all} lamaran`);

  return [
    `Total lamaran aktif: ${totalApplications}`,
    "LAMARAN YANG TIDAK BERUBAH TAHAP LEBIH DARI 14 HARI (per tahap, terbanyak dulu):",
    ...(lines.length > 0 ? lines : ["- (tidak ada lamaran yang menetap lebih dari 14 hari)"]),
  ];
}

/** Metrik 4 — offer menunggu jawaban: jumlah, usia rata-rata, terlama. */
async function statOffersPending(): Promise<StatLine> {
  const now = new Date();
  const [count, rows] = await Promise.all([
    db.application.count({ where: { offerStatus: "PENDING", deletedAt: null } }),
    db.application.findMany({
      where: { offerStatus: "PENDING", deletedAt: null },
      select: { offerSentAt: true, createdAt: true },
      orderBy: { offerSentAt: "asc" },
      take: 200,
    }),
  ]);

  const ages = rows
    .map((row) => (row.offerSentAt ?? row.createdAt))
    .filter((d): d is Date => d instanceof Date)
    .map((d) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS)));

  const avg = ages.length > 0 ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : null;
  const oldest = ages.length > 0 ? Math.max(...ages) : null;

  return [
    `Offer menunggu jawaban (PENDING): ${count}`,
    `Usia rata-rata offer: ${avg != null ? `${avg} hari` : "belum ada data"}`,
    `Offer terlama: ${oldest != null ? `${oldest} hari` : "belum ada data"}`,
  ];
}

const METRIC_LABELS: Record<AnomalyMetric, string> = {
  applications_7d: "jumlah lamaran 7 hari terakhir",
  dropoff_7d: "drop-off formulir lamaran 7 hari terakhir",
  stage_stuck: "lamaran yang menetap di satu tahap lebih dari 14 hari",
  offers_pending: "penawaran (offer) yang masih menunggu jawaban",
};

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    const metric =
      body && typeof body === "object" && typeof (body as { metric?: unknown }).metric === "string"
        ? ((body as { metric: string }).metric as string)
        : "";
    if (!METRIC_SET.has(metric)) {
      return NextResponse.json({ error: "Metrik tidak dikenal." }, { status: 400 });
    }
    const metricKey = metric as AnomalyMetric;

    const statLines =
      metricKey === "applications_7d"
        ? await statApplications7d()
        : metricKey === "dropoff_7d"
          ? await statDropoff7d()
          : metricKey === "stage_stuck"
            ? await statStageStuck()
            : await statOffersPending();

    const systemPrompt = [
      "Kamu adalah analis rekrutmen untuk panel admin studio konten kreator.",
      `Tugasmu: jelaskan kemungkinan penyebab anomali pada metrik "${METRIC_LABELS[metricKey]}".`,
      "ATURAN:",
      "- Gunakan HANYA angka pada blok ANGKA di bawah. DILARANG mengarang angka atau fakta di luar data.",
      "- Bahasa Indonesia formal, MAKSIMAL 150 kata.",
      "- Struktur jawaban: 1 paragraf singkat kemungkinan penyebab (bandingkan angka periode ini vs sebelumnya bila ada), lalu baris \"Saran tindakan:\" diikuti 3 butir pendek yang diawali \"- \".",
      "- Bila angka terlalu kecil untuk dianalisis, katakan jujur dan tetap beri saran umum yang aman.",
      "Balas dengan teks biasa (boleh mengandung baris baru), TANPA format JSON.",
      "",
      "ANGKA:",
      statLines.join("\n"),
    ].join("\n");

    const reply = await withAiGate("anomaly_explain", { actor: session.name }, async () => {
      const completion = await withTimeout(
        withZaiRetry((zai) =>
          zai.chat.completions.create({
            messages: [
              { role: "assistant", content: systemPrompt },
              {
                role: "user",
                content: "Jelaskan kemungkinan penyebab angka ini dan beri 3 saran tindakan.",
              },
            ],
            thinking: { type: "disabled" },
          }),
        ),
        "Penjelasan Anomali",
        AI_TIMEOUT_MS,
      );
      const text = (completion?.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        throw new Error("Balasan LLM kosong");
      }
      return text.slice(0, 4000);
    });

    return NextResponse.json({ reply });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/anomaly-explain]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal menjelaskan anomali. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}

// Turbopack invalidation nudge (NR49-B).
