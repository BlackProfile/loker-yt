// GET /api/admin/session — cek status login admin saat ini.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const authenticated = await requireAdmin();
    return NextResponse.json({ authenticated });
  } catch (error) {
    console.error("[GET /api/admin/session]", error);
    return NextResponse.json({ error: "Gagal memeriksa sesi. Coba lagi nanti." }, { status: 500 });
  }
}
