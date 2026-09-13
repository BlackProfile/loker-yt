// GET /api/admin/logins — 100 audit login terakhir.
// OWNER: seluruh percobaan login; role lain: hanya milik email sendiri.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const LIMIT = 100;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.loginAudit.findMany({
      where: session.role === "OWNER" ? {} : { email: session.email.toLowerCase() },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMIT,
    });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        email: row.email,
        userId: row.userId,
        success: row.success,
        reason: row.reason,
        userAgent: row.userAgent,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
      })),
    );
  } catch (error) {
    console.error("[GET /api/admin/logins]", error);
    return NextResponse.json({ error: "Gagal memuat audit login. Coba lagi nanti." }, { status: 500 });
  }
}
