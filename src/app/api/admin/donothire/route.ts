// NR-24 — Daftar Do-not-Hire (pelamar yang tidak boleh dilanjutkan).
// GET    /api/admin/donothire — baca seluruh entri urut terbaru (OWNER/HR).
// PUT    /api/admin/donothire — tambah/perbarui satu entri (OWNER/HR) body {key, reason}.
// DELETE /api/admin/donothire — hapus entri (OWNER saja) query ?key=...&confirm=YA.
// Penyimpanan: Setting "doNotHire" (JSON map {key: {reason, by, at}}); key = email lowercase
// ATAU nomor telepon digit saja — bentuk normal yang sama dipakai peringatan saat submit publik.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { DoNotHireEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const KEY_MAX = 120;
const REASON_MAX = 300;
const DNH_KEY = "doNotHire";

/** Baca map doNotHire dari Setting (aman terhadap JSON rusak). */
async function readMap(): Promise<Record<string, { reason: string; by: string; at: string }>> {
  const row = await db.setting.findUnique({ where: { key: DNH_KEY } });
  if (!row) return {};
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, { reason: string; by: string; at: string }> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      const reason = typeof entry.reason === "string" ? entry.reason : "";
      const by = typeof entry.by === "string" ? entry.by : "";
      const at = typeof entry.at === "string" ? entry.at : "";
      map[key] = { reason, by, at };
    }
    return map;
  } catch {
    return {};
  }
}

/** Tulis map doNotHire ke Setting (upsert). */
async function writeMap(map: Record<string, { reason: string; by: string; at: string }>): Promise<void> {
  await db.setting.upsert({
    where: { key: DNH_KEY },
    create: { key: DNH_KEY, value: JSON.stringify(map) },
    update: { value: JSON.stringify(map) },
  });
}

function serialize(map: Record<string, { reason: string; by: string; at: string }>): DoNotHireEntry[] {
  return Object.entries(map)
    .map(([key, entry]) => ({ key, reason: entry.reason, by: entry.by, at: entry.at }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const map = await readMap();
    return NextResponse.json({ entries: serialize(map) });
  } catch (error) {
    console.error("[GET /api/admin/donothire]", error);
    return NextResponse.json({ error: "Gagal memuat daftar Do-not-Hire." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const rawKey = typeof data.key === "string" ? data.key.trim() : "";
    if (!rawKey) {
      return NextResponse.json({ error: "Email atau nomor telepon wajib diisi." }, { status: 400 });
    }
    if (rawKey.length > KEY_MAX) {
      return NextResponse.json({ error: `Kunci maksimal ${KEY_MAX} karakter.` }, { status: 400 });
    }
    const reason = typeof data.reason === "string" ? data.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "Alasan wajib diisi." }, { status: 400 });
    }
    if (reason.length > REASON_MAX) {
      return NextResponse.json({ error: `Alasan maksimal ${REASON_MAX} karakter.` }, { status: 400 });
    }

    // Normalisasi kunci: email → lowercase; selain itu nomor telepon digit saja.
    const key = rawKey.includes("@") ? rawKey.toLowerCase() : rawKey.replace(/\D/g, "");
    if (!key) {
      return NextResponse.json(
        { error: "Masukkan email yang valid atau nomor telepon yang berisi angka." },
        { status: 400 }
      );
    }

    const map = await readMap();
    map[key] = { reason, by: session.name, at: new Date().toISOString() };
    await writeMap(map);

    return NextResponse.json({ ok: true, entries: serialize(map) });
  } catch (error) {
    console.error("[PUT /api/admin/donothire]", error);
    return NextResponse.json({ error: "Gagal menyimpan entri Do-not-Hire. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const key = (req.nextUrl.searchParams.get("key") ?? "").trim();
    const confirm = req.nextUrl.searchParams.get("confirm") ?? "";
    if (confirm !== "YA") {
      return NextResponse.json({ error: "Konfirmasi penghapusan diperlukan." }, { status: 400 });
    }
    if (!key) {
      return NextResponse.json({ error: "Kunci entri wajib diberikan." }, { status: 400 });
    }

    const map = await readMap();
    if (!Object.prototype.hasOwnProperty.call(map, key)) {
      return NextResponse.json({ error: "Entri Do-not-Hire tidak ditemukan" }, { status: 404 });
    }
    delete map[key];
    await writeMap(map);

    return NextResponse.json({ ok: true, entries: serialize(map) });
  } catch (error) {
    console.error("[DELETE /api/admin/donothire]", error);
    return NextResponse.json({ error: "Gagal menghapus entri Do-not-Hire. Coba lagi nanti." }, { status: 500 });
  }
}
