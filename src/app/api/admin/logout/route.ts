// POST /api/admin/logout — hapus cookie sesi admin + cabut row SessionToken perangkat ini.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { ADMIN_COOKIE_NAME, clearSessionCookie, hashToken } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  try {
    // Task 27: cabut sesi per perangkat ini (revokedAt = sekarang) agar token yang sama
    // tidak bisa dipakai lagi meski cookie belum terhapus di klien.
    try {
      const cookieStore = await cookies();
      const token = cookieStore.get(ADMIN_COOKIE_NAME)?.value;
      if (token) {
        await db.sessionToken.updateMany({
          where: { tokenHash: hashToken(token), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } catch (err) {
      console.error("[POST /api/admin/logout] gagal mencabut SessionToken", err);
    }

    const response = NextResponse.json({ ok: true });
    await clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error("[POST /api/admin/logout]", error);
    return NextResponse.json({ error: "Gagal keluar. Coba lagi nanti." }, { status: 500 });
  }
}
