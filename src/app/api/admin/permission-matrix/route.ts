// GET /api/admin/permission-matrix — matriks izin per role (semua role admin; transparansi).
// PUT /api/admin/permission-matrix — simpan penyempitan matriks (OWNER saja).
//      Body: { overrides: { [actionKey]: Role[] } } — hanya aksi yang DIUBAH.
//      Matriks tidak pernah memperluas akses; OWNER selalu dipertahankan.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { getPermissionMatrix, writePermissionOverrides } from "@/lib/permissions";
import type { PermissionActionKey, Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER dapat mengubah matriks izin." };

const VALID_KEYS: PermissionActionKey[] = [
  "kelola_posisi",
  "kelola_lamaran",
  "kirim_email",
  "ekspor_data",
  "lihat_laporan",
  "kelola_pengguna",
  "pengaturan_sistem",
  "kesehatan_server",
];

function isRole(v: unknown): v is Role {
  return v === "OWNER" || v === "HR" || v === "VIEWER";
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    const matrix = await getPermissionMatrix();
    return NextResponse.json(matrix);
  } catch (error) {
    console.error("[GET /api/admin/permission-matrix]", error);
    return NextResponse.json({ error: "Gagal memuat matriks izin." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const body: unknown = await req.json().catch(() => null);
    const data =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const raw = data.overrides;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ error: "Kirim { overrides: { aksi: [role] } }." }, { status: 400 });
    }

    const overrides: Partial<Record<PermissionActionKey, Role[]>> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!VALID_KEYS.includes(key as PermissionActionKey)) continue;
      if (!Array.isArray(value)) continue;
      const roles = value.filter(isRole);
      overrides[key as PermissionActionKey] = roles;
    }

    const matrix = await writePermissionOverrides(overrides);
    await db.activityLog
      .create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "PERMISSION_MATRIX_UPDATED",
          detail: `Matriks izin diperbarui (${Object.keys(overrides).length} aksi disesuaikan)`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, matrix });
  } catch (error) {
    console.error("[PUT /api/admin/permission-matrix]", error);
    return NextResponse.json({ error: "Gagal menyimpan matriks izin." }, { status: 500 });
  }
}
