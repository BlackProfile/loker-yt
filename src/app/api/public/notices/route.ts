// GET /api/public/notices — pengumuman publik untuk pelamar di halaman utama (NR63).
// Tanpa login: hanya pengumuman yang ditandai isPublic oleh OWNER/HR.
// Urutan: pinned desc lalu createdAt desc, maks 5 terbaru (popup + chip mengapung).
// Keamanan: authorName TIDAK ikut dikirim (nama admin tidak diekspos ke publik).
// Cache: etagJson — ETag + Cache-Control + 304 bila If-None-Match cocok (pola /api/public/site).
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { etagJson } from "@/lib/http-cache";

const MAX_PUBLIC_NOTICES = 5;

export async function GET(req: NextRequest) {
  try {
    const rows = await db.announcement.findMany({
      where: { isPublic: true },
      orderBy: [{ pinned: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: MAX_PUBLIC_NOTICES,
    });

    return etagJson(
      req,
      rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        createdAt: row.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error("[GET /api/public/notices]", error);
    // Halaman publik tidak boleh gagal keras — daftar kosong cukup.
    return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
  }
}
