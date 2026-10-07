// GET /api/public/site — status rekrutmen untuk halaman publik (tanpa login).
// Membaca Setting "site" secara aman (fallback default bila kosong/rusak).
// Return: { recruitmentClosed: boolean, message: string }
// NR-41 E2 — respons dibungkus etagJson: ETag + Cache-Control + 304 bila If-None-Match cocok.
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseSiteContent } from "@/lib/seed";
import { etagJson } from "@/lib/http-cache";

export async function GET(req: NextRequest) {
  try {
    const setting = await db.setting.findUnique({ where: { key: "site" } });
    const site = parseSiteContent(setting?.value);
    // NR-41 E2 — ETag + Cache-Control (kontrak body tidak berubah).
    return etagJson(req, {
      recruitmentClosed: site.recruitmentClosed,
      message: site.recruitmentClosedMessage,
    });
  } catch (error) {
    console.error("[GET /api/public/site]", error);
    // Publik tidak boleh gagal keras — anggap rekrutmen terbuka bila baca gagal.
    return NextResponse.json(
      { recruitmentClosed: false, message: "" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
