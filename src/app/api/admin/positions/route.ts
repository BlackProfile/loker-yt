// GET  /api/admin/positions — daftar SEMUA posisi (termasuk nonaktif), semua role.
// POST /api/admin/positions — buat posisi baru (OWNER/HR), mendukung closesAt.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { closeExpiredPositions, serializePosition } from "@/lib/seed";
import { POSITION_TYPES } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

/** Parse closesAt dari body: null | undefined | ISO string valid. */
function parseClosesAt(value: unknown): { ok: true; date: Date | null } | { ok: false } {
  if (value === undefined) return { ok: true, date: undefined as unknown as null }; // tidak dikirim
  if (value === null) return { ok: true, date: null };
  if (typeof value !== "string") return { ok: false };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { ok: false };
  return { ok: true, date: parsed };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    await closeExpiredPositions();

    const rows = await db.position.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(rows.map(serializePosition));
  } catch (error) {
    console.error("[GET /api/admin/positions]", error);
    return NextResponse.json({ error: "Gagal memuat daftar posisi. Coba lagi nanti." }, { status: 500 });
  }
}

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
      return NextResponse.json({ error: "Data posisi tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const title = typeof data.title === "string" ? data.title.trim() : "";
    const department = typeof data.department === "string" ? data.department.trim() : "";
    const description = typeof data.description === "string" ? data.description.trim() : "";
    const location =
      typeof data.location === "string" && data.location.trim() ? data.location.trim() : "Remote";

    let type = "Full-time";
    if (data.type !== undefined) {
      if (typeof data.type !== "string" || !(POSITION_TYPES as readonly string[]).includes(data.type.trim())) {
        return NextResponse.json({ error: "Jenis pekerjaan tidak valid." }, { status: 400 });
      }
      type = data.type.trim();
    }

    let requirements: string[] = [];
    if (data.requirements !== undefined) {
      if (!Array.isArray(data.requirements)) {
        return NextResponse.json({ error: "Requirements harus berupa array teks." }, { status: 400 });
      }
      requirements = data.requirements
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    let isActive = true;
    if (data.isActive !== undefined) {
      if (typeof data.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive harus berupa boolean." }, { status: 400 });
      }
      isActive = data.isActive;
    }

    let closesAt: Date | null = null;
    if (data.closesAt !== undefined && data.closesAt !== null) {
      const parsed = parseClosesAt(data.closesAt);
      if (!parsed.ok) {
        return NextResponse.json({ error: "Tanggal penutupan tidak valid." }, { status: 400 });
      }
      closesAt = parsed.date;
    }

    let order: number;
    if (data.order !== undefined) {
      if (typeof data.order !== "number" || !Number.isInteger(data.order)) {
        return NextResponse.json({ error: "Order harus berupa bilangan bulat." }, { status: 400 });
      }
      order = data.order;
    } else {
      const maxOrder = await db.position.aggregate({ _max: { order: true } });
      order = (maxOrder._max.order ?? 0) + 1;
    }

    if (title.length < 3) {
      return NextResponse.json({ error: "Judul posisi minimal 3 karakter." }, { status: 400 });
    }
    if (!department) {
      return NextResponse.json({ error: "Departemen wajib diisi." }, { status: 400 });
    }
    if (description.length < 10) {
      return NextResponse.json({ error: "Deskripsi minimal 10 karakter." }, { status: 400 });
    }

    const created = await db.position.create({
      data: {
        title,
        department,
        type,
        location,
        description,
        requirements: JSON.stringify(requirements),
        isActive,
        closesAt,
        order,
      },
    });

    return NextResponse.json(serializePosition(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/positions]", error);
    return NextResponse.json({ error: "Gagal membuat posisi. Coba lagi nanti." }, { status: 500 });
  }
}
