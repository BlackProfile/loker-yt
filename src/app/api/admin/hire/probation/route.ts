// POST /api/admin/hire/probation — keputusan akhir masa percobaan (OWNER/HR).
// Body: { applicationId, decision: "PERMANENT"|"EXTEND"|"END", newProbationEnd?, reason? }
//   PERMANENT -> permanentAt = now + kartu current PROBATION -> ACTIVE (log PROBATION_PERMANENT).
//   EXTEND    -> probationEnd = newProbationEnd (wajib masa depan + alasan) (log PROBATION_EXTENDED).
//   END       -> offboarding: exit fields + checklist bawaan + cabut kartu (log EMPLOYMENT_ENDED).
// Response: DTO karyawan terbaru (pola GET /api/admin/hire).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { pushNotification } from "@/lib/notify";
import {
  applyExitOffboarding,
  employeeInclude,
  serializeEmployee,
} from "@/lib/employee-lifecycle";
import {
  EXIT_REASONS,
  PROBATION_DECISIONS,
  type ExitReason,
  type ProbationDecision,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Karyawan tidak ditemukan" };
const ALUMNI = { error: "Karyawan ini sudah tercatat alumni." };
const ALREADY_PERMANENT = { error: "Karyawan sudah diputuskan menjadi Karyawan Tetap." };

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
    const decision = data.decision as ProbationDecision;
    if (!PROBATION_DECISIONS.includes(decision)) {
      return NextResponse.json(
        { error: "Keputusan harus PERMANENT, EXTEND, atau END." },
        { status: 400 },
      );
    }

    const employee = await db.application.findUnique({
      where: { id: applicationId },
      select: { id: true, name: true, hiredAt: true, permanentAt: true, exitAt: true },
    });
    if (!employee || !employee.hiredAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (employee.exitAt) {
      return NextResponse.json(ALUMNI, { status: 409 });
    }
    if (decision !== "END" && employee.permanentAt) {
      return NextResponse.json(ALREADY_PERMANENT, { status: 409 });
    }

    if (decision === "PERMANENT") {
      const now = new Date();
      await db.application.update({
        where: { id: applicationId },
        data: { permanentAt: now },
      });

      // Kartu current berstatus PROBATION -> ACTIVE (lastVerifiedAt tidak diubah).
      const card = await db.employeeCard.findFirst({
        where: { applicationId, isCurrent: true, status: "PROBATION" },
        select: { id: true, cardNumber: true },
      });
      if (card) {
        await db.employeeCard.update({
          where: { id: card.id },
          data: { status: "ACTIVE" },
        });
        await db.activityLog.create({
          data: {
            applicationId,
            actor: session.name,
            action: "CARD_STATUS",
            detail: `Kartu ${card.cardNumber} aktif penuh — masa percobaan selesai`,
          },
        });
      }

      await db.activityLog.create({
        data: {
          applicationId,
          actor: session.name,
          action: "PROBATION_PERMANENT",
          detail: `Masa percobaan berakhir — ${employee.name} menjadi Karyawan Tetap`,
        },
      });
      await pushNotification({
        title: "Karyawan Tetap",
        body: `${employee.name} lulus masa percobaan dan kini Karyawan Tetap.`,
        category: "APPLICATION",
        applicationId,
      });
    } else if (decision === "EXTEND") {
      const newEnd = parseIsoDate(data.newProbationEnd);
      if (!newEnd || newEnd.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "Tanggal perpanjangan wajib diisi dan harus di masa depan." },
          { status: 400 },
        );
      }
      const reason = typeof data.reason === "string" ? data.reason.trim() : "";
      if (reason.length < 5) {
        return NextResponse.json(
          { error: "Alasan perpanjangan wajib diisi (minimal 5 karakter)." },
          { status: 400 },
        );
      }

      await db.application.update({
        where: { id: applicationId },
        data: { probationEnd: newEnd },
      });

      // Kartu PROBATION tetap PROBATION — perbarui batasnya agar upgrade malas
      // tidak menjadikan kartu AKTIF sebelum perpanjangan berakhir.
      const card = await db.employeeCard.findFirst({
        where: { applicationId, isCurrent: true, status: "PROBATION" },
        select: { id: true, cardNumber: true },
      });
      if (card) {
        await db.employeeCard.update({
          where: { id: card.id },
          data: { probationUntil: newEnd },
        });
        await db.activityLog.create({
          data: {
            applicationId,
            actor: session.name,
            action: "CARD_STATUS",
            detail: `Kartu ${card.cardNumber} tetap Masa Percobaan — probasi diperpanjang s.d. ${newEnd.toLocaleDateString("id-ID", { dateStyle: "long" })}`,
          },
        });
      }

      await db.activityLog.create({
        data: {
          applicationId,
          actor: session.name,
          action: "PROBATION_EXTENDED",
          detail: `Masa percobaan diperpanjang s.d. ${newEnd.toLocaleDateString("id-ID", { dateStyle: "long" })} — ${reason}`,
        },
      });
    } else {
      // END — keputusan mengakhiri kerja sama: jalankan offboarding yang sama dengan /exit.
      const exitAt = parseIsoDate(data.exitAt);
      if (!exitAt) {
        return NextResponse.json(
          { error: "Tanggal keluar wajib diisi dengan tanggal yang valid." },
          { status: 400 },
        );
      }
      const exitReason = data.exitReason as ExitReason;
      if (!EXIT_REASONS.includes(exitReason)) {
        return NextResponse.json({ error: "Alasan keluar tidak valid." }, { status: 400 });
      }
      const reason = typeof data.reason === "string" ? data.reason.trim() : "";
      if (reason.length < 5) {
        return NextResponse.json(
          { error: "Alasan pengakhiran wajib diisi (minimal 5 karakter)." },
          { status: 400 },
        );
      }

      const full = await db.application.findUnique({
        where: { id: applicationId },
        select: { name: true, position: { select: { title: true } } },
      });
      await applyExitOffboarding({
        applicationId,
        applicationName: full?.name ?? employee.name,
        positionTitle: full?.position?.title ?? null,
        exitAt,
        exitReason,
        exitNote: reason,
        actor: session.name,
      });
    }

    void emitRealtime(REALTIME_EVENTS.applications);

    const updated = await db.application.findUnique({
      where: { id: applicationId },
      include: employeeInclude,
    });
    if (!updated) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    return NextResponse.json(serializeEmployee(updated));
  } catch (error) {
    console.error("[POST /api/admin/hire/probation]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan keputusan masa percobaan. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
