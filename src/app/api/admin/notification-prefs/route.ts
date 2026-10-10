// GET /api/admin/notification-prefs — preferensi notifikasi milik sesi (semua role).
// PUT /api/admin/notification-prefs — simpan preferensi milik sesi.
//     Body: { categories: { APPLICATION..LOGIN: boolean }, silentFrom: 0-23|null, silentTo }
// Preferensi memengaruhi daftar notifikasi in-app (kategori nonaktif disembunyikan;
// jam senyap menyembunyikan semua kecuali SYSTEM).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import {
  NOTIFY_CATEGORIES,
  readUserNotifyPrefs,
  writeUserNotifyPrefs,
} from "@/lib/notification-prefs";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    const prefs = await readUserNotifyPrefs(session.id);
    return NextResponse.json({ prefs, categories: NOTIFY_CATEGORIES });
  } catch (error) {
    console.error("[GET /api/admin/notification-prefs]", error);
    return NextResponse.json({ error: "Gagal memuat preferensi notifikasi." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    if (data.categories !== undefined && (typeof data.categories !== "object" || data.categories === null || Array.isArray(data.categories))) {
      return NextResponse.json({ error: "categories harus berupa objek." }, { status: 400 });
    }

    const prefs = await writeUserNotifyPrefs(session.id, data);
    return NextResponse.json({ ok: true, prefs });
  } catch (error) {
    console.error("[PUT /api/admin/notification-prefs]", error);
    return NextResponse.json({ error: "Gagal menyimpan preferensi notifikasi." }, { status: 500 });
  }
}
