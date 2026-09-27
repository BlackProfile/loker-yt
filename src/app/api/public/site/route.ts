// GET /api/public/site — status rekrutmen untuk halaman publik (tanpa login).
// Membaca Setting "site" secara aman (fallback default bila kosong/rusak).
// Return: { recruitmentClosed: boolean, message: string }
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseSiteContent } from "@/lib/seed";

export async function GET() {
  try {
    const setting = await db.setting.findUnique({ where: { key: "site" } });
    const site = parseSiteContent(setting?.value);
    return NextResponse.json(
      {
        recruitmentClosed: site.recruitmentClosed,
        message: site.recruitmentClosedMessage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[GET /api/public/site]", error);
    // Publik tidak boleh gagal keras — anggap rekrutmen terbuka bila baca gagal.
    return NextResponse.json(
      { recruitmentClosed: false, message: "" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
