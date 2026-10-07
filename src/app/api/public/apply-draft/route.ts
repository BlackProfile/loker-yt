// POST /api/public/apply-draft — simpan draft lamaran wizard & kirim tautan
// "lanjutkan" ke email pelamar (token sekali pakai, berlaku 7 hari).
// GET  /api/public/apply-draft?token=... — ambil isi draft via tautan email;
// baris dihapus setelah dibaca (sekali pakai).
import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { queueEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DRAFT_MAX_BYTES = 100 * 1024; // 100 KB
const EXPIRES_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 jam
const POST_RATE_MAX = 3; // maks 3 kirim tautan per jam per IP
const GET_RATE_MAX = 10; // maks 10 buka tautan per jam per IP

// Rate limit in-memory per IP (ter-reset saat proses server restart).
const rateBuckets = new Map<string, number[]>();

/** IP klien dari header proxy standar, fallback "unknown". */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Sliding-window rate limit per scope+IP. true = melebihi kuota. */
function isRateLimited(scope: string, ip: string, max: number): boolean {
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const hits = (rateBuckets.get(key) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);
  if (hits.length >= max) {
    rateBuckets.set(key, hits);
    return true;
  }
  hits.push(now);
  rateBuckets.set(key, hits);
  // Hemat memori: buang satu kunci terlama bila peta membengkak.
  if (rateBuckets.size > 10_000) {
    const oldest = rateBuckets.keys().next();
    if (!oldest.done) rateBuckets.delete(oldest.value);
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    if (isRateLimited("post", clientIp(req), POST_RATE_MAX)) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi dalam satu jam." },
        { status: 429 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Permintaan tidak valid." }, { status: 400 });
    }
    const payload = body as Record<string, unknown>;
    const positionId =
      typeof payload.positionId === "string" ? payload.positionId.trim() : "";
    const email = typeof payload.email === "string" ? payload.email.trim() : "";
    const data = typeof payload.data === "string" ? payload.data : null;
    // NR-41 J26 — bila wizard sudah punya token draft di localStorage, perbarui
    // baris yang sama (token tetap) alih-alih membuat baris baru tiap autosave.
    const existingToken =
      typeof payload.token === "string" ? payload.token.trim() : "";
    // NR-41 J26 — bila wizard sudah punya token draft di localStorage, perbarui
    // baris yang sama (token tetap) alih-alih membuat baris baru tiap autosave.
    const existingToken =
      typeof payload.token === "string" ? payload.token.trim() : "";
    // NR-41 J26 — bila wizard sudah punya token draft di localStorage, perbarui
    // baris yang sama (token tetap) alih-alih membuat baris baru tiap autosave.
    const existingToken =
      typeof payload.token === "string" ? payload.token.trim() : "";

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    if (!data) {
      return NextResponse.json({ error: "Data draft tidak valid." }, { status: 400 });
    }
    if (Buffer.byteLength(data, "utf8") > DRAFT_MAX_BYTES) {
      return NextResponse.json(
        { error: "Data draft terlalu besar (maksimal 100 KB)." },
        { status: 400 },
      );
    }
    let parsedDraft: unknown;
    try {
      parsedDraft = JSON.parse(data);
    } catch {
      return NextResponse.json({ error: "Data draft tidak valid." }, { status: 400 });
    }
    if (!parsedDraft || typeof parsedDraft !== "object" || Array.isArray(parsedDraft)) {
      return NextResponse.json({ error: "Data draft tidak valid." }, { status: 400 });
    }
    if (!positionId) {
      return NextResponse.json({ error: "Posisi tidak valid." }, { status: 400 });
    }
    const position = await db.position.findUnique({ where: { id: positionId } });
    if (
      !position ||
      position.deletedAt !== null ||
      !position.isActive ||
      !position.applyOpen
    ) {
      return NextResponse.json(
        { error: "Posisi tidak ditemukan atau sudah ditutup." },
        { status: 400 },
      );
    }

    // Token 32 karakter hex acak; berlaku 7 hari. NR-41 J26 — upsert: bila wizard
    // mengirim token lama yang masih berlaku untuk email+posisi sama, pakai baris itu.
    const expiresAt = new Date(Date.now() + EXPIRES_MS);
    let token = randomBytes(16).toString("hex");
    let reused = false;
    if (/^[a-f0-9]{32}$/.test(existingToken)) {
      const existing = await db.applicationDraft.findUnique({ where: { token: existingToken } });
      if (
        existing &&
        existing.expiresAt.getTime() > Date.now() &&
        existing.email === email.toLowerCase() &&
        existing.positionId === positionId
      ) {
        await db.applicationDraft.update({
          where: { id: existing.id },
          data: { data: data as string, expiresAt },
        });
        token = existing.token;
        reused = true;
      }
    }
    if (!reused) {
      await db.applicationDraft.create({
        data: {
          token,
          positionId: position.id,
          email: email.toLowerCase(),
          data,
          expiresAt,
        },
      });
    }

    const origin =
      req.headers.get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const posisiParam = position.slug
      ? `posisi=${encodeURIComponent(position.slug)}&`
      : "";
    const link = `${origin}/?${posisiParam}draft=${token}`;
    const expiresLabel = new Intl.DateTimeFormat("id-ID", {
      dateStyle: "full",
      timeStyle: "short",
    }).format(expiresAt);

    await queueEmail({
      toEmail: email,
      subject: `Lanjutkan lamaran Anda — ${position.title}`,
      kind: "REMINDER",
      body: [
        "Halo,",
        "",
        `Draf lamaran Anda untuk posisi ${position.title} sudah tersimpan. Lanjutkan pengisian dari perangkat mana pun melalui tautan berikut:`,
        "",
        link,
        "",
        `Tautan berlaku sampai ${expiresLabel} dan hanya dapat dipakai satu kali.`,
        "",
        "Catatan: berkas yang sudah diunggah (CV, video/audio intro, dokumen tambahan) tidak ikut tersimpan dalam draf dan perlu diunggah ulang saat melanjutkan.",
        "",
        "Tim Lumina Studio",
      ].join("\n"),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/apply-draft]", error);
    return NextResponse.json(
      { error: "Gagal mengirim tautan draft. Coba lagi nanti." },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    if (isRateLimited("get", clientIp(req), GET_RATE_MAX)) {
      return NextResponse.json(
        { error: "Terlalu banyak permintaan. Coba lagi dalam satu jam." },
        { status: 429 },
      );
    }

    const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
    if (!token) {
      return NextResponse.json(
        { error: "Tautan draft tidak valid." },
        { status: 400 },
      );
    }

    const draft = await db.applicationDraft.findUnique({
      where: { token },
      include: { position: true },
    });
    if (!draft) {
      return NextResponse.json(
        { error: "Tautan draft tidak valid atau sudah dipakai." },
        { status: 404 },
      );
    }

    // Kedaluwarsa: hapus barisnya lalu anggap tautan tidak valid.
    if (draft.expiresAt.getTime() <= Date.now()) {
      try {
        await db.applicationDraft.delete({ where: { id: draft.id } });
      } catch {
        // penghapusan gagal — tetap tolak tautan
      }
      return NextResponse.json(
        { error: "Tautan draft tidak valid atau sudah dipakai." },
        { status: 404 },
      );
    }

    // Posisi sudah tidak aktif / formulir ditutup → tautan tidak bisa dipakai.
    const position = draft.position;
    const positionUsable = Boolean(
      draft.positionId &&
        position &&
        position.deletedAt === null &&
        position.isActive &&
        position.applyOpen,
    );
    if (!positionUsable) {
      return NextResponse.json(
        { error: "Tautan draft tidak valid atau sudah dipakai." },
        { status: 404 },
      );
    }

    let parsedData: unknown = null;
    try {
      parsedData = JSON.parse(draft.data);
    } catch {
      parsedData = null;
    }

    // Sekali pakai: hapus baris sebelum merespons.
    try {
      await db.applicationDraft.delete({ where: { id: draft.id } });
    } catch {
      // penghapusan gagal — draft tetap diberikan agar pelamar tidak kehilangan isian
    }

    return NextResponse.json({
      ok: true,
      positionId: draft.positionId,
      data: parsedData,
    });
  } catch (error) {
    console.error("[GET /api/public/apply-draft]", error);
    return NextResponse.json(
      { error: "Gagal memuat draft. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
