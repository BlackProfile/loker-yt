// POST /api/public/withdraw — pelamar menarik lamarannya sendiri dari halaman
// Cek Status (self-service). Body: { email, code, reason? }.
// Aturan:
// - Pasangan email + kode pelacakan harus cocok (sama seperti track/track-auth).
// - Hanya lamaran yang BELUM final (bukan ACCEPTED/REJECTED) yang bisa ditarik.
// - Status menjadi REJECTED dengan alasan MENARIK_DIRI + rejectedAt terisi;
//   activity log (aktor "Pelamar") + notifikasi admin dibuat.
// Keamanan: throttle per IP + lockout bersama endpoint pelacakan lain.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clearAuthFails,
  clientIp,
  isLockedOut,
  isThrottled,
  lockRemainingSec,
  recordAuthFail,
} from "@/lib/status-gate";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);

    if (isLockedOut(ip)) {
      return NextResponse.json(
        { ok: false, lockedForSec: lockRemainingSec(ip) },
        { status: 429 },
      );
    }
    if (isThrottled(`withdraw:${ip}`, 800)) {
      return NextResponse.json({ ok: false, error: "Terlalu cepat." }, { status: 429 });
    }

    const body: unknown = await req.json().catch(() => null);
    const rawEmail =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).email
        : undefined;
    const rawCode =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).code
        : undefined;
    const rawReason =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).reason
        : undefined;

    if (typeof rawEmail !== "string" || !/\S+@\S+\.\S+/.test(rawEmail.trim())) {
      return NextResponse.json({ ok: false, error: "Email tidak valid." }, { status: 400 });
    }
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json({ ok: false, error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();
    const reason =
      typeof rawReason === "string" ? rawReason.trim().slice(0, 500) : "";

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        deletedAt: true,
        position: { select: { title: true } },
      },
    });

    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== email) {
      recordAuthFail(ip);
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    clearAuthFails(ip);

    const status = application.status.trim() || "NEW";
    if (status === "ACCEPTED" || status === "REJECTED") {
      return NextResponse.json(
        { ok: false, error: "Lamaran ini sudah selesai diproses dan tidak bisa ditarik." },
        { status: 409 },
      );
    }

    const now = new Date();
    const positionTitle = application.position?.title ?? "posisi ini";

    await db.application.update({
      where: { id: application.id },
      data: {
        status: "REJECTED",
        rejectionReason: "MENARIK_DIRI",
        rejectedAt: now,
        stageUpdatedAt: now,
        // Sisa offer PENDING (bila ada) dibatalkan senyap agar tidak tampil lagi.
        offerStatus: null,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "WITHDRAW",
        detail: `${application.name} menarik lamaran untuk "${positionTitle}" (${code}).${
          reason ? ` Alasan: ${reason}` : ""
        }`,
      },
    });

    await db.notificationItem.create({
      data: {
        title: "Lamaran ditarik pelamar",
        body: `${application.name} menarik lamaran untuk ${positionTitle} (${code}).${
          reason ? ` Alasan: ${reason}` : ""
        }`,
        category: "APPLICATION",
        applicationId: application.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/withdraw]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal menarik lamaran. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
