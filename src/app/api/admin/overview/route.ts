// GET /api/admin/overview — statistik lamaran + 5 lamaran terbaru (khusus admin).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/server-auth";
import { ensureSeeded, serializeApplication } from "@/lib/seed";
import { APPLICATION_STATUSES, type ApplicationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    await ensureSeeded();

    const [total, statusGroups, recentRows] = await Promise.all([
      db.application.count(),
      db.application.groupBy({ by: ["status"], _count: { _all: true } }),
      db.application.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 5,
        include: { position: { select: { title: true } } },
      }),
    ]);

    const stats = {
      total,
      NEW: 0,
      REVIEWED: 0,
      INTERVIEW: 0,
      ACCEPTED: 0,
      REJECTED: 0,
    };
    for (const group of statusGroups) {
      if ((APPLICATION_STATUSES as string[]).includes(group.status)) {
        stats[group.status as ApplicationStatus] = group._count._all;
      }
    }

    return NextResponse.json({ stats, recent: recentRows.map(serializeApplication) });
  } catch (error) {
    console.error("[GET /api/admin/overview]", error);
    return NextResponse.json({ error: "Gagal memuat ringkasan. Coba lagi nanti." }, { status: 500 });
  }
}
