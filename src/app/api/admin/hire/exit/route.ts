// POST /api/admin/hire/exit — offboarding: catat karyawan keluar menjadi alumni (OWNER/HR).
// Body: { applicationId, exitAt, exitReason, exitNote? }
//   -> set exit fields, isi checklist offboarding bawaan (5 item) bila masih kosong,
//      cabut kartu current (REVOKED), log EMPLOYMENT_ENDED, notifikasi, realtime.
//   Idempoten: bila exitAt sudah terisi -> 409 "Karyawan ini sudah tercatat alumni."
//   (Checklist offboarding disimpan lewat PATCH /api/admin/hire/[id] — sanitasi sama
//    dengan onboardingPlan.)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  applyExitOffboarding,
  employeeInclude,
  serializeEmployee,
} from "@/lib/employee-lifecycle";
import { EXIT_REASONS, type ExitReason } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Karyawan tidak ditemukan" };
const ALUMNI = { error: "Karyawan ini sudah tercatat alumni." };

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
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
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const applicationId = typeof data.applicationId === "string" ? data.applicationId.trim() : "";
    if (!applicationId) {
      return NextResponse.json({ error: "applicationId wajib dikirim." }, { status: 400 });
    }

    const employee = await db.application.findUnique({
      where: { id: applicationId },
      select: { id: true, name: true, hiredAt: true, exitAt: true, position: { select: { title: true } } },
    });
    if (!employee || !employee.hiredAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    // Idempoten — alumni tidak boleh keluar dua kali.
    if (employee.exitAt) {
      return NextResponse.json(ALUMNI, { status: 409 });
    }

    const exitAt = parseIsoDate(data.exitAt);
    if (!exitAt) {
      return NextResponse.json(
        { error: "Tanggal keluar wajib diisi dengan tanggal yang valid." },
        { status: 400 },
      );
    }
    const exitReason = data.exitReason as ExitReason;
    if (!EXIT_REASONS.includes(exitReason)) {
      return NextResponse.json({ error: "Pilih alasan keluar yang tersedia." }, { status: 400 });
    }
    let exitNote: string | null = null;
    if (data.exitNote !== undefined && data.exitNote !== null) {
      if (typeof data.exitNote !== "string") {
        return NextResponse.json({ error: "Catatan harus berupa teks." }, { status: 400 });
      }
      exitNote = data.exitNote.trim().slice(0, 2000) || null;
    }

    await applyExitOffboarding({
      applicationId,
      applicationName: employee.name,
      positionTitle: employee.position?.title ?? null,
      exitAt,
      exitReason,
      exitNote,
      actor: session.name,
    });

    const updated = await db.application.findUnique({
      where: { id: applicationId },
      include: employeeInclude,
    });
    if (!updated) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    return NextResponse.json(serializeEmployee(updated));
  } catch (error) {
    console.error("[POST /api/admin/hire/exit]", error);
    return NextResponse.json(
      { error: "Gagal mencatat keluar karyawan. Coba lagi nanti." },
      { status: 500 },
    );
  }
}

