// GET /api/admin/settings — ambil konten situs (tanpa password).
// PUT /api/admin/settings — simpan konten situs dan/atau ganti password admin.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { hashPassword, requireAdmin, verifyPassword } from "@/lib/server-auth";
import { ensureSeeded, parseSiteContent, sanitizeSiteContent } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };

async function readSiteSetting() {
  return db.setting.findUnique({ where: { key: "site" } });
}

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    await ensureSeeded();

    const setting = await readSiteSetting();
    return NextResponse.json({ site: parseSiteContent(setting?.value) });
  } catch (error) {
    console.error("[GET /api/admin/settings]", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan. Coba lagi nanti." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const hasSiteUpdate = data.site !== undefined;
    const hasPasswordUpdate = data.newPassword !== undefined && data.newPassword !== null;

    if (!hasSiteUpdate && !hasPasswordUpdate) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    // --- Simpan konten situs ---
    if (hasSiteUpdate) {
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

      const currentSetting = await readSiteSetting();
      const merged = sanitizeSiteContent(siteObj, parseSiteContent(currentSetting?.value));

      if (!merged.siteName.trim()) {
        return NextResponse.json({ error: "Nama situs wajib diisi." }, { status: 400 });
      }

      await db.setting.upsert({
        where: { key: "site" },
        update: { value: JSON.stringify(merged) },
        create: { key: "site", value: JSON.stringify(merged) },
      });
    }

    // --- Ganti password admin ---
    if (hasPasswordUpdate) {
      if (typeof data.newPassword !== "string" || data.newPassword.length < 6) {
        return NextResponse.json({ error: "Password baru minimal 6 karakter" }, { status: 400 });
      }
      const currentPassword = typeof data.currentPassword === "string" ? data.currentPassword : "";
      const passwordSetting = await db.setting.findUnique({ where: { key: "admin_password" } });
      if (!passwordSetting || !verifyPassword(currentPassword, passwordSetting.value)) {
        return NextResponse.json({ error: "Password saat ini salah" }, { status: 400 });
      }

      const nextHash = hashPassword(data.newPassword);
      await db.setting.upsert({
        where: { key: "admin_password" },
        update: { value: nextHash },
        create: { key: "admin_password", value: nextHash },
      });
    }

    const latest = await readSiteSetting();
    return NextResponse.json({ ok: true, site: parseSiteContent(latest?.value) });
  } catch (error) {
    console.error("[PUT /api/admin/settings]", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan. Coba lagi nanti." }, { status: 500 });
  }
}
