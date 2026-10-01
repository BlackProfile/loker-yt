// GET /api/admin/candidate-emails — baca konfigurasi email status kandidat (semua role).
// PUT /api/admin/candidate-emails — simpan konfigurasi (OWNER saja).
// Konfigurasi disimpan di Setting key "candidateEmails" (lihat src/lib/candidate-emails.ts).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  getCandidateEmailConfig,
  sanitizeCandidateEmailConfig,
} from "@/lib/candidate-emails";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const config = await getCandidateEmailConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error("[GET /api/admin/candidate-emails]", error);
    return NextResponse.json({ error: "Gagal memuat konfigurasi email. Coba lagi nanti." }, { status: 500 });
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
    const config = sanitizeCandidateEmailConfig((body as Record<string, unknown>).config);
    if (!config) {
      return NextResponse.json(
        { error: "Konfigurasi tidak valid. Periksa subject (maks 200) dan isi email (maks 5000)." },
        { status: 400 },
      );
    }
    await db.setting.upsert({
      where: { key: "candidateEmails" },
      update: { value: JSON.stringify(config) },
      create: { key: "candidateEmails", value: JSON.stringify(config) },
    });
    return NextResponse.json({ ok: true, config });
  } catch (error) {
    console.error("[PUT /api/admin/candidate-emails]", error);
    return NextResponse.json({ error: "Gagal menyimpan konfigurasi email. Coba lagi nanti." }, { status: 500 });
  }
}
