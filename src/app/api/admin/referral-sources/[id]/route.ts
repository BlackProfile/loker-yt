// NR-41 G13 — PATCH/DELETE /api/admin/referral-sources/[id] — sunting/hapus sumber (OWNER/HR).
// DELETE hanya boleh bila sumber belum dipakai lamaran mana pun (usageCount 0);
// selain itu 409 — admin bisa menonaktifkan lewat PATCH { isActive: false }.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import { REFERRAL_SOURCE_KINDS, type ReferralSourceDto, type ReferralSourceKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Sumber tidak ditemukan." };

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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const { id } = await ctx.params;
    const existing = await db.referralSource.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!existing) return NextResponse.json(NOT_FOUND, { status: 404 });

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: {
      name?: string;
      kind?: ReferralSourceKind;
      isActive?: boolean;
      sortOrder?: number;
    } = {};

    if (data.name !== undefined) {
      const name = typeof data.name === "string" ? data.name.trim().slice(0, 80) : "";
      if (!name) return NextResponse.json({ error: "Nama sumber wajib diisi." }, { status: 400 });
      if (name !== existing.name) {
        const duplicate = await db.referralSource.findUnique({ where: { name } });
        if (duplicate) {
          return NextResponse.json({ error: "Sumber dengan nama itu sudah ada." }, { status: 409 });
        }
      }
      updateData.name = name;
    }
    if (data.kind !== undefined) {
      if (typeof data.kind !== "string" || !(REFERRAL_SOURCE_KINDS as string[]).includes(data.kind)) {
        return NextResponse.json({ error: "Jenis sumber tidak valid." }, { status: 400 });
      }
      updateData.kind = data.kind as ReferralSourceKind;
    }
    if (data.isActive !== undefined) {
      if (typeof data.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive harus boolean." }, { status: 400 });
      }
      updateData.isActive = data.isActive;
    }
    if (data.sortOrder !== undefined) {
      if (
        typeof data.sortOrder !== "number" ||
        !Number.isInteger(data.sortOrder) ||
        data.sortOrder < 0
      ) {
        return NextResponse.json({ error: "sortOrder harus bilangan bulat >= 0." }, { status: 400 });
      }
      updateData.sortOrder = data.sortOrder;
    }

    const updated = await db.referralSource.update({
      where: { id },
      data: updateData,
      include: { _count: { select: { applications: true } } },
    });
    return NextResponse.json(toDto(updated, updated._count.applications));
  } catch (error) {
    console.error("[PATCH /api/admin/referral-sources/[id]]", error);
    return NextResponse.json({ error: "Gagal menyimpan sumber. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const { id } = await ctx.params;
    const existing = await db.referralSource.findUnique({
      where: { id },
      include: { _count: { select: { applications: true } } },
    });
    if (!existing) return NextResponse.json(NOT_FOUND, { status: 404 });

    if (existing._count.applications > 0) {
      // Sudah dipakai riwayat lamaran — jangan hapus (riwayat sumber harus utuh).
      return NextResponse.json(
        {
          error: `Sumber ini dipakai ${existing._count.applications} lamaran. Nonaktifkan saja (isActive: false).`,
        },
        { status: 409 },
      );
    }

    await db.referralSource.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/referral-sources/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus sumber. Coba lagi nanti." }, { status: 500 });
  }
}
