// NR-41 G14 — PATCH/DELETE /api/admin/saved-views/[id].
// PATCH: rename / ubah query / ubah shared — hanya pemilik view ATAU OWNER
//        (shared=true hanya bisa dipasang OWNER).
// DELETE: pemilik view ATAU OWNER.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import type { SavedViewDto } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Tampilan tersimpan tidak ditemukan." };

const QUERY_MAX_BYTES = 8 * 1024;
const NAME_MAX = 80;

function parseQueryObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // diam
  }
  return {};
}

function toDto(row: {
  id: string;
  name: string;
  tab: string;
  query: string;
  ownerId: string | null;
  shared: boolean;
  createdAt: Date;
  updatedAt: Date;
  owner?: { name: string } | null;
}): SavedViewDto {
  return {
    id: row.id,
    name: row.name,
    tab: row.tab,
    query: parseQueryObject(row.query),
    ownerId: row.ownerId,
    ownerName: row.owner?.name ?? null,
    shared: row.shared,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
    const existing = await db.savedView.findUnique({
      where: { id },
      include: { owner: { select: { name: true } } },
    });
    if (!existing) return NextResponse.json(NOT_FOUND, { status: 404 });

    // Hanya pemilik ATAU OWNER yang boleh mengubah.
    if (existing.ownerId !== session.id && session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: { name?: string; query?: string; shared?: boolean } = {};

    if (data.name !== undefined) {
      const name = typeof data.name === "string" ? data.name.trim().slice(0, NAME_MAX) : "";
      if (!name) return NextResponse.json({ error: "Nama tampilan wajib diisi." }, { status: 400 });
      updateData.name = name;
    }
    if (data.query !== undefined) {
      if (!data.query || typeof data.query !== "object" || Array.isArray(data.query)) {
        return NextResponse.json({ error: "Query harus berupa objek filter." }, { status: 400 });
      }
      const queryJson = JSON.stringify(data.query);
      if (queryJson.length > QUERY_MAX_BYTES) {
        return NextResponse.json({ error: "Filter terlalu besar (maks 8 KB)." }, { status: 400 });
      }
      updateData.query = queryJson;
    }
    if (data.shared !== undefined) {
      if (typeof data.shared !== "boolean") {
        return NextResponse.json({ error: "shared harus boolean." }, { status: 400 });
      }
      // shared=true hanya OWNER; non-OWNER yang mencoba membagikan → dipaksa false.
      updateData.shared = data.shared && session.role === "OWNER";
    }

    const updated = await db.savedView.update({
      where: { id },
      data: updateData,
      include: { owner: { select: { name: true } } },
    });
    return NextResponse.json(toDto(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/saved-views/[id]]", error);
    return NextResponse.json({ error: "Gagal menyimpan perubahan tampilan. Coba lagi nanti." }, { status: 500 });
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
    const existing = await db.savedView.findUnique({ where: { id } });
    if (!existing) return NextResponse.json(NOT_FOUND, { status: 404 });

    // Hanya pemilik ATAU OWNER yang boleh menghapus.
    if (existing.ownerId !== session.id && session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    await db.savedView.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/saved-views/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus tampilan. Coba lagi nanti." }, { status: 500 });
  }
}
