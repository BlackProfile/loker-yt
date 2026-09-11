// POST /api/admin/applications/bulk — aksi massal: ubah status, hapus, atau atur talent pool (OWNER/HR).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_STATUSES, STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const ids = Array.isArray(data.ids)
      ? data.ids.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Daftar ID lamaran tidak valid." }, { status: 400 });
    }

    const action = typeof data.action === "string" ? data.action : "";
    if (!["status", "delete", "talentPool"].includes(action)) {
      return NextResponse.json({ error: "Aksi tidak valid." }, { status: 400 });
    }

    let affected = 0;
    let logAction = "";
    let logDetail = "";

    if (action === "status") {
      const status = typeof data.status === "string" ? data.status : "";
      if (!(APPLICATION_STATUSES as string[]).includes(status)) {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      const result = await db.application.updateMany({ where: { id: { in: ids } }, data: { status } });
      affected = result.count;
      const label = STATUS_LABELS[status as ApplicationStatus];
      logAction = "BULK_STATUS";
      logDetail = `${affected} lamaran diubah status menjadi ${label}`;
    } else if (action === "talentPool") {
      if (typeof data.talentPool !== "boolean") {
        return NextResponse.json({ error: "talentPool harus berupa boolean." }, { status: 400 });
      }
      const result = await db.application.updateMany({
        where: { id: { in: ids } },
        data: { talentPool: data.talentPool },
      });
      affected = result.count;
      logAction = "BULK_TALENT_POOL";
      logDetail = `${affected} lamaran ${data.talentPool ? "ditambahkan ke" : "dikeluarkan dari"} talent pool`;
    } else {
      const result = await db.application.deleteMany({ where: { id: { in: ids } } });
      affected = result.count;
      logAction = "BULK_DELETE";
      logDetail = `${affected} lamaran dihapus`;
    }

    await db.activityLog.create({
      data: { applicationId: null, actor: session.name, action: logAction, detail: logDetail },
    });

    return NextResponse.json({ ok: true, affected });
  } catch (error) {
    console.error("[POST /api/admin/applications/bulk]", error);
    return NextResponse.json({ error: "Gagal menjalankan aksi massal. Coba lagi nanti." }, { status: 500 });
  }
}
