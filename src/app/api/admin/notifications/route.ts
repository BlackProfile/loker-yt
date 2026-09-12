// GET   /api/admin/notifications — 50 notifikasi in-app terbaru + unreadCount (semua role).
// PATCH /api/admin/notifications — tandai notifikasi dibaca: body { id } ATAU { all: true }.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const [rows, unreadCount] = await Promise.all([
      db.notificationItem.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
        include: { application: { select: { name: true } } },
      }),
      db.notificationItem.count({ where: { isRead: false } }),
    ]);

    return NextResponse.json({
      notifications: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        category: row.category,
        applicationId: row.applicationId,
        applicationName: row.application?.name ?? null,
        isRead: row.isRead,
        createdAt: row.createdAt.toISOString(),
      })),
      unreadCount,
    });
  } catch (error) {
    console.error("[GET /api/admin/notifications]", error);
    return NextResponse.json(
      { error: "Gagal memuat notifikasi. Coba lagi nanti." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json(
        { error: "Kirim { id } atau { all: true }." },
        { status: 400 }
      );
    }
    const data = body as Record<string, unknown>;

    if (data.all === true) {
      // Tandai semua notifikasi belum-baca sebagai dibaca.
      await db.notificationItem.updateMany({
        where: { isRead: false },
        data: { isRead: true },
      });
    } else if (typeof data.id === "string" && data.id.trim().length > 0) {
      // Tandai satu notifikasi (idempoten: hanya yang belum dibaca).
      await db.notificationItem.updateMany({
        where: { id: data.id, isRead: false },
        data: { isRead: true },
      });
    } else {
      return NextResponse.json(
        { error: "Kirim { id } atau { all: true }." },
        { status: 400 }
      );
    }

    const unreadCount = await db.notificationItem.count({ where: { isRead: false } });
    return NextResponse.json({ ok: true, unreadCount });
  } catch (error) {
    console.error("[PATCH /api/admin/notifications]", error);
    return NextResponse.json(
      { error: "Gagal menandai notifikasi. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
