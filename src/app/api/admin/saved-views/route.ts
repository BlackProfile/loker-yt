// NR-41 G14 — Saved views server-side (panel admin).
// GET  /api/admin/saved-views — milik sesi ATAU shared=true (semua role login).
// POST /api/admin/saved-views — buat {name, tab, query(object), shared} (OWNER/HR;
//        shared=true hanya OWNER — non-OWNER dipaksa false).
// Query disimpan sebagai JSON string di SavedView.query; DTO mengembalikan objek.
// Catatan: SavedView.ownerId adalah string biasa (tanpa relasi di skema) — nama
// pemilik di-resolve terpisah dari AdminUser.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import type { SavedViewDto } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const QUERY_MAX_BYTES = 8 * 1024; // batas aman payload filter per view
const NAME_MAX = 80;

/** Parse JSON string query ke objek aman (fallback {}). */
function parseQueryObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // diam — fallback objek kosong
  }
  return {};
}

/**
 * Susun DTO dari row SavedView + map nama pemilik (AdminUser.name).
 * ownerId bisa milik admin yang sudah dihapus → fallback null.
 */
async function toDtos(
  rows: Array<{
    id: string;
    name: string;
    tab: string;
    query: string;
    ownerId: string | null;
    shared: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>,
): Promise<SavedViewDto[]> {
  const ownerIds = [...new Set(rows.map((row) => row.ownerId).filter((id): id is string => Boolean(id)))];
  const owners = ownerIds.length > 0
    ? await db.adminUser.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(owners.map((owner) => [owner.id, owner.name]));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tab: row.tab,
    query: parseQueryObject(row.query),
    ownerId: row.ownerId,
    ownerName: row.ownerId ? nameById.get(row.ownerId) ?? null : null,
    shared: row.shared,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function GET() {
  try {
    const session = await requireRole(["OWNER", "HR", "VIEWER"]);
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });

    const rows = await db.savedView.findMany({
      where: { OR: [{ ownerId: session.id }, { shared: true }] },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json(await toDtos(rows));
  } catch (error) {
    console.error("[GET /api/admin/saved-views]", error);
    return NextResponse.json({ error: "Gagal memuat tampilan tersimpan. Coba lagi nanti." }, { status: 500 });
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

    const name = typeof data.name === "string" ? data.name.trim().slice(0, NAME_MAX) : "";
    if (!name) return NextResponse.json({ error: "Nama tampilan wajib diisi." }, { status: 400 });

    const tab = typeof data.tab === "string" && data.tab.trim() ? data.tab.trim().slice(0, 40) : "applications";

    if (!data.query || typeof data.query !== "object" || Array.isArray(data.query)) {
      return NextResponse.json({ error: "Query harus berupa objek filter." }, { status: 400 });
    }
    const queryJson = JSON.stringify(data.query);
    if (queryJson.length > QUERY_MAX_BYTES) {
      return NextResponse.json({ error: "Filter terlalu besar (maks 8 KB)." }, { status: 400 });
    }

    // shared=true hanya OWNER — non-OWNER dipaksa false.
    const shared = data.shared === true && session.role === "OWNER";

    const created = await db.savedView.create({
      data: {
        name,
        tab,
        query: queryJson,
        ownerId: session.id,
        shared,
      },
    });
    return NextResponse.json((await toDtos([created]))[0], { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/saved-views]", error);
    return NextResponse.json({ error: "Gagal menyimpan tampilan. Coba lagi nanti." }, { status: 500 });
  }
}
