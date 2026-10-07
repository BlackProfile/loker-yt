// NR-41 H17 — GET /api/admin/applications/[id]/export-data — ekspor data subjek (OWNER/HR).
// Mengunduh bundel DataSubjectExport sebagai file JSON (Content-Disposition
// attachment, nama file `data-subjek-${trackingCode||id}.json`).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import { buildDataSubjectExport } from "@/lib/export-subject";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const { id } = await ctx.params;
    const exists = await db.application.findUnique({
      where: { id },
      select: { trackingCode: true },
    });
    if (!exists) return NextResponse.json(NOT_FOUND, { status: 404 });

    const bundle = await buildDataSubjectExport(id, "admin");
    if (!bundle) return NextResponse.json(NOT_FOUND, { status: 404 });

    const filename = `data-subjek-${exists.trackingCode || id}.json`;
    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/export-data]", error);
    return NextResponse.json({ error: "Gagal mengekspor data subjek. Coba lagi nanti." }, { status: 500 });
  }
}
