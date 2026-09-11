// GET /api/admin/positions — daftar SEMUA posisi (termasuk nonaktif), khusus admin.
// POST /api/admin/positions — buat posisi baru.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/server-auth";
import { serializePosition } from "@/lib/seed";
import { POSITION_TYPES } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };

export async function GET() {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

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
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
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

    let type = "Remote";
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
        order,
      },
    });

    return NextResponse.json(serializePosition(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/positions]", error);
    return NextResponse.json({ error: "Gagal membuat posisi. Coba lagi nanti." }, { status: 500 });
  }
}
