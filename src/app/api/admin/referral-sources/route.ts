// NR-41 G13 — Sumber lamaran terstruktur (ReferralSource) — panel admin.
// GET  /api/admin/referral-sources — daftar + usageCount (jumlah lamaran yang memakai).
// POST /api/admin/referral-sources — buat sumber baru {name, kind, sortOrder} (OWNER/HR).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import { REFERRAL_SOURCE_KINDS, type ReferralSourceDto, type ReferralSourceKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

/** Susun DTO sumber + jumlah pemakaian. */
function toDto(
  row: { id: string; name: string; kind: string; isActive: boolean; sortOrder: number },
  usageCount: number,
): ReferralSourceDto {
  return {
    id: row.id,
    name: row.name,
    kind: (REFERRAL_SOURCE_KINDS as string[]).includes(row.kind)
      ? (row.kind as ReferralSourceKind)
      : "OTHER",
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    usageCount,
  };
}

export async function GET() {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const rows = await db.referralSource.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { applications: true } } },
    });

    return NextResponse.json(rows.map((row) => toDto(row, row._count.applications)));
  } catch (error) {
    console.error("[GET /api/admin/referral-sources]", error);
    return NextResponse.json({ error: "Gagal memuat daftar sumber. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const name = typeof data.name === "string" ? data.name.trim().slice(0, 80) : "";
    if (!name) {
      return NextResponse.json({ error: "Nama sumber wajib diisi." }, { status: 400 });
    }
    const kind =
      typeof data.kind === "string" && (REFERRAL_SOURCE_KINDS as string[]).includes(data.kind)
        ? (data.kind as ReferralSourceKind)
        : "OTHER";
    const sortOrder =
      typeof data.sortOrder === "number" && Number.isInteger(data.sortOrder) && data.sortOrder >= 0
        ? data.sortOrder
        : 0;

    const duplicate = await db.referralSource.findUnique({ where: { name } });
    if (duplicate) {
      return NextResponse.json({ error: "Sumber dengan nama itu sudah ada." }, { status: 409 });
    }

    const created = await db.referralSource.create({ data: { name, kind, sortOrder } });
    return NextResponse.json(toDto(created, 0), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/referral-sources]", error);
    return NextResponse.json({ error: "Gagal membuat sumber. Coba lagi nanti." }, { status: 500 });
  }
}
