// GET /api/admin/reports/funnel?positionId=... — funnel konversi per posisi (semua role).
// Tanpa positionId = semua posisi. Menghitung lamaran yang PERNAH mencapai tiap tahap:
// gabungan status saat ini + riwayat ActivityLog action STATUS_CHANGE
// (detail "X → Y" diparse untuk tahap kustom; untuk tahap bawaan cukup status akhir + log).
// Funnel: [Lamaran Masuk, Ditinjau, Wawancara, Tes/Assignment (bila relevan), Diterima, Ditolak].
// Rata-rata hari per tahap dihitung dari timestamp log STATUS_CHANGE tiap lamaran.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { categoryForStage, isBuiltInStage } from "@/lib/stages";
import { parseRequirements, parseStageCategories } from "@/lib/seed";
import type { StageCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Posisi tidak ditemukan." };
const DAY_MS = 24 * 60 * 60 * 1000;
const ARROW = "→";

type FunnelKey = "MASUK" | "DITINJAU" | "WAWANCARA" | "TES" | "DITERIMA" | "DITOLAK";

const FUNNEL_LABELS: Record<FunnelKey, string> = {
  MASUK: "Lamaran Masuk",
  DITINJAU: "Ditinjau",
  WAWANCARA: "Wawancara",
  TES: "Tes/Assignment",
  DITERIMA: "Diterima",
  DITOLAK: "Ditolak",
};

const FUNNEL_ORDER: FunnelKey[] = ["MASUK", "DITINJAU", "WAWANCARA", "TES", "DITERIMA", "DITOLAK"];

// Tahap kustom yang namanya mengandung salah satu kata kunci ini dianggap tahap tes/assignment.
const ASSIGNMENT_KEYWORDS = ["tes", "test", "tugas", "assignment", "ujian"];

function isAssignmentStageName(name: string): boolean {
  const lower = name.toLowerCase();
  return ASSIGNMENT_KEYWORDS.some((k) => lower.includes(k));
}

/** Petakan nama tahap (bawaan/kustom) -> kategori pipeline + penanda tahap tes. */
function resolveStage(
  name: string,
  cats: Record<string, StageCategory>
): { category: StageCategory | null; tes: boolean } {
  if (isBuiltInStage(name)) {
    if (name === "REVIEWED") return { category: "REVIEW", tes: false };
    if (name === "INTERVIEW") return { category: "INTERVIEW", tes: false };
    if (name === "ACCEPTED") return { category: "ACCEPTED", tes: false };
    if (name === "REJECTED") return { category: "REJECTED", tes: false };
    return { category: null, tes: false }; // NEW — hanya "masuk"
  }
  return { category: categoryForStage(name, cats), tes: isAssignmentStageName(name) };
}

/** Kunci funnel yang otomatis tercapai bila sebuah kategori pipeline tercapai. */
function keysForCategory(cat: StageCategory): FunnelKey[] {
  if (cat === "REVIEW") return ["DITINJAU"];
  if (cat === "INTERVIEW") return ["DITINJAU", "WAWANCARA"];
  if (cat === "ACCEPTED") return ["DITINJAU", "WAWANCARA", "DITERIMA"];
  return ["DITOLAK"];
}

/** Semua kunci funnel yang tercapai dari satu nama tahap (bawaan/kustom). */
function keysOfStage(name: string, cats: Record<string, StageCategory>): FunnelKey[] {
  const resolved = resolveStage(name, cats);
  const keys = resolved.category ? keysForCategory(resolved.category) : [];
  return resolved.tes ? [...keys, "TES"] : keys;
}

/** Kunci paling "dalam" (paling akhir di pipeline) dari sekumpulan kunci funnel. */
function deepestKey(keys: Set<FunnelKey>): FunnelKey | null {
  let best: FunnelKey | null = null;
  for (const key of keys) {
    if (best === null || FUNNEL_ORDER.indexOf(key) > FUNNEL_ORDER.indexOf(best)) best = key;
  }
  return best;
}

/** Parse detail log STATUS_CHANGE: target tahap setelah "→" + sinyal tanpa panah. */
function parseLogDetail(detail: string | null): {
  target: string | null;
  rejected: boolean;
  hired: boolean;
  interviewMention: boolean;
} {
  const trimmed = (detail ?? "").trim();
  const arrowIdx = trimmed.lastIndexOf(ARROW);
  const rawTarget = arrowIdx >= 0 ? trimmed.slice(arrowIdx + ARROW.length).trim() : "";
  return {
    target: rawTarget.length > 0 ? rawTarget : null,
    rejected: /^ditolak/i.test(trimmed),
    hired: /diterima \(hired\)/i.test(trimmed),
    // Penyebutan "wawancara" pada log tanpa panah (mis. "Ditolak dari hasil wawancara
    // ronde 1") adalah bukti kandidat pernah sampai tahap wawancara — kecuali kasus
    // "tidak hadir wawancara" yang justru berarti wawancara tidak pernah terlaksana.
    interviewMention: /wawancara/i.test(trimmed) && !/tidak hadir/i.test(trimmed),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const positionId = searchParams.get("positionId")?.trim() ?? "";

    // Konteks posisi terpilih (bila ada): tahap kustom, kategori, dan konfigurasi assignment.
    let positionRaw: {
      stages: string;
      stageCategories: string;
      assignmentTitle: string | null;
    } | null = null;
    if (positionId) {
      positionRaw = await db.position.findUnique({
        where: { id: positionId },
        select: { stages: true, stageCategories: true, assignmentTitle: true },
      });
      if (!positionRaw) {
        return NextResponse.json(NOT_FOUND, { status: 404 });
      }
    }

    const apps = await db.application.findMany({
      where: positionId ? { positionId } : undefined,
      select: {
        id: true,
        status: true,
        createdAt: true,
        hiredAt: true,
        position: { select: { stages: true, stageCategories: true } },
      },
    });

    const ids = apps.map((a) => a.id);
    const logs =
      ids.length > 0
        ? await db.activityLog.findMany({
            where: { action: "STATUS_CHANGE", applicationId: { in: ids } },
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

    const counts: Record<FunnelKey, number> = {
      MASUK: 0,
      DITINJAU: 0,
      WAWANCARA: 0,
      TES: 0,
      DITERIMA: 0,
      DITOLAK: 0,
    };
    const dayAgg = new Map<string, { from: FunnelKey; to: FunnelKey; totalMs: number; n: number }>();
    const posCats = parseStageCategories(positionRaw?.stageCategories ?? "{}");
    const posStages = parseRequirements(positionRaw?.stages ?? "[]");

    for (const app of apps) {
      counts.MASUK += 1;
      const cats = app.position ? parseStageCategories(app.position.stageCategories) : posCats;
      const reached = new Set<FunnelKey>(["MASUK"]);

      // Status saat ini (fallback "NEW" bila kosong).
      for (const key of keysOfStage(app.status || "NEW", cats)) reached.add(key);
      if (app.hiredAt) reached.add("DITERIMA");

      // Riwayat STATUS_CHANGE: tahap yang pernah dicapai + rantai transisi berwaktu.
      let prevKey: FunnelKey = "MASUK";
      let prevAt = app.createdAt.getTime();
      const seenPair = new Set<string>(); // satu pasangan transisi cukup sekali per lamaran
      for (const log of logsByApp.get(app.id) ?? []) {
        const parsed = parseLogDetail(log.detail);
        const keys = new Set<FunnelKey>();
        if (parsed.target) {
          for (const key of keysOfStage(parsed.target, cats)) keys.add(key);
        }
        if (parsed.rejected) keys.add("DITOLAK");
        if (parsed.hired) keys.add("DITERIMA");
        // Detail tanpa panah yang menyebut wawancara (mis. "Ditolak dari hasil wawancara ronde 1")
        // tetap menjadi bukti kandidat pernah sampai tahap wawancara.
        if (!parsed.target && parsed.interviewMention) {
          keys.add("DITINJAU");
          keys.add("WAWANCARA");
        }
        const primary = deepestKey(keys);
        if (!primary) continue;
        for (const key of keys) reached.add(key);

        const pairId = `${prevKey}->${primary}`;
        if (primary !== prevKey && !seenPair.has(pairId)) {
          seenPair.add(pairId);
          const dt = Math.max(0, log.createdAt.getTime() - prevAt);
          const agg = dayAgg.get(pairId) ?? { from: prevKey, to: primary, totalMs: 0, n: 0 };
          agg.totalMs += dt;
          agg.n += 1;
          dayAgg.set(pairId, agg);
          prevKey = primary;
          prevAt = log.createdAt.getTime();
        }
      }

      for (const key of reached) counts[key] += 1;
    }

    // Tahap Tes/Assignment hanya ditampilkan bila relevan:
    // - posisi terpilih: punya konfigurasi assignment ATAU tahap kustom bernama tes/tugas/ujian;
    // - semua posisi: ada lamaran yang benar-benar pernah mencapai tahap bertanda TES.
    const tesRelevant = positionId
      ? positionRaw?.assignmentTitle != null || posStages.some(isAssignmentStageName)
      : counts.TES > 0;

    const stageKeys: FunnelKey[] = [
      "MASUK",
      "DITINJAU",
      "WAWANCARA",
      ...(tesRelevant ? (["TES"] as FunnelKey[]) : []),
      "DITERIMA",
      "DITOLAK",
    ];

    // Tahap terminal (Diterima/Ditolak) dihitung relatif terhadap tahap proses terakhir
    // agar persentase konversinya bermakna (bukan relatif ke Diterima).
    const terminalIdx = stageKeys.indexOf("DITERIMA");
    const prosesBasis: FunnelKey = terminalIdx > 0 ? stageKeys[terminalIdx - 1] : "MASUK";

    const stages = stageKeys.map((key, idx) => {
      const basis: FunnelKey =
        idx === 0 ? key : key === "DITERIMA" || key === "DITOLAK" ? prosesBasis : stageKeys[idx - 1];
      const baseCount = counts[basis];
      const pct = idx === 0 ? 100 : baseCount > 0 ? Math.round((counts[key] / baseCount) * 100) : 0;
      return {
        key,
        label: FUNNEL_LABELS[key],
        count: counts[key],
        conversionPct_dari_sebelumnya: pct,
        basisLabel: idx === 0 ? null : FUNNEL_LABELS[basis],
      };
    });

    const avgDaysPerStage = Array.from(dayAgg.values())
      .sort(
        (a, b) =>
          FUNNEL_ORDER.indexOf(a.from) - FUNNEL_ORDER.indexOf(b.from) ||
          FUNNEL_ORDER.indexOf(a.to) - FUNNEL_ORDER.indexOf(b.to)
      )
      .map((agg) => ({
        from: FUNNEL_LABELS[agg.from],
        to: FUNNEL_LABELS[agg.to],
        days: Math.round((agg.totalMs / agg.n / DAY_MS) * 10) / 10,
      }));

    return NextResponse.json({ stages, avgDaysPerStage });
  } catch (error) {
    console.error("[GET /api/admin/reports/funnel]", error);
    return NextResponse.json(
      { error: "Gagal memuat laporan funnel. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
