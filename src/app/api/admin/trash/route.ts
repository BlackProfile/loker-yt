// GET  /api/admin/trash — daftar posisi & lamaran di tong sampah (soft delete), semua role admin.
// POST /api/admin/trash — pulihkan (restore) atau hapus permanen (purge), OWNER saja.
//   Body: { type: "position" | "application", id: string, action: "restore" | "purge" }
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { createApprovalRequest, shouldRouteToApproval } from "@/lib/dual-control";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const TRASH_LIMIT = 50;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const [positions, applications] = await Promise.all([
      db.position.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: TRASH_LIMIT,
        select: {
          id: true,
          title: true,
          deletedAt: true,
          _count: { select: { applications: true } },
        },
      }),
      db.application.findMany({
        where: { deletedAt: { not: null } },
        orderBy: { deletedAt: "desc" },
        take: TRASH_LIMIT,
        select: {
          id: true,
          name: true,
          deletedAt: true,
          position: { select: { title: true } },
        },
      }),
    ]);

    return NextResponse.json({
      positions: positions.map((p) => ({
        id: p.id,
        title: p.title,
        deletedAt: p.deletedAt?.toISOString() ?? null,
        applicationsCount: p._count.applications,
      })),
      applications: applications.map((a) => ({
        id: a.id,
        name: a.name,
        positionTitle: a.position?.title ?? null,
        deletedAt: a.deletedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/trash]", error);
    return NextResponse.json({ error: "Gagal memuat tong sampah. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const type = data.type === "position" || data.type === "application" ? data.type : null;
    const action = data.action === "restore" || data.action === "purge" ? data.action : null;
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!type || !action || !id) {
      return NextResponse.json(
        { error: "type (position|application), id, dan action (restore|purge) wajib diisi." },
        { status: 400 },
      );
    }

    if (type === "position") {
      const position = await db.position.findUnique({
        where: { id },
        include: { _count: { select: { applications: true } } },
      });
      if (!position || !position.deletedAt) {
        return NextResponse.json({ error: "Posisi tidak ditemukan di tong sampah." }, { status: 404 });
      }

      if (action === "restore") {
        await db.position.update({ where: { id }, data: { deletedAt: null } });
        await db.activityLog.create({
          data: {
            applicationId: null,
            actor: session.name,
            action: "POSITION_RESTORE",
            detail: `Posisi "${position.title}" dipulihkan dari tong sampah`,
          },
        });
        return NextResponse.json({ ok: true, action: "restore" });
      }

      // purge: PERMANEN hanya bila tidak ada lamaran (termasuk yang di tong sampah).
      if (position._count.applications > 0) {
        return NextResponse.json(
          {
            error: `Posisi masih memiliki ${position._count.applications} lamaran. Hapus lamarannya dulu sebelum hapus permanen.`,
          },
          { status: 409 },
        );
      }
      // NR46 — empat mata: hapus permanen posisi lewat persetujuan OWNER lain.
      if (await shouldRouteToApproval()) {
        const requestId = await createApprovalRequest({
          kind: "TRASH_PURGE_POSITION",
          payload: { positionId: id },
          summary: `Hapus permanen posisi "${position.title}" dari tong sampah`,
          session,
        });
        return NextResponse.json(
          {
            approvalRequired: true,
            requestId,
            message: `Permintaan hapus permanen posisi "${position.title}" dikirim — menunggu persetujuan OWNER lain.`,
          },
          { status: 202 },
        );
      }
      await db.position.delete({ where: { id } });
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "POSITION_PURGE",
          detail: `Posisi "${position.title}" dihapus permanen`,
        },
      });
      return NextResponse.json({ ok: true, action: "purge" });
    }

    // type === "application"
    const application = await db.application.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        trackingCode: true,
        deletedAt: true,
        position: { select: { title: true } },
      },
    });
    if (!application || !application.deletedAt) {
      return NextResponse.json({ error: "Lamaran tidak ditemukan di tong sampah." }, { status: 404 });
    }

    if (action === "restore") {
      await db.application.update({ where: { id }, data: { deletedAt: null } });
      await db.activityLog.create({
        data: {
          applicationId: application.id,
          actor: session.name,
          action: "APPLICATION_RESTORE",
          detail: `Lamaran ${application.name} (${application.trackingCode}) dipulihkan dari tong sampah`,
        },
      });
      return NextResponse.json({ ok: true, action: "restore" });
    }

    // purge: hapus permanen (relasi ikut terhapus via onDelete Cascade).
    // Log ditulis dengan applicationId null karena baris lamaran akan hilang.
    const label = `${application.name} (${application.trackingCode}) — posisi ${application.position?.title ?? "-"}`;
    // NR46 — empat mata: hapus permanen lamaran lewat persetujuan OWNER lain.
    if (await shouldRouteToApproval()) {
      const requestId = await createApprovalRequest({
        kind: "TRASH_PURGE_APPLICATION",
        payload: { applicationId: application.id },
        summary: `Hapus permanen lamaran ${label} dari tong sampah`,
        session,
      });
      return NextResponse.json(
        {
          approvalRequired: true,
          requestId,
          message: `Permintaan hapus permanen lamaran ${application.name} dikirim — menunggu persetujuan OWNER lain.`,
        },
        { status: 202 },
      );
    }
    await db.application.delete({ where: { id } });
    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: session.name,
        action: "APPLICATION_PURGE",
        detail: `Lamaran ${label} dihapus permanen`,
      },
    });
    return NextResponse.json({ ok: true, action: "purge" });
  } catch (error) {
    console.error("[POST /api/admin/trash]", error);
    return NextResponse.json({ error: "Gagal memproses tong sampah. Coba lagi nanti." }, { status: 500 });
  }
}
