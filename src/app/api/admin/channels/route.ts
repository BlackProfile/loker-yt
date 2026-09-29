// GET /api/admin/channels — efektivitas kanal rekrutmen sejak N hari terakhir.
// Query ?days=N (default 30, dijepit 1-90). Lamaran dikelompokkan (di JS) per
// kanal = utmSource || source || "(tidak diketahui)" (trim, lowercase, maks 24
// karakter). share = porsi terhadap total; hired = sudah punya hiredAt;
// rejected = status REJECTED. Diurutkan count desc, maksimal 8 kanal.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const DAY_MS = 24 * 60 * 60 * 1000;
const UNKNOWN_CHANNEL = "(tidak diketahui)";
const MAX_CHANNEL_LENGTH = 24;
const MAX_CHANNELS = 8;

/** days dari query: default 30, dijepit 1-90 (integer). */
function parseDays(raw: string | null): number {
  if (raw === null || raw.trim() === "") return 30;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 30;
  return Math.min(90, Math.max(1, n));
}

/** Normalisasi nama kanal: trim, lowercase, maks 24 karakter; null bila kosong. */
function normalizeChannel(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const clean = raw.trim().toLowerCase().slice(0, MAX_CHANNEL_LENGTH);
  return clean.length > 0 ? clean : null;
}

type ChannelAccumulator = {
  channel: string;
  count: number;
  hired: number;
  rejected: number;
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

    const applications = await db.application.findMany({
      where: { deletedAt: null, createdAt: { gte: cutoff } },
      select: { source: true, utmSource: true, status: true, hiredAt: true },
    });

    // GroupBy kanal di JS (porsi kecil data — tanpa raw query).
    const byChannel = new Map<string, ChannelAccumulator>();
    for (const app of applications) {
      const channel =
        normalizeChannel(app.utmSource) ??
        normalizeChannel(app.source) ??
        UNKNOWN_CHANNEL;
      const acc = byChannel.get(channel) ?? {
        channel,
        count: 0,
        hired: 0,
        rejected: 0,
      };
      acc.count += 1;
      if (app.hiredAt) acc.hired += 1;
      if (app.status === "REJECTED") acc.rejected += 1;
      byChannel.set(channel, acc);
    }

    const total = applications.length;
    const channels = [...byChannel.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_CHANNELS)
      .map((acc) => ({
        channel: acc.channel,
        count: acc.count,
        share: total > 0 ? Math.round((acc.count / total) * 1000) / 10 : 0,
        hired: acc.hired,
        rejected: acc.rejected,
      }));

    return NextResponse.json({ days, channels });
  } catch (error) {
    console.error("[GET /api/admin/channels]", error);
    return NextResponse.json(
      { error: "Gagal memuat data kanal. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
