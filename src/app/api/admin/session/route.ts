// GET /api/admin/session — cek status login admin saat ini beserta data sesinya.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    return NextResponse.json({ authenticated: session !== null, session });
  } catch (error) {
    console.error("[GET /api/admin/session]", error);
    return NextResponse.json({ error: "Gagal memeriksa sesi. Coba lagi nanti." }, { status: 500 });
  }
}
