// GET  /api/admin/offer-approval — status alur persetujuan offer dua lapis (OWNER/HR).
// PUT  /api/admin/offer-approval — aktif/matikan alur (OWNER); Setting "offer_approval" = {"enabled": boolean}.
// Kontrak NR44: bila enabled dan pengaju role HR -> draft offer menunggu persetujuan OWNER;
// bila mati atau pengaju OWNER -> jalur kirim lama langsung (kompatibel).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export const OFFER_APPROVAL_SETTING_KEY = "offer_approval";

/** Baca Setting "offer_approval" — toleran terhadap JSON rusak (default mati). */
export async function readOfferApprovalEnabled(): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key: OFFER_APPROVAL_SETTING_KEY } });
    if (!row) return false;
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).enabled === true;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    // Kontrak NR44: tanpa sesi -> 403 (endpoint alur kerja internal).
    const session = await getSession();
    if (!session || session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const enabled = await readOfferApprovalEnabled();
    return NextResponse.json({ enabled });
  } catch (error) {
    console.error("[GET /api/admin/offer-approval]", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan persetujuan offer." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const enabled = (body as Record<string, unknown>).enabled;
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "Nilai enabled harus boolean." }, { status: 400 });
    }

    await db.setting.upsert({
      where: { key: OFFER_APPROVAL_SETTING_KEY },
      update: { value: JSON.stringify({ enabled }) },
      create: { key: OFFER_APPROVAL_SETTING_KEY, value: JSON.stringify({ enabled }) },
    });

    return NextResponse.json({ ok: true, enabled });
  } catch (error) {
    console.error("[PUT /api/admin/offer-approval]", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan persetujuan offer." }, { status: 500 });
  }
}
