// NR-41 K29 — POST /api/public/email-inbound — webhook email masuk (balasan pelamar).
// Keamanan: header `x-inbound-secret` HARUS sama dengan Setting "inbound_email_secret"
// (403 bila setting kosong/tidak cocok — endpoint tidak aktif tanpa secret).
// Alur: body {from, to, subject, text} → cari lamaran TERBARU non-terhapus dengan
// email sama → buat Comment (authorRole "CANDIDATE") + notifikasi in-app.
// 404 bila tidak ada lamaran yang cocok. Rate limit in-memory per pengirim
// (maks 20 email/jam).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushNotification } from "@/lib/notify";

export const dynamic = "force-dynamic";

const BODY_MAX = 4000; // batas isi komentar dari email
const RATE_MAX = 20; // maks email per pengirim per jam
const RATE_WINDOW_MS = 60 * 60 * 1000;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Rate limit sederhana in-memory: key = email pengirim (lowercase). */
const rateMap = new Map<string, number[]>();

function isRateLimited(key: string, nowMs: number): boolean {
  const hits = (rateMap.get(key) ?? []).filter((ts) => nowMs - ts < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    rateMap.set(key, hits);
    return true;
  }
  hits.push(nowMs);
  rateMap.set(key, hits);
  // Bersihkan entri kedaluwarsa agar map tidak membengkak.
  if (rateMap.size > 500) {
    for (const [mapKey, timestamps] of rateMap) {
      if (timestamps.every((ts) => nowMs - ts >= RATE_WINDOW_MS)) rateMap.delete(mapKey);
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    // 1) Verifikasi secret dari Setting (403 bila kosong/salah).
    const provided = req.headers.get("x-inbound-secret") ?? "";
    const setting = await db.setting.findUnique({ where: { key: "inbound_email_secret" } });
    const expected = (setting?.value ?? "").trim().replace(/^"|"$/g, "");
    if (!expected || !provided || provided.trim() !== expected) {
      return NextResponse.json({ error: "Secret tidak valid." }, { status: 403 });
    }

    // 2) Parse body.
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Payload tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const from = typeof data.from === "string" ? data.from.trim().toLowerCase() : "";
    const subject = typeof data.subject === "string" ? data.subject.trim() : "";
    const text = typeof data.text === "string" ? data.text : "";
    const to = typeof data.to === "string" ? data.to.trim() : "";

    if (!EMAIL_REGEX.test(from)) {
      return NextResponse.json({ error: "Pengirim (from) tidak valid." }, { status: 400 });
    }
    if (!subject && !text) {
      return NextResponse.json({ error: "Isi email kosong." }, { status: 400 });
    }

    // 3) Rate limit per pengirim: maks 20 email/jam.
    if (isRateLimited(from, Date.now())) {
      return NextResponse.json({ error: "Terlalu banyak email dari pengirim ini." }, { status: 429 });
    }

    // 4) Cari lamaran TERBARU non-terhapus dengan email sama.
    const application = await db.application.findFirst({
      where: { email: from, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, trackingCode: true },
    });
    if (!application) {
      return NextResponse.json({ error: "Tidak ada lamaran yang cocok dengan pengirim." }, { status: 404 });
    }

    // 5) Buat komentar dari pelamar (subject + isi, dibatasi 4000 karakter).
    const commentBody = `${subject}${subject && text ? "\n\n" : ""}${text.slice(0, BODY_MAX)}`;
    await db.comment.create({
      data: {
        applicationId: application.id,
        authorName: application.name || from,
        authorRole: "CANDIDATE",
        body: commentBody || "(email tanpa isi)",
      },
    });

    // 6) Notifikasi in-app untuk admin.
    await pushNotification({
      title: "Balasan email dari pelamar",
      body: `${application.name}${application.trackingCode ? ` (${application.trackingCode})` : ""} membalas via email${to ? ` ke ${to}` : ""}. Cek komentar di lamaran.`,
      category: "APPLICATION",
      applicationId: application.id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/email-inbound]", error);
    return NextResponse.json({ error: "Gagal memproses email masuk." }, { status: 500 });
  }
}
