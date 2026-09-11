// POST /api/admin/logout — hapus cookie sesi admin.
import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const response = NextResponse.json({ ok: true });
    await clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error("[POST /api/admin/logout]", error);
    return NextResponse.json({ error: "Gagal keluar. Coba lagi nanti." }, { status: 500 });
  }
}
