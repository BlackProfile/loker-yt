// GET  /api/admin/access-health — laporan Kesehatan Akses (NR46, OWNER saja).
//      Temuan: 2FA kosong, sandi tua/tak tercatat, sesi menggantung, akun
//      nonaktif bersesi hidup, login gagal 24 jam, akun mendekati kedaluwarsa.
// POST /api/admin/access-health — { action: "revokeUserSessions", userId } (OWNER)
//      cabut semua sesi aktif milik satu pengguna (aksi cepat dari kartu).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, revokeUserSessions } from "@/lib/server-auth";
import { getAccessHealth } from "@/lib/access-health";
import { dualControlEnabled } from "@/lib/dual-control";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER dapat melihat kesehatan akses." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const report = await getAccessHealth();
    report.stats.dualControlEnabled = await dualControlEnabled();
    return NextResponse.json(report);
  } catch (error) {
    console.error("[GET /api/admin/access-health]", error);
    return NextResponse.json({ error: "Gagal memuat kesehatan akses." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const body: unknown = await req.json().catch(() => null);
    const data =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const userId = typeof data.userId === "string" ? data.userId.trim() : "";
    if (data.action !== "revokeUserSessions" || !userId) {
      return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
    }

    const target = await db.adminUser.findUnique({ where: { id: userId }, select: { email: true } });
    if (!target) return NextResponse.json({ error: "Pengguna tidak ditemukan." }, { status: 404 });

    const revoked = await revokeUserSessions(userId);
    await db.activityLog
      .create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "SESSIONS_REVOKED",
          detail: `Semua sesi ${target.email} dicabut dari kartu Kesehatan Akses (${revoked} sesi)`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, revoked, message: `${revoked} sesi dicabut.` });
  } catch (error) {
    console.error("[POST /api/admin/access-health]", error);
    return NextResponse.json({ error: "Gagal menjalankan aksi." }, { status: 500 });
  }
}
