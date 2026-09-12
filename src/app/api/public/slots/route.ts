// GET /api/public/slots?code=LM-XXX — daftar slot wawancara yang masih bisa dipilih
// pelamar pemilik kode tracking (belum dibooking, jadwalnya di masa depan, maks 8).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  INTERVIEW_PLATFORMS,
  type InterviewMode,
  type InterviewPlatform,
  type TrackSlotInfo,
} from "@/lib/types";

export const dynamic = "force-dynamic";

// Rate limit sederhana per kode: 1 permintaan / detik (mirip endpoint track).
const rateMap = new Map<string, number>();
const RATE_MS = 1000;
const MAX_SLOTS = 8;

export async function GET(req: NextRequest) {
  try {
    const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }

    const now = Date.now();
    const last = rateMap.get(code) ?? 0;
    if (now - last < RATE_MS) {
      return NextResponse.json({ error: "Terlalu sering. Coba beberapa detik lagi." }, { status: 429 });
    }
    rateMap.set(code, now);
    if (rateMap.size > 500) {
      for (const [key, ts] of rateMap) {
        if (now - ts > 60_000) rateMap.delete(key);
      }
    }

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

    const rows = await db.interviewSlot.findMany({
      where: {
        positionId: application.positionId,
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
