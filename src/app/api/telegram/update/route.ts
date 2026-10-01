// POST /api/telegram/update — menerima update Telegram dari mini-service poller
// (mini-services/telegram-bot, port 3004) yang menjalankan getUpdates long-polling.
// Dilindungi header x-telegram-secret (TELEGRAM_BRIDGE_SECRET). Response berisi
// `replies` (teks yang dikirim bot) — berguna untuk debugging & pengujian tanpa token asli.
import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/telegram-bot";

export const dynamic = "force-dynamic";

const BRIDGE_SECRET = process.env.TELEGRAM_BRIDGE_SECRET ?? "lumina-telegram-secret";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-telegram-secret");
    if (!secret || secret !== BRIDGE_SECRET) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Payload tidak valid." }, { status: 400 });
    }
    const update = body as TelegramUpdate;
    if (typeof update.update_id !== "number") {
      return NextResponse.json({ error: "update_id tidak valid." }, { status: 400 });
    }
    const result = await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true, replies: result.replies });
  } catch (error) {
    console.error("[POST /api/telegram/update]", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Gagal memproses update." }, { status: 500 });
  }
}
