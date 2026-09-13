// GET   /api/admin/outbox — 100 email kotak keluar terbaru + info smtpConfigured (semua role).
// PATCH /api/admin/outbox — kirim ulang email berstatus QUEUED/FAILED (OWNER/HR): { id }.
//   Bila SMTP tidak diset (env SMTP_HOST dkk kosong), email ditandai SKIPPED.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Email tidak ditemukan." };

const SMTP_NOT_SET_MESSAGE = "SMTP belum dikonfigurasi — email terarsip saja.";

/** Konfigurasi transport SMTP dari env (sama dengan queueEmail di src/lib/notify.ts). */
function smtpFromEnv() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? "lumina@localhost",
  };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.emailOutbox.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      include: { application: { select: { name: true } } },
    });

    return NextResponse.json({
      smtpConfigured: Boolean(process.env.SMTP_HOST),
      emails: rows.map((row) => ({
        id: row.id,
        toEmail: row.toEmail,
        subject: row.subject,
        kind: row.kind,
        status: row.status,
        error: row.error,
        applicationId: row.applicationId,
        applicationName: row.application?.name ?? null,
        createdAt: row.createdAt.toISOString(),
        sentAt: row.sentAt ? row.sentAt.toISOString() : null,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/outbox]", error);
    return NextResponse.json(
      { error: "Gagal memuat kotak keluar email. Coba lagi nanti." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const id =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).id
        : undefined;
    if (typeof id !== "string" || id.trim().length === 0) {
      return NextResponse.json({ error: "Kirim { id } email yang mau dikirim ulang." }, { status: 400 });
    }

    const record = await db.emailOutbox.findUnique({ where: { id } });
    if (!record) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const smtp = smtpFromEnv();
    if (!smtp) {
      // Tanpa SMTP: tandai SKIPPED supaya jelas email hanya terarsip, bukan hilang.
      await db.emailOutbox.update({
        where: { id },
        data: { status: "SKIPPED", error: null },
      });
      return NextResponse.json({ ok: true, status: "SKIPPED", message: SMTP_NOT_SET_MESSAGE });
    }

    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        auth: smtp.auth,
      });
      await transport.sendMail({
        from: smtp.from,
        to: record.toEmail,
        subject: record.subject,
        text: record.body,
      });
      await db.emailOutbox.update({
        where: { id },
        data: { status: "SENT", sentAt: new Date(), error: null },
      });
      return NextResponse.json({ ok: true, status: "SENT" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.emailOutbox.update({
        where: { id },
        data: { status: "FAILED", error: message.slice(0, 300) },
      });
      return NextResponse.json({
        ok: false,
        status: "FAILED",
        message: `Gagal mengirim email: ${message.slice(0, 200)}`,
      });
    }
  } catch (error) {
    console.error("[PATCH /api/admin/outbox]", error);
    return NextResponse.json(
      { error: "Gagal mengirim ulang email. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
