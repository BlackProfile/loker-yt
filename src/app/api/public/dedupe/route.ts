// GET /api/public/dedupe?email=&phone= — cek cepat "pernah melamar?" sebelum
// pelamar mengisi formulir (NR-32, ide Data Diri Lengkap: peringatan duplikat).
// Mencocokkan email (case-insensitive) ATAU telepon (10 digit terakhir) dengan
// lamaran mana pun (posisi bebas, lamaran terbaru menang).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rate limit per IP (pola sama dengan POST /api/applications): maks 20
// permintaan per menit — cukup untuk debounce wizard, menghambat enumerasi.
const RATE_LIMIT_MAX = 20;
const RATE_WINDOW_MS = 60 * 1000;
const rateMap = new Map<string, number[]>();

/** IP klien dari header proxy standar (fallback "unknown"). */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded
    ? (forwarded.split(",")[0] ?? "").trim()
    : (req.headers.get("x-real-ip") ?? "").trim();
  return ip || "unknown";
}

/** Hanya digit; dipakai untuk pencocokan 10 digit terakhir nomor telepon. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

export async function GET(req: NextRequest) {
  try {
    const emailRaw = (req.nextUrl.searchParams.get("email") ?? "").trim();
    const phoneRaw = (req.nextUrl.searchParams.get("phone") ?? "").trim();

    // Minimal satu identifier — tanpa itu tidak ada yang bisa dicocokkan.
    if (!emailRaw && !phoneRaw) {
      return NextResponse.json({ exists: false }, { status: 400 });
    }

    const nowMs = Date.now();
    const ipKey = `dedupe:${clientIp(req)}`;
    const hits = (rateMap.get(ipKey) ?? []).filter((ts) => nowMs - ts < RATE_WINDOW_MS);
    if (hits.length >= RATE_LIMIT_MAX) {
      return NextResponse.json({ exists: false }, { status: 429 });
    }
    hits.push(nowMs);
    rateMap.set(ipKey, hits);
    if (rateMap.size > 500) {
      for (const [key, timestamps] of rateMap) {
        if (timestamps.every((ts) => nowMs - ts >= RATE_WINDOW_MS)) rateMap.delete(key);
      }
    }

    // Normalisasi: email dibandingkan lowercase; telepon memakai 10 digit
    // terakhir (abaikan +62/0, spasi, tanda hubung). Prisma SQLite `contains`
    // bersifat case-insensitive (ASCII) sehingga email huruf besar/kecil tetap
    // cocok — kandidat hasil `contains` difilter eksak di bawah agar substring
    // (mis. "john@x.com" di "bigjohn@x.com") tidak dihitung.
    const emailLower = emailRaw.toLowerCase();
    const phoneLast10 = digitsOnly(phoneRaw).slice(-10);
    if (!emailLower && phoneLast10.length < 8) {
      // Telepon terlalu pendek untuk bermakna & email kosong -> anggap tidak ada.
      return NextResponse.json({ exists: false });
    }

    const rows = await db.application.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(emailLower ? [{ email: { contains: emailLower } }] : []),
          ...(phoneLast10 ? [{ phone: { contains: phoneLast10 } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { email: true, phone: true, position: { select: { title: true } }, createdAt: true },
    });

    // Filter eksak di sisi aplikasi (anti false-positive substring).
    const match = rows.find((row) => {
      if (emailLower && (row.email ?? "").trim().toLowerCase() === emailLower) return true;
      if (phoneLast10 && digitsOnly(row.phone ?? "").endsWith(phoneLast10)) return true;
      return false;
    });

    if (!match) {
      return NextResponse.json({ exists: false, positionTitle: null, createdAt: null });
    }
    return NextResponse.json({
      exists: true,
      positionTitle: match.position?.title ?? null,
      createdAt: match.createdAt.toISOString(),
    });
  } catch (error) {
    // Tetap 200 dengan exists:false agar wizard publik tidak menampilkan error.
    console.error("[GET /api/public/dedupe]", error);
    return NextResponse.json({ exists: false, positionTitle: null, createdAt: null });
  }
}
