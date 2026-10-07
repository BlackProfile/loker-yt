// NR41-SEC-B (L31) — GET /api/admin/health/errors — isi ring buffer error global.
// OWNER saja (requireRole). Mengembalikan entri {at, msg} terlama → terbaru (maks 200).
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/server-auth";
import { getErrorRing } from "@/lib/error-ring";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireRole(["OWNER"]);
  if (!session) {
    return NextResponse.json({ error: "Silakan login terlebih dahulu." }, { status: 401 });
  }
  const errors = getErrorRing();
  return NextResponse.json({ ok: true, total: errors.length, errors });
}
