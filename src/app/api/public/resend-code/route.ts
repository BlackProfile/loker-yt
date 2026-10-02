// POST /api/public/resend-code — pelamar meminta kode pelacakan dikirim ulang via
// email (NR-15, idea 8). Body: { email }.
// Aturan keamanan:
// - Throttle ketat per IP (maks 3/jam) DAN per email (maks 3/jam) — pola rateMap.
// - Respons SELALU { ok: true } generik, tanpa membocorkan keberadaan email.
// - Bila ada lamaran aktif (maks 10), email ringkasan kode dimasukkan ke
//   EmailOutbox (fire-and-forget; terkirim bila SMTP terkonfigurasi).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queueEmail } from "@/lib/notify";
import { getSiteUrl } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Rate limit: maks 3 permintaan per jam, baik per IP maupun per email.
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_MAX = 3;
const ipMap = new Map<string, number[]>();
const emailMap = new Map<string, number[]>();

function rateLimited(map: Map<string, number[]>, key: string): boolean {
  const now = Date.now();
  const hits = (map.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    map.set(key, hits);
    return true;
  }
  hits.push(now);
  map.set(key, hits);
  if (map.size > 500) {
    for (const [k, timestamps] of map) {
      if (timestamps.every((ts) => now - ts >= RATE_WINDOW_MS)) map.delete(k);
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

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    // Throttle diterapkan SEBELUM validasi bentuk agar brute-force terbatas.
    const throttled = rateLimited(ipMap, ip);

    const body: unknown = await req.json().catch(() => null);
    const rawEmail =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).email
        : undefined;
    const email =
      typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";

    const validShape = /\S+@\S+\.\S+/.test(email);
    if (!throttled && validShape && !rateLimited(emailMap, email)) {
      const rows = await db.application.findMany({
        where: { email: { equals: email }, deletedAt: null, trackingCode: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { trackingCode: true, position: { select: { title: true } } },
      });
      if (rows.length > 0) {
        const lines = rows.map(
          (row) => `• ${row.trackingCode} — ${row.position?.title ?? "Posisi umum"}`,
        );
        // Fire-and-forget: pengiriman tidak boleh memengaruhi respons generik.
        void queueEmail({
          toEmail: email,
          subject: "Kode Pelacakan Lamaran Lumina Studio",
          body: [
            "Halo,",
            "",
            "Berikut kode pelacakan lamaranmu di Lumina Studio:",
            "",
            ...lines,
            "",
            `Buka halaman status lamaran (${getSiteUrl()}/#status), masukkan emailmu, lalu gunakan salah satu kode di atas untuk melihat perkembangan terbaru.`,
            "",
            "Salam hangat,",
            "Tim Lumina Studio",
          ].join("\n"),
          kind: "SYSTEM",
        });
      }
    }

    // Respons selalu sama — tanpa informasi apakah email terdaftar.
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/resend-code]", error);
    // Tetap generik agar tidak membocorkan apa pun.
    return NextResponse.json({ ok: true });
  }
}
