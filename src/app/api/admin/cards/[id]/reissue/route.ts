// POST /api/admin/cards/[id]/reissue — terbitkan ulang kartu (nama/posisi berubah, kartu hilang).
// Kartu lama: isCurrent=false + REVOKED (QR lama otomatis "TIDAK BERLAKU").
// Kartu baru: nomor berikutnya, token baru; checklist identitas disalin —
// kartu lama yang sudah terverifikasi langsung aktif lagi tanpa gate ulang.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { activationStatusOf, nextCardNumberFor, randomCardToken, serializeCard } from "@/lib/employee-cards";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Pengamat hanya dapat melihat." };
const NOT_FOUND = { error: "Kartu tidak ditemukan." };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role === "VIEWER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const { id } = await params;
    const card = await db.employeeCard.findUnique({
      where: { id },
      include: {
        application: {
          select: {
            name: true,
            nik: true,
            hiredAt: true,
            trackingCode: true,
            probationEnd: true,
            position: { select: { title: true } },
          },
        },
      },
    });
    if (!card || !card.isCurrent) return NextResponse.json(NOT_FOUND, { status: 404 });
    const owner = {
      name: card.application.name,
      positionTitle: card.application.position?.title ?? null,
      hiredAt: card.application.hiredAt,
      nik: card.application.nik,
      trackingCode: card.application.trackingCode,
    };

    const now = new Date();
    const checks = card.identityChecks;
    const carried =
      card.status === "ACTIVE" || card.status === "PROBATION" || card.status === "LEAVE";
    const probationEnd = card.application.probationEnd ?? card.probationUntil;

    const [oldUpdated, created] = await db.$transaction([
      db.employeeCard.update({
        where: { id: card.id },
        data: {
          isCurrent: false,
          status: "REVOKED",
          revokedAt: now,
          revokedReason: `Diterbitkan ulang menjadi kartu baru oleh ${session.name}`,
        },
      }),
      db.employeeCard.create({
        data: {
          applicationId: card.applicationId,
          cardNumber: await nextCardNumberFor(),
          token: randomCardToken(),
          status: carried ? activationStatusOf(probationEnd) : "PENDING",
          identityChecks: checks,
          probationUntil: probationEnd,
        },
      }),
    ]);

    await db.activityLog.create({
      data: {
        applicationId: card.applicationId,
        actor: session.name,
        action: "CARD_REISSUED",
        detail: `Kartu ${oldUpdated.cardNumber} diterbitkan ulang menjadi ${created.cardNumber} — QR lama otomatis tidak berlaku`,
      },
    });
    void emitRealtime(REALTIME_EVENTS.applications);

    return NextResponse.json(serializeCard(created, owner));
  } catch (error) {
    console.error("[POST /api/admin/cards/[id]/reissue]", error);
    return NextResponse.json({ error: "Gagal menerbitkan ulang kartu. Coba lagi nanti." }, { status: 500 });
  }
}
