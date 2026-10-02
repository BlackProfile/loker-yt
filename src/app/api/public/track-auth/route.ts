// POST /api/public/track-auth — login pelamar di halaman Cek Status.
// Body: { email, code } — pasangan email + kode pelacakan harus cocok dengan
// lamaran (kode bertindak sebagai kata sandi). Sukses mengembalikan daftar
// SEMUA lamaran aktif milik email tersebut (mendukung multi-lamaran sekali login).
// Keamanan: throttle per IP + lockout 5x gagal / 15 menit (src/lib/status-gate).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clearAuthFails,
  clientIp,
  isLockedOut,
  isThrottled,
  lockRemainingSec,
  recordAuthFail,
} from "@/lib/status-gate";
import type { TrackAuthResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);

    if (isLockedOut(ip)) {
      const body: TrackAuthResponse = {
        ok: false,
        lockedForSec: lockRemainingSec(ip),
      };
      return NextResponse.json(body, { status: 429 });
    }
    if (isThrottled(`auth:${ip}`, 400)) {
      return NextResponse.json(
        { ok: false, error: "Terlalu cepat." } satisfies TrackAuthResponse,
        { status: 429 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    const rawEmail =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).email
        : undefined;
    const rawCode =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).code
        : undefined;

    if (typeof rawEmail !== "string" || !/\S+@\S+\.\S+/.test(rawEmail.trim())) {
      return NextResponse.json(
        { ok: false, error: "Email wajib diisi dengan format yang benar." } satisfies TrackAuthResponse,
        { status: 400 },
      );
    }
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json(
        { ok: false, error: "Kode pelacakan wajib diisi." } satisfies TrackAuthResponse,
        { status: 400 },
      );
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: { email: true, deletedAt: true },
    });

    // Respons gagal selalu identik (tidak membocorkan mana yang salah / ada tidaknya kode).
    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== email) {
      recordAuthFail(ip);
      const failBody: TrackAuthResponse = { ok: false };
      return NextResponse.json(failBody, { status: 401 });
    }
    clearAuthFails(ip);

    // Multi-lamaran: semua lamaran aktif (bukan tong sampah) milik email ini.
    const rows = await db.application.findMany({
      where: { email: { equals: application.email }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        trackingCode: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        position: { select: { title: true, slug: true } },
      },
    });

    const responseBody: TrackAuthResponse = {
      ok: true,
      applications: rows.map((row) => ({
        trackingCode: row.trackingCode ?? "",
        positionTitle: row.position?.title ?? null,
        positionSlug: row.position?.slug ?? null,
        status: row.status.trim() || "NEW",
        submittedAt: row.createdAt.toISOString(),
        statusUpdatedAt: row.updatedAt.toISOString(),
      })),
    };
    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("[POST /api/public/track-auth]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal masuk. Coba lagi nanti." } satisfies TrackAuthResponse,
      { status: 500 },
    );
  }
}
