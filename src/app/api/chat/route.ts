// POST /api/chat — chatbot rekrutmen publik (LLM z-ai-web-dev-sdk).
import { NextRequest, NextResponse } from "next/server";
import { getZai, withTimeout } from "@/lib/ai";
import { db } from "@/lib/db";
import { getAutomationSettings } from "@/lib/notify";

export const dynamic = "force-dynamic";

const CHAT_TIMEOUT_MS = 60_000; // 60 detik
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_ITEMS = 8;
const MAX_HISTORY_CONTENT_LENGTH = 1000;

type HistoryItem = { role: "user" | "assistant"; content: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Sanitasi history percakapan: hanya user/assistant, potong ke 8 item terakhir. */
function sanitizeHistory(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) return [];
  const items: HistoryItem[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const role = obj.role === "assistant" ? "assistant" : obj.role === "user" ? "user" : null;
    const content = typeof obj.content === "string" ? obj.content.trim().slice(0, MAX_HISTORY_CONTENT_LENGTH) : "";
    if (role && content.length > 0) {
      items.push({ role, content });
    }
  }
  return items.slice(-MAX_HISTORY_ITEMS);
}

/** Daftar posisi aktif (belum lewat closesAt) untuk konteks bot. */
async function getActivePositionLines(): Promise<string> {
  const now = new Date();
  const positions = await db.position.findMany({
    where: {
      isActive: true,
      OR: [{ closesAt: null }, { closesAt: { gt: now } }],
    },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  if (positions.length === 0) {
    return "(saat ini belum ada lowongan yang aktif)";
  }
  const formatter = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric" });
  return positions
    .map((position) => {
      const closeInfo = position.closesAt ? ` — tutup ${formatter.format(position.closesAt)}` : "";
      return `- ${position.title} (${position.type}, ${position.location})${closeInfo}`;
    })
    .join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Pesan tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const message = typeof data.message === "string" ? data.message.trim() : "";
    if (message.length < 1) {
      return NextResponse.json({ error: "Pesan tidak boleh kosong." }, { status: 400 });
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: "Pesan maksimal 500 karakter." }, { status: 400 });
    }
    const history = sanitizeHistory(data.history);

    const automation = await getAutomationSettings();
    if (!automation.chatbotEnabled) {
      return NextResponse.json({ error: "Chatbot sedang nonaktif." }, { status: 403 });
    }

    const activePositions = await getActivePositionLines();
    const systemPrompt = [
      "Kamu adalah Lumina Bot, asisten rekrutmen studio konten kreator Lumina Studio.",
      "Jawab singkat, ramah, santai pakai bahasa Indonesia.",
      "Hanya jawab seputar rekrutmen/lowongan/studio.",
      "Data lowongan aktif:",
      activePositions,
      "Aturan: pendaftaran lewat formulir di halaman ini; jika ditanya hal di luar topik, arahkan kembali dengan sopan.",
    ].join("\n");

    const zai = await getZai();
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: systemPrompt },
          ...history,
          { role: "user", content: message },
        ],
        thinking: { type: "disabled" },
      }),
      "Chatbot",
      CHAT_TIMEOUT_MS,
    );

    const reply = (completion?.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) {
      throw new Error("Balasan LLM kosong");
    }
    return NextResponse.json({ reply });
  } catch (error) {
    console.error("[POST /api/chat]", errorMessage(error));
    return NextResponse.json({ error: "Bot sedang sibuk, coba lagi sebentar." }, { status: 500 });
  }
}
