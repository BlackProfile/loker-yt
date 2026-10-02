// POST /api/telegram/miniapp — validasi initData Telegram Mini App (?mini=1)
// dan kembalikan ringkasan statistik rekrutmen untuk panel versi ringkas.
//
// Spesifikasi validasi (Telegram WebApp):
//   secretKey    = HMAC_SHA256(key="WebAppData", message=botToken)
//   computedHash = HMAC_SHA256(key=secretKey, message=dataCheckString)
//   dataCheckString = semua field initData KECUALI `hash`, urut alfabetis,
//                     format `key=value`, digabung dengan "\n".
// Catatan: field `signature` (Mini App terbaru) TETAP ikut dalam dataCheckString.
// Token bot TIDAK PERNAH ditulis ke log.
import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getAutomationSettings } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Zona Asia/Bangkok = UTC+7 (tanpa DST — offset tetap sepanjang tahun).
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

type MiniAppUser = {
  id: number;
  first_name: string;
  username: string | null;
};

type MiniAppStats = {
  newToday: number;
  unreviewed: number;
  interviewsToday: number;
  pendingOffers: number;
  activePositions: number;
  acceptedTotal: number;
};

/** Batas hari ini (mulai & mulai besok) menurut zona waktu Asia/Bangkok, dalam UTC nyata. */
function bangkokDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const shifted = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const midnightBangkokAsUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );
  const start = new Date(midnightBangkokAsUtc - BANGKOK_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/**
 * Verifikasi signature HMAC initData Telegram.
 * Return: { user } bila valid (user bisa null bila payload user tidak ada),
 * atau null bila initData tidak valid / token kosong.
 */
function verifyTelegramInitData(
  initData: string,
  botToken: string,
): { user: MiniAppUser | null } | null {
  if (!botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const receivedHash = params.get("hash");
  if (!receivedHash) return null;

  // data-check-string: semua field kecuali `hash`, urut alfabetis, digabung "\n".
  const pairs: string[] = [];
  params.forEach((value, key) => {
    if (key !== "hash") pairs.push(`${key}=${value}`);
  });
  if (pairs.length === 0) return null;
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  try {
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computedHex = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    const a = Buffer.from(computedHex, "hex");
    const b = Buffer.from(receivedHash, "hex");
    if (a.length === 0 || a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  // Signature valid — parse payload user (opsional, tidak dipakai untuk query apa pun).
  const userRaw = params.get("user");
  if (!userRaw) return { user: null };
  try {
    const parsed: unknown = JSON.parse(userRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { user: null };
    }
    const obj = parsed as Record<string, unknown>;
    const user: MiniAppUser = {
      id: typeof obj.id === "number" ? obj.id : 0,
      first_name: typeof obj.first_name === "string" ? obj.first_name : "",
      username: typeof obj.username === "string" ? obj.username : null,
    };
    return { user };
  } catch {
    return { user: null };
  }
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const initData =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { initData?: unknown }).initData
        : undefined;
    if (typeof initData !== "string" || initData.length === 0) {
      return NextResponse.json({ ok: false, error: "initData tidak ada." }, { status: 400 });
    }

    const settings = await getAutomationSettings();
    const verified = verifyTelegramInitData(initData, settings.telegramBotToken);
    if (!verified) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const { start, end } = bangkokDayBounds();
    const [
      newToday,
      unreviewed,
      interviewsToday,
      pendingOffers,
      activePositions,
      acceptedTotal,
    ] = await Promise.all([
      // Lamaran baru hari ini (Asia/Bangkok), tidak di soft-delete.
      db.application.count({ where: { deletedAt: null, createdAt: { gte: start } } }),
      // Belum ditinjau (status NEW).
      db.application.count({ where: { deletedAt: null, status: "NEW" } }),
      // Wawancara hari ini yang masih aktif (SCHEDULED / CONFIRMED).
      db.interview.count({
        where: {
          status: { in: ["SCHEDULED", "CONFIRMED"] },
          scheduledAt: { gte: start, lt: end },
        },
      }),
      // Offer menunggu jawaban pelamar.
      db.application.count({ where: { deletedAt: null, offerStatus: "PENDING" } }),
      // Lowongan aktif.
      db.position.count({ where: { isActive: true, deletedAt: null } }),
      // Total pelamar diterima.
      db.application.count({ where: { deletedAt: null, status: "ACCEPTED" } }),
    ]);

    const stats: MiniAppStats = {
      newToday,
      unreviewed,
      interviewsToday,
      pendingOffers,
      activePositions,
      acceptedTotal,
    };
    return NextResponse.json({ ok: true, user: verified.user, stats });
  } catch (error) {
    console.error(
      "[POST /api/telegram/miniapp]",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
