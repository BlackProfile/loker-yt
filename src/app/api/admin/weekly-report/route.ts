// GET/PUT /api/admin/weekly-report — pengaturan laporan Excel mingguan via
// Telegram (XL-BE). GET: OWNER/HR melihat status; PUT: hanya OWNER yang boleh
// mengubah (konsisten dengan route settings). Body PUT: { enabled, chatId } —
// chatId kosong berarti kirim ke semua chat admin aktif (activeChats).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import { getWeeklyReportSettings, saveWeeklyReportSettings } from "@/lib/weekly-report";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const settings = await getWeeklyReportSettings();
    return NextResponse.json({ enabled: settings.enabled, chatId: settings.chatId });
  } catch (error) {
    console.error("[GET /api/admin/weekly-report]", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan laporan mingguan." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const obj = body as Record<string, unknown>;
    const enabled = obj.enabled === true;
    const rawChatId = typeof obj.chatId === "string" ? obj.chatId.trim() : "";
    // Chat ID Telegram: angka (boleh negatif untuk grup) atau kosong (chat default).
    if (rawChatId && !/^-?\d{4,25}$/.test(rawChatId)) {
      return NextResponse.json(
        { error: "Chat ID Telegram harus berupa angka (mis. 123456789) atau dikosongkan." },
        { status: 400 },
      );
    }
    await saveWeeklyReportSettings({ enabled, chatId: rawChatId });
    return NextResponse.json({ ok: true, enabled, chatId: rawChatId });
  } catch (error) {
    console.error("[PUT /api/admin/weekly-report]", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan laporan mingguan." }, { status: 500 });
  }
}
