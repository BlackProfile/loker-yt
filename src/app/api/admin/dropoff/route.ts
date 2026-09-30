// GET /api/admin/dropoff — drop-off formulir lamaran per langkah wizard.
// Query ?days=N (default 30, dijepit 1-90). Agregasi FormStepStat sejak N hari:
// per langkah dihitung jumlah event "enter", "advance", dan "submit" — dihitung
// di JS (groupBy) karena SQLite tidak mendukung agregasi kondisional yang rapi.
// dropPercent = 100 - advanced/entered*100 (langkah terakhir memakai submitted).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const DAY_MS = 24 * 60 * 60 * 1000;

/** days dari query: default 30, dijepit 1-90 (integer). */
function parseDays(raw: string | null): number {
  if (raw === null || raw.trim() === "") return 30;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return Math.min(90, Math.max(1, n));
}

type StepAccumulator = {
  step: number;
  entered: number;
  advanced: number;
  submitted: number;
};

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const days = parseDays(searchParams.get("days"));
    const cutoff = new Date(Date.now() - days * DAY_MS);

    const stats = await db.formStepStat.findMany({
      where: { createdAt: { gte: cutoff } },
      select: { step: true, event: true },
    });

    // groupBy step di JS (SQLite tidak perlu raw query).
    const byStep = new Map<number, StepAccumulator>();
    for (const row of stats) {
      const acc = byStep.get(row.step) ?? {
        step: row.step,
        entered: 0,
        advanced: 0,
        submitted: 0,
      };
      if (row.event === "enter") acc.entered += 1;
      else if (row.event === "advance") acc.advanced += 1;
      else if (row.event === "submit") acc.submitted += 1;
      byStep.set(row.step, acc);
    }

    // Langkah terakhir = langkah bernomor terbesar yang punya data.
    const lastStep = stats.reduce((max, row) => Math.max(max, row.step), 0);

    const steps = [...byStep.values()]
      .sort((a, b) => a.step - b.step)
      .map((acc) => {
        const completed = acc.step === lastStep ? acc.submitted : acc.advanced;
        const dropPercent =
          acc.entered > 0
            ? Math.max(0, Math.min(100, 100 - (completed / acc.entered) * 100))
            : 0;
        return {
          step: acc.step,
          entered: acc.entered,
          advanced: acc.advanced,
          submitted: acc.submitted,
          dropPercent: Math.round(dropPercent * 10) / 10,
        };
      });

    return NextResponse.json({ days, steps });
  } catch (error) {
    console.error("[GET /api/admin/dropoff]", error);
    return NextResponse.json(
      { error: "Gagal memuat data drop-off. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
