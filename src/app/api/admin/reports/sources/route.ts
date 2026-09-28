// GET /api/admin/reports/sources — pelacak sumber lamaran (semua role).
// Agregasi sisi server (SQLite untuk where, penghitungan di JS):
// - source: jawaban "dari mana tahu lowongan ini" (null/kosong -> "Tidak diisi")
// - utm: gabungan utmSource + utmCampaign ("source / campaign", fallback salah satunya)
// - referrer: hostname dari URL referrer (null -> "Langsung", strip "www.")
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const EMPTY_LABEL = "Tidak diisi";
const DIRECT_LABEL = "Langsung";

function bump(map: Map<string, number>, label: string): void {
  map.set(label, (map.get(label) ?? 0) + 1);
}

/** Ambil hostname dari referrer; null -> langsung; tidak valid -> potongan teks aman. */
function hostOf(referrer: string | null): string | null {
  const raw = (referrer ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    try {
      return new URL(`https://${raw}`).hostname.replace(/^www\./, "").toLowerCase() || null;
    } catch {
      return raw.slice(0, 80);
    }
  }
}

function sortedRows(map: Map<string, number>): { label: string; count: number }[] {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.application.findMany({
      select: { source: true, utmSource: true, utmCampaign: true, referrer: true },
    });

    const sources = new Map<string, number>();
    const utm = new Map<string, number>();
    const referrers = new Map<string, number>();

    for (const row of rows) {
      const source = row.source?.trim();
      bump(sources, source ? source : EMPTY_LABEL);

      const utmSource = row.utmSource?.trim() ?? "";
      const utmCampaign = row.utmCampaign?.trim() ?? "";
      bump(utm, utmSource && utmCampaign ? `${utmSource} / ${utmCampaign}` : utmSource || utmCampaign || EMPTY_LABEL);

      const host = hostOf(row.referrer);
      bump(referrers, host ?? DIRECT_LABEL);
    }

    return NextResponse.json({
      sources: sortedRows(sources),
      utm: sortedRows(utm),
      referrers: sortedRows(referrers),
    });
  } catch (error) {
    console.error("[GET /api/admin/reports/sources]", error);
    return NextResponse.json(
      { error: "Gagal memuat laporan sumber lamaran. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
