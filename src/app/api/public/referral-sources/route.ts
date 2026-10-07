// NR-41 G13 — GET /api/public/referral-sources — daftar sumber aktif untuk wizard publik.
// Tanpa auth; hanya id + nama (tanpa data internal), urut sortOrder.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db.referralSource.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
    return NextResponse.json({ items: rows });
  } catch (error) {
    console.error("[GET /api/public/referral-sources]", error);
    // Publik tidak boleh gagal keras — kembalikan daftar kosong.
    return NextResponse.json({ items: [] });
  }
}
