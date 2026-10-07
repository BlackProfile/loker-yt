// POST /api/public/subscribe — berlangganan notifikasi posisi baru (NR-41 H15: double opt-in).
// Alur:
//  - Bila Setting "newsletter_double_optin" aktif (default true) dan email BELUM
//    terkonfirmasi: buat confirmToken + unsubToken (randomBytes hex 24), TIDAK
//    menandai terkonfirmasi, kirim email berisi tautan konfirmasi
//    `${siteUrl}/api/public/subscribe/confirm?token=...` → 202 {ok,pendingConfirm}.
//  - Bila double opt-in nonaktif → langsung confirmedAt=now + unsubToken → {ok,confirmed}.
//  - Email sudah terkonfirmasi → {ok, confirmed:true} (idempotent, tanpa email ulang).
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSiteUrl, queueEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_BYTES = 24; // 48 karakter hex

/**
 * Baca Setting "newsletter_double_optin" secara aman.
 * Menerima JSON boolean/string atau teks mentah ("false"/"0" = nonaktif).
 * Tidak ada row / nilai tak dikenal → default AKTIF (true).
 */
async function isDoubleOptInEnabled(): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key: "newsletter_double_optin" } });
    if (!row) return true; // default true
    const raw = row.value.trim();
    if (!raw) return true;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "boolean") return parsed;
      if (typeof parsed === "string") return parsed.trim().toLowerCase() !== "false" && parsed.trim() !== "0";
    } catch {
      // bukan JSON — perlakukan sebagai teks mentah
    }
    return raw.toLowerCase() !== "false" && raw !== "0";
  } catch {
    return true;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const data =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const email = typeof data.email === "string" ? data.email : "";
    const source = typeof data.source === "string" ? data.source.trim().slice(0, 60) : null;

    if (!EMAIL_REGEX.test(email.trim())) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    const normalized = email.trim().toLowerCase();

    const existing = await db.subscriber.findUnique({ where: { email: normalized } });

    // Idempoten: sudah terkonfirmasi → cukup jawab confirmed (tanpa email ulang).
    if (existing?.confirmedAt) {
      return NextResponse.json({ ok: true, confirmed: true }, { status: 200 });
    }

    const doubleOptIn = await isDoubleOptInEnabled();

    if (!doubleOptIn) {
      // Double opt-in nonaktif: langsung konfirmasi + siapkan token berhenti berlangganan.
      const unsubToken = existing?.unsubToken ?? randomBytes(TOKEN_BYTES).toString("hex");
      await db.subscriber.upsert({
        where: { email: normalized },
        update: { confirmedAt: new Date(), unsubToken, source: source ?? existing?.source ?? null },
        create: { email: normalized, confirmedAt: new Date(), unsubToken, source },
      });
      return NextResponse.json({ ok: true, confirmed: true }, { status: 200 });
    }

    // Double opt-in aktif: buat token konfirmasi (pertahankan yang lama bila ada)
    // lalu kirim email berisi tautan konfirmasi. Belum dianggap terkonfirmasi.
    const confirmToken = existing?.confirmToken ?? randomBytes(TOKEN_BYTES).toString("hex");
    const unsubToken = existing?.unsubToken ?? randomBytes(TOKEN_BYTES).toString("hex");
    await db.subscriber.upsert({
      where: { email: normalized },
      update: { confirmToken, unsubToken, source: source ?? existing?.source ?? null },
      create: { email: normalized, confirmToken, unsubToken, source },
    });

    const siteUrl = getSiteUrl();
    const confirmUrl = `${siteUrl}/api/public/subscribe/confirm?token=${confirmToken}`;
    await queueEmail({
      toEmail: normalized,
      subject: "Konfirmasi langganan notifikasi lowongan",
      body:
        `Halo,\n\n` +
        `Kami menerima permintaan berlangganan notifikasi lowongan baru untuk email ini.\n\n` +
        `Konfirmasi langganan dengan membuka tautan berikut:\n${confirmUrl}\n\n` +
        `Bila kamu tidak merasa meminta langganan ini, abaikan email ini — ` +
        `tidak ada langganan yang aktif sampai tautan di atas dibuka.\n\n` +
        `Terima kasih.`,
      kind: "SYSTEM",
    });

    return NextResponse.json({ ok: true, pendingConfirm: true }, { status: 202 });
  } catch (error) {
    console.error("[POST /api/public/subscribe]", error);
    return NextResponse.json({ error: "Gagal berlangganan. Coba lagi nanti." }, { status: 500 });
  }
}
