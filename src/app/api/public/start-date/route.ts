// POST /api/public/start-date — pelamar menindaklanjuti tanggal mulai kerja dari
// halaman Cek Status (NR-15, idea 13). Body: { code, email, action, date?, note? }.
// Aturan:
// - Pasangan email + kode wajib cocok; hanya lamaran yang SUDAH diterima
//   (hiredAt terisi) yang boleh menindaklanjuti.
// - action "confirm"  -> startConfirmedAt = now (setuju tanggal mulai dari offer).
// - action "propose"  -> startProposedAt = date (ISO wajib), startProposedNote
//   (maks 300 char) + ActivityLog START_DATE_PROPOSED + notifikasi admin.
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

const NOTE_MAX_LENGTH = 300;

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);

    if (isLockedOut(ip)) {
      return NextResponse.json(
        { ok: false, lockedForSec: lockRemainingSec(ip) },
        { status: 429 },
      );
    }
    if (isThrottled(`start-date:${ip}`, 1500)) {
      return NextResponse.json(
        { ok: false, error: "Terlalu cepat. Tunggu beberapa saat lagi." },
        { status: 429 },
      );
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
    const rawAction =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).action
        : undefined;
    const rawDate =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).date
        : undefined;
    const rawNote =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).note
        : undefined;

    if (typeof rawEmail !== "string" || !/\S+@\S+\.\S+/.test(rawEmail.trim())) {
      return NextResponse.json({ ok: false, error: "Email tidak valid." }, { status: 400 });
    }
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json({ ok: false, error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    const action = typeof rawAction === "string" ? rawAction.trim() : "";
    if (!["confirm", "propose"].includes(action)) {
      return NextResponse.json({ ok: false, error: "Aksi tidak valid." }, { status: 400 });
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: {
        id: true,
        name: true,
        email: true,
        deletedAt: true,
        hiredAt: true,
        offerStartDate: true,
      },
    });

    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== email) {
      recordAuthFail(ip);
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    clearAuthFails(ip);

    if (!application.hiredAt) {
      return NextResponse.json(
        { ok: false, error: "Konfirmasi tanggal mulai hanya tersedia setelah lamaran diterima." },
        { status: 409 },
      );
    }

    if (action === "confirm") {
      await db.application.update({
        where: { id: application.id },
        data: { startConfirmedAt: new Date() },
      });
      return NextResponse.json({ ok: true });
    }

    // action === "propose"
    const dateStr = typeof rawDate === "string" ? rawDate.trim() : "";
    const parsedDate = dateStr ? new Date(dateStr) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { ok: false, error: "Pilih tanggal mulai yang valid." },
        { status: 400 },
      );
    }
    const note =
      typeof rawNote === "string" && rawNote.trim() ? rawNote.trim().slice(0, NOTE_MAX_LENGTH) : null;

    await db.application.update({
      where: { id: application.id },
      data: {
        startProposedAt: parsedDate,
        startProposedNote: note,
        // Usulan baru membatalkan konfirmasi lama (klien menampilkan status usulan).
        startConfirmedAt: null,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "START_DATE_PROPOSED",
        detail: `${application.name} mengusulkan tanggal mulai ${parsedDate.toLocaleDateString("id-ID", { dateStyle: "long" })}${note ? ` — catatan: ${note}` : ""}`,
      },
    });

    await db.notificationItem.create({
      data: {
        title: "Usulan tanggal mulai dari pelamar",
        body: `${application.name} mengusulkan mulai kerja pada ${parsedDate.toLocaleDateString("id-ID", { dateStyle: "long" })}${note ? `. Catatan: ${note}` : "."}`,
        category: "OFFER",
        applicationId: application.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/start-date]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal memproses tanggal mulai. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
