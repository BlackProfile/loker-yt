// GET /api/admin/settings — ambil konten situs (semua role).
// PUT /api/admin/settings — simpan konten situs (OWNER saja).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { ensureSeeded, parseSiteContent, sanitizeSiteContent } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    await ensureSeeded();

    const setting = await db.setting.findUnique({ where: { key: "site" } });
    return NextResponse.json({ site: parseSiteContent(setting?.value) });
  } catch (error) {
    console.error("[GET /api/admin/settings]", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan. Coba lagi nanti." }, { status: 500 });
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
    const data = body as Record<string, unknown>;

    if (data.newPassword !== undefined || data.currentPassword !== undefined) {
      return NextResponse.json(
        { error: "Ganti password dilakukan melalui endpoint /api/admin/users/password." },
        { status: 400 },
      );
    }
    if (data.site === undefined) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const incoming = data.site;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return NextResponse.json({ error: "Konten situs tidak valid." }, { status: 400 });
    }
    const siteObj = incoming as Record<string, unknown>;

    if (siteObj.benefits !== undefined && !Array.isArray(siteObj.benefits)) {
      return NextResponse.json({ error: "Daftar benefit harus berupa array." }, { status: 400 });
    }
    if (siteObj.faqs !== undefined && !Array.isArray(siteObj.faqs)) {
      return NextResponse.json({ error: "Daftar FAQ harus berupa array." }, { status: 400 });
    }
    if (siteObj.teamMembers !== undefined && !Array.isArray(siteObj.teamMembers)) {
      return NextResponse.json({ error: "Daftar anggota tim harus berupa array." }, { status: 400 });
    }

    const currentSetting = await db.setting.findUnique({ where: { key: "site" } });
    const merged = sanitizeSiteContent(siteObj, parseSiteContent(currentSetting?.value));

    if (!merged.siteName.trim()) {
      return NextResponse.json({ error: "Nama situs wajib diisi." }, { status: 400 });
    }

    await db.setting.upsert({
      where: { key: "site" },
      update: { value: JSON.stringify(merged) },
      create: { key: "site", value: JSON.stringify(merged) },
    });

    return NextResponse.json({ ok: true, site: merged });
  } catch (error) {
    console.error("[PUT /api/admin/settings]", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan. Coba lagi nanti." }, { status: 500 });
  }
}
