// GET /api/public/slots?code=LM-XXX — daftar slot wawancara yang masih bisa dipilih
// pelamar pemilik kode tracking (belum dibooking, jadwalnya di masa depan, maks 8).
//
// NR70 (Fitur #1) — ?positionId=... — varian untuk apply wizard: kandidat yang
// belum punya trackingCode bisa melihat slot terbuka posisi tujuan untuk diambil
// saat pengiriman. Tanpa auth; tanpa data sensitif (hanya jadwal & platform).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  INTERVIEW_PLATFORMS,
  type InterviewMode,
  type InterviewPlatform,
  type TrackSlotInfo,
} from "@/lib/types";

export const dynamic = "force-dynamic";

// Rate limit sederhana per kunci: 1 permintaan / detik (mirip endpoint track).
const rateMap = new Map<string, number>();
const RATE_MS = 1000;
const MAX_SLOTS = 8;

export async function GET(req: NextRequest) {
  try {
    const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
    const positionId = (req.nextUrl.searchParams.get("positionId") ?? "").trim();
    if (!code && !positionId) {
      return NextResponse.json({ error: "Kode pelacakan atau posisi wajib diisi." }, { status: 400 });
    }

    // Kunci rate-limit = code bila ada, kalau tidak positionId (varian apply wizard).
    const rateKey = code || `pos:${positionId}`;
    const now = Date.now();
    const last = rateMap.get(rateKey) ?? 0;
    if (now - last < RATE_MS) {
      return NextResponse.json({ error: "Terlalu sering. Coba beberapa detik lagi." }, { status: 429 });
    }
    rateMap.set(rateKey, now);
    if (rateMap.size > 500) {
      for (const [key, ts] of rateMap) {
        if (now - ts > 60_000) rateMap.delete(key);
      }
    }

    // Jalur 1 — trackingCode (status page lama): ambil slot untuk posisi lamaran.
    let targetPositionId: string | null = null;
    if (code) {
      const application = await db.application.findUnique({
        where: { trackingCode: code },
        select: { id: true, status: true, positionId: true },
      });
      if (!application) {
        return NextResponse.json({ error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
      }

      const status = (application.status || "NEW").trim();
      const isTerminal = status === "ACCEPTED" || status === "REJECTED";
      if (isTerminal || !application.positionId) {
        return NextResponse.json({ ok: true, slots: [] });
      }
      targetPositionId = application.positionId;
    } else {
      // Jalur 2 — positionId (apply wizard): cukup validasi posisi ada.
      const position = await db.position.findUnique({
        where: { id: positionId },
        select: { id: true },
      });
      if (!position) {
        return NextResponse.json({ error: "Posisi tidak ditemukan." }, { status: 404 });
      }
      targetPositionId = position.id;
    }

    const rows = await db.interviewSlot.findMany({
      where: {
        positionId: targetPositionId,
        bookedByApplicationId: null,
        scheduledAt: { gt: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
      take: MAX_SLOTS,
    });

    const slots: TrackSlotInfo[] = rows.map((s) => ({
      id: s.id,
      scheduledAt: s.scheduledAt.toISOString(),
      durationMin: s.durationMin,
      mode: (s.mode === "ONSITE" ? "ONSITE" : "ONLINE") as InterviewMode,
      platform: ((INTERVIEW_PLATFORMS as string[]).includes(s.platform)
        ? s.platform
        : "GOOGLE_MEET") as InterviewPlatform,
      meetingLink: s.meetingLink,
      address: s.address,
      interviewers: (() => {
        try {
          const parsed: unknown = JSON.parse(s.interviewers || "[]");
          return Array.isArray(parsed)
            ? parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
            : [];
        } catch {
          return [];
        }
      })(),
    }));

    return NextResponse.json({ ok: true, slots });
  } catch (error) {
    console.error("[GET /api/public/slots]", error);
    return NextResponse.json({ error: "Gagal memuat slot wawancara." }, { status: 500 });
  }
}
