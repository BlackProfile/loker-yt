// GET  /api/public/survey?token=... — info survei pengalaman kandidat (belum/diisi).
// POST /api/public/survey — kirim jawaban survei { token, score (1-5), comment? }.
// Baris CandidateSurvey dibuat di muka (score 0 = belum diisi) saat email status
// final dikirim; jawaban = update baris tersebut. Anonim bagi admin (tanpa identitas
// tambahan; keterkaitan applicationId hanya untuk rekap internal).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rate limit sederhana per IP: maks 10 permintaan / jam (pola rateMap endpoint lain).
const rateMap = new Map<string, number[]>();
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (rateMap.get(ip) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    rateMap.set(ip, hits);
    return true;
  }
  hits.push(now);
  rateMap.set(ip, hits);
  if (rateMap.size > 500) {
    for (const [key, timestamps] of rateMap) {
      if (timestamps.every((ts) => now - ts >= RATE_WINDOW_MS)) rateMap.delete(key);
    }
  }
  return false;
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anon"
  );
}

export async function GET(req: NextRequest) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json({ error: "Terlalu sering. Coba beberapa saat lagi." }, { status: 429 });
    }
    const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
    if (!token) {
      return NextResponse.json({ error: "Tautan survei tidak valid." }, { status: 400 });
    }
    const survey = await db.candidateSurvey.findUnique({
      where: { token },
      select: {
        score: true,
        application: { select: { name: true, position: { select: { title: true } } } },
      },
    });
    if (!survey) {
      return NextResponse.json({ error: "Tautan survei tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      answered: survey.score > 0,
      positionTitle: survey.application?.position?.title ?? null,
    });
  } catch (error) {
    console.error("[GET /api/public/survey]", error);
    return NextResponse.json({ error: "Gagal memuat survei. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (rateLimited(clientIp(req))) {
      return NextResponse.json({ error: "Terlalu sering. Coba beberapa saat lagi." }, { status: 429 });
    }
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const token = typeof data.token === "string" ? data.token.trim() : "";
    const score = typeof data.score === "number" ? Math.round(data.score) : 0;
    const comment =
      typeof data.comment === "string" && data.comment.trim()
        ? data.comment.trim().slice(0, 1000)
        : null;

    if (!token) {
      return NextResponse.json({ error: "Tautan survei tidak valid." }, { status: 400 });
    }
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      return NextResponse.json({ error: "Pilih nilai 1 sampai 5 dulu, ya." }, { status: 400 });
    }

    const survey = await db.candidateSurvey.findUnique({ where: { token } });
    if (!survey) {
      return NextResponse.json({ error: "Tautan survei tidak ditemukan." }, { status: 404 });
    }
    if (survey.score > 0) {
      // Idempoten: jawaban kedua diabaikan tanpa error keras.
      return NextResponse.json({ ok: true, alreadyAnswered: true });
    }

    await db.candidateSurvey.update({
      where: { token },
      data: { score, comment },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/survey]", error);
    return NextResponse.json({ error: "Gagal menyimpan jawaban. Coba lagi nanti." }, { status: 500 });
  }
}
