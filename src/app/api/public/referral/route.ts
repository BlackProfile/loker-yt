// NR70 (Fitur #3) — Program kode referral ringan untuk publik.
// POST { name?, email } -> upsert kode unik per email (idempoten) -> { code, referrerName }.
// GET  ?code=REF-XXXXXX -> validasi keberadaan -> { valid, referrerName? }.
//
// Tidak ada auth; tidak ada data sensitif lain (hanya kode + nama perujuk).
// Format kode: "REF-" + 6 alphanumeric upper (36^6 ruang = cukup untuk MVP).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_PREFIX = "REF-";
const CODE_LEN = 6;
// Karakter tanpa ambigitas: 0-9 + A-Z tanpa I, O (mirip angka 1/0).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".split("");
const NAME_MAX = 80;
const EMAIL_MAX = 160;

// Rate limit sederhana per IP/email: 5 permintaan / menit.
const rateMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 5;
const RATE_WINDOW_MS = 60 * 1000;

function rateKey(ip: string, email: string) {
  return `ref:${email || ip}`;
}

function hitRateLimit(key: string): boolean {
  const now = Date.now();
  const hits = (rateMap.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    rateMap.set(key, hits);
    return true;
  }
  hits.push(now);
  rateMap.set(key, hits);
  if (rateMap.size > 500) {
    for (const [k, tsArr] of rateMap) {
      if (tsArr.every((ts) => now - ts >= RATE_WINDOW_MS)) rateMap.delete(k);
    }
  }
  return false;
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded
    ? (forwarded.split(",")[0] ?? "").trim()
    : (req.headers.get("x-real-ip") ?? "").trim();
  return ip || "unknown";
}

/** Bangun kode unik baru (cek DB bila perlu — retry sampai kosong). */
async function generateUniqueCode(): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt++) {
    let out = "";
    for (let i = 0; i < CODE_LEN; i++) {
      out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    const candidate = `${CODE_PREFIX}${out}`;
    const exists = await db.referralCode.findUnique({
      where: { code: candidate },
      select: { id: true },
    });
    if (!exists) return candidate;
  }
  // Sangat kecil kemungkinan; fallback random final (DB unique akan tolak duplikat).
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return `${CODE_PREFIX}${out}`;
}

export async function GET(req: NextRequest) {
  try {
    const code = (req.nextUrl.searchParams.get("code") ?? "").trim().toUpperCase();
    if (!code) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }
    // Bentuk kode minimal: "REF-" + minimal 4 karakter alfanumerik.
    if (!/^REF-[A-Z0-9]{4,12}$/.test(code)) {
      return NextResponse.json({ valid: false });
    }
    const row = await db.referralCode.findUnique({
      where: { code },
      select: { id: true, referrerName: true },
    });
    if (!row) {
      return NextResponse.json({ valid: false });
    }
    return NextResponse.json({
      valid: true,
      referrerName: row.referrerName ?? null,
    });
  } catch (error) {
    console.error("[GET /api/public/referral]", error);
    // Publik: jangan bocorkan error detail. Anggap kode tidak valid.
    return NextResponse.json({ valid: false }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const email =
      typeof data.email === "string" ? data.email.trim().toLowerCase().slice(0, EMAIL_MAX) : "";
    const name =
      typeof data.name === "string" ? data.name.trim().slice(0, NAME_MAX) : "";

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Email perujuk tidak valid." }, { status: 400 });
    }

    const ip = clientIp(req);
    if (hitRateLimit(rateKey(ip, email))) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan. Coba beberapa menit lagi." },
        { status: 429 },
      );
    }

    // Idempoten: email yang sama selalu menghasilkan kode yang sama. Buat bila
    // belum ada — pemanggilan ulang tidak pernah menduplikasi.
    let row = await db.referralCode.findUnique({
      where: { referrerEmail: email },
      select: { id: true, code: true, referrerName: true },
    });
    if (!row) {
      const code = await generateUniqueCode();
      try {
        row = await db.referralCode.create({
          data: { code, referrerEmail: email, referrerName: name || null },
          select: { id: true, code: true, referrerName: true },
        });
      } catch (createError) {
        // Race condition: kode unik sengaja diambil proses paralel. Coba ambil ulang.
        const retry = await db.referralCode.findUnique({
          where: { referrerEmail: email },
          select: { id: true, code: true, referrerName: true },
        });
        if (retry) {
          row = retry;
        } else {
          console.error("[POST /api/public/referral] create gagal:", createError);
          return NextResponse.json(
            { error: "Gagal membuat kode referral. Coba lagi nanti." },
            { status: 500 },
          );
        }
      }
    } else if (name && row.referrerName !== name) {
      // Perbarui nama bila perujuk memberi nama baru (mis. kosong sebelumnya).
      try {
        const updated = await db.referralCode.update({
          where: { id: row.id },
          data: { referrerName: name },
          select: { id: true, code: true, referrerName: true },
        });
        row = updated;
      } catch {
        // non-kritis: biarkan nama lama dipakai
      }
    }

    // Pengaman statis: row harus selalu terisi di sini (initial fetch / create /
    // retry). Tetap periksa ekplisit bila seluruh cabang di atas somehow gagal.
    if (!row) {
      return NextResponse.json(
        { error: "Gagal membuat kode referral. Coba lagi nanti." },
        { status: 500 },
      );
    }

    return NextResponse.json({ code: row.code, referrerName: row.referrerName });
  } catch (error) {
    console.error("[POST /api/public/referral]", error);
    return NextResponse.json(
      { error: "Gagal membuat kode referral. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
