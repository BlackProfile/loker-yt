// POST /api/public/question — pelamar mengajukan pertanyaan dari halaman Cek
// Status (NR-15, idea 10). Body: { code, email, text }.
// Aturan:
// - Pasangan email + kode wajib cocok (sama seperti track/withdraw).
// - Teks pertanyaan wajib, maks 500 karakter.
// - Throttle per IP via status-gate (anti-spam) + lockout gagal cocok.
// Efek samping: ApplicationQuestion dibuat (askedBy = nama pelamar), ActivityLog
// QUESTION_ASKED, dan notifikasi in-app untuk admin.
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

const QUESTION_MAX_LENGTH = 500;

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);

    if (isLockedOut(ip)) {
      return NextResponse.json(
        { ok: false, lockedForSec: lockRemainingSec(ip) },
        { status: 429 },
      );
    }
    if (isThrottled(`question:${ip}`, 2000)) {
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
    const rawText =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).text
        : undefined;

    if (typeof rawEmail !== "string" || !/\S+@\S+\.\S+/.test(rawEmail.trim())) {
      return NextResponse.json({ ok: false, error: "Email tidak valid." }, { status: 400 });
    }
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json({ ok: false, error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    if (typeof rawText !== "string" || !rawText.trim()) {
      return NextResponse.json({ ok: false, error: "Tulis pertanyaanmu dulu, ya." }, { status: 400 });
    }
    const text = rawText.trim().slice(0, QUESTION_MAX_LENGTH);

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: { id: true, name: true, email: true, deletedAt: true },
    });

    // Respons gagal identik dengan endpoint pelacakan lain (tanpa kebocoran info).
    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== email) {
      recordAuthFail(ip);
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    clearAuthFails(ip);

    await db.applicationQuestion.create({
      data: {
        applicationId: application.id,
        question: text,
        askedBy: application.name || "Pelamar",
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "QUESTION_ASKED",
        detail: `Pertanyaan pelamar: ${text.slice(0, 80)}`,
      },
    });

    await db.notificationItem.create({
      data: {
        title: `Pertanyaan pelamar — ${application.name}`,
        body: text.slice(0, 200),
        category: "APPLICATION",
        applicationId: application.id,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/public/question]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal mengirim pertanyaan. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
