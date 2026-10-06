// PATCH /api/admin/cards/[id] — aksi kartu: checklist verifikasi identitas + perubahan status.
// Aksi: activate | suspend | reactivate | leave | back-from-leave | revoke.
// VIEWER tidak boleh mutasi (403). Setiap perubahan dicatat ke ActivityLog + realtime.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { activationStatusOf, serializeCard } from "@/lib/employee-cards";
import { IDENTITY_CHECK_ITEMS, type IdentityChecks } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Pengamat hanya dapat melihat." };
const NOT_FOUND = { error: "Kartu tidak ditemukan." };

function parseChecks(raw: string): IdentityChecks {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return { docs: obj.docs === true, nikMatch: obj.nikMatch === true, contract: obj.contract === true };
  } catch {
    return { docs: false, nikMatch: false, contract: false };
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const body = (await req.json().catch(() => ({}))) as {
      identityChecks?: Partial<IdentityChecks>;
      action?: string;
      reason?: string;
    };

    let data: Record<string, unknown> = {};
    const logs: { actor: string; action: string; detail: string }[] = [];

    // 1) Update checklist verifikasi identitas
    if (body.identityChecks && typeof body.identityChecks === "object") {
      const current = parseChecks(card.identityChecks);
      const next: IdentityChecks = { ...current };
      for (const item of IDENTITY_CHECK_ITEMS) {
        const v = body.identityChecks[item.key];
        if (typeof v === "boolean") next[item.key] = v;
      }
      data.identityChecks = JSON.stringify(next);
      const done = IDENTITY_CHECK_ITEMS.filter((i) => next[i.key]).length;
      logs.push({
        actor: session.name,
        action: "CARD_CHECK",
        detail: `Checklist verifikasi identitas: ${done}/3 lengkap`,
      });
    }

    // 2) Aksi status
    if (body.action) {
      const checks = parseChecks((data.identityChecks as string) ?? card.identityChecks);
      const allChecked = checks.docs && checks.nikMatch && checks.contract;
      const probationEnd = card.application.probationEnd ?? card.probationUntil;
      const activeStatus = activationStatusOf(probationEnd);
      const activeLike = ["ACTIVE", "PROBATION"].includes(card.status);

      switch (body.action) {
        case "activate": {
          if (card.status === "REVOKED") {
            return NextResponse.json(
              { error: "Kartu sudah dicabut. Gunakan Terbitkan Ulang untuk kartu baru." },
              { status: 400 }
            );
          }
          if (!allChecked) {
            return NextResponse.json(
              { error: "Lengkapi 3 pemeriksaan identitas sebelum mengaktifkan kartu." },
              { status: 400 }
            );
          }
          if (card.status === activeStatus) break; // sudah aktif
          data.status = activeStatus;
          data.revokedAt = null;
          data.revokedReason = null;
          logs.push({
            actor: session.name,
            action: "CARD_STATUS",
            detail: `Kartu ${card.cardNumber} AKTIF${activeStatus === "PROBATION" ? " (masa percobaan)" : ""} — verifikasi identitas lengkap`,
          });
          break;
        }
        case "suspend": {
          if (!activeLike && card.status !== "LEAVE") {
            return NextResponse.json({ error: "Hanya kartu aktif/cuti yang bisa dinonaktifkan." }, { status: 400 });
          }
          data.status = "SUSPENDED";
          logs.push({
            actor: session.name,
            action: "CARD_STATUS",
            detail: `Kartu ${card.cardNumber} dinonaktifkan — verifikasi publik menampilkan TIDAK BERLAKU`,
          });
          break;
        }
        case "reactivate": {
          if (card.status !== "SUSPENDED") {
            return NextResponse.json({ error: "Hanya kartu dinonaktifkan yang bisa diaktifkan kembali." }, { status: 400 });
          }
          if (!allChecked) {
            return NextResponse.json({ error: "Checklist verifikasi identitas belum lengkap." }, { status: 400 });
          }
          data.status = activeStatus;
          data.revokedAt = null;
          data.revokedReason = null;
          logs.push({
            actor: session.name,
            action: "CARD_STATUS",
            detail: `Kartu ${card.cardNumber} diaktifkan kembali`,
          });
          break;
        }
        case "leave": {
          if (!activeLike) {
            return NextResponse.json({ error: "Hanya kartu aktif yang bisa ditandai cuti." }, { status: 400 });
          }
          data.status = "LEAVE";
          logs.push({ actor: session.name, action: "CARD_STATUS", detail: `Kartu ${card.cardNumber} ditandai CUTI` });
          break;
        }
        case "back-from-leave": {
          if (card.status !== "LEAVE") {
            return NextResponse.json({ error: "Kartu tidak sedang cuti." }, { status: 400 });
          }
          data.status = activeStatus;
          logs.push({ actor: session.name, action: "CARD_STATUS", detail: `Kartu ${card.cardNumber} kembali dari cuti` });
          break;
        }
        case "revoke": {
          if (card.status === "REVOKED") break;
          data.status = "REVOKED";
          data.revokedAt = new Date();
          data.revokedReason = (body.reason ?? "").trim().slice(0, 200) || "Dicabut oleh admin";
          logs.push({
            actor: session.name,
            action: "CARD_STATUS",
            detail: `Kartu ${card.cardNumber} dicabut — ${data.revokedReason}`,
          });
          break;
        }
        default:
          return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const updated = await db.employeeCard.update({
      where: { id: card.id },
      data,
    });

    if (logs.length > 0) {
      await db.activityLog.createMany({
        data: logs.map((log) => ({ ...log, applicationId: card.applicationId })),
      });
    }
    void emitRealtime(REALTIME_EVENTS.applications);

    return NextResponse.json(serializeCard(updated, owner));
  } catch (error) {
    console.error("[PATCH /api/admin/cards/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui kartu. Coba lagi nanti." }, { status: 500 });
  }
}
