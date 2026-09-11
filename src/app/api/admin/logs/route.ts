// GET /api/admin/logs — riwayat aktivitas (semua role).
// Query opsional: applicationId, limit (default 50, maks 200).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { LogEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const applicationId = searchParams.get("applicationId") ?? undefined;
    const limitParam = Number.parseInt(searchParams.get("limit") ?? "", 10);
    const limit = Number.isInteger(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

    const rows = await db.activityLog.findMany({
      where: applicationId ? { applicationId } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { application: { select: { name: true } } },
    });

    const logs: LogEntry[] = rows.map((row) => ({
      id: row.id,
      applicationId: row.applicationId,
      applicationName: row.application?.name ?? null,
      actor: row.actor,
      action: row.action,
      detail: row.detail,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json(logs);
  } catch (error) {
    console.error("[GET /api/admin/logs]", error);
    return NextResponse.json({ error: "Gagal memuat riwayat aktivitas. Coba lagi nanti." }, { status: 500 });
  }
}
