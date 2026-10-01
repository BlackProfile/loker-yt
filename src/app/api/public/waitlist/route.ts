// POST /api/public/waitlist — daftar tunggu "Ingatkan saya bila dibuka lagi".
// Dipanggil dari halaman detail posisi saat posisi tidak bisa dilamar
// (lewat deadline / formulir ditutup / kuota penuh). Body: { slug, email }.
// Email+positionId unik (@@unique) — pendaftaran ganda tetap dibalas sukses.
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rate limit in-memory per IP: maks 5 permintaan per jam (pola rateMap di /api/public/slots).
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateMap = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(key);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    rateMap.set(key, { count: 1, windowStart: now });
    // Bersihkan entri kedaluwarsa agar map tidak tumbuh tanpa batas.
    if (rateMap.size > 500) {
      for (const [k, v] of rateMap) {
        if (now - v.windowStart >= RATE_WINDOW_MS) rateMap.delete(k);
      }
    }
    return false;
  }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count += 1;
  return false;
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return (forwarded.split(",")[0] ?? "").trim();
  return (req.headers.get("x-real-ip") ?? "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const slug = typeof data.slug === "string" ? data.slug.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";

    if (!slug) {
      return NextResponse.json({ error: "Posisi tidak valid." }, { status: 400 });
    }
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json(
        { error: "Format email tidak valid. Periksa kembali alamat emailmu." },
        { status: 400 },
      );
    }

    const ipKey = clientIp(req) || "unknown";
    if (isRateLimited(ipKey)) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi dalam satu jam ke depan." },
        { status: 429 },
      );
    }

    const normalized = email.toLowerCase();

    // Posisi harus ada (posisi di tong sampah dianggap tidak ada).
    const position = await db.position.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true, title: true },
    });
    if (!position) {
      return NextResponse.json(
        { error: "Posisi tidak ditemukan." },
        { status: 404 },
      );
    }

    // Sudah terdaftar? (email + positionId unik) — tetap sukses, pesan berbeda.
    const existing = await db.positionWaitlist.findUnique({
      where: {
        email_positionId: { email: normalized, positionId: position.id },
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({
        ok: true,
        alreadyRegistered: true,
        message:
          "Kamu sudah terdaftar. Kami akan mengirim email begitu posisi ini dibuka lagi.",
      });
    }

    try {
      await db.positionWaitlist.create({
        data: { email: normalized, positionId: position.id },
      });
    } catch (error) {
      // Kalau tabrakan unik (pendaftaran ganda bersamaan), tetap anggap sukses.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({
          ok: true,
          alreadyRegistered: true,
          message:
            "Kamu sudah terdaftar. Kami akan mengirim email begitu posisi ini dibuka lagi.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      alreadyRegistered: false,
      message: "Siap. Kami email kamu begitu posisi ini dibuka lagi.",
    });
  } catch (error) {
    console.error("[POST /api/public/waitlist]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan daftar tunggu. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
