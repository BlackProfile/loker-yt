// NR-41 H16 — Kotak keluar email versi admin (log pengiriman + retry manual).
// GET  /api/admin/emails?status=&page=&pageSize= → { items: EmailOutboxAdminRow[], total }
//      (urut createdAt desc; OWNER/HR).
// POST /api/admin/emails { id } → retry manual satu email berstatus FAILED/SKIPPED:
//      memanggil jalur kirim SMTP yang sama dengan queueEmail; attempts++ dan
//      status/sentAt/error/nextRetryAt diperbarui; kembalikan row terbaru.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import { EMAIL_RETRY_BACKOFF_MINUTES, EMAIL_MAX_ATTEMPTS, sendEmailViaSmtp } from "@/lib/notify";
import type { EmailOutboxAdminRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const VALID_STATUSES = ["QUEUED", "SENT", "FAILED", "SKIPPED"] as const;
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;

/** Susun row admin dari model EmailOutbox. */
function toRow(row: {
  id: string;
  toEmail: string;
  subject: string;
  kind: string;
  status: string;
  attempts: number;
  lastError: string | null;
  error: string | null;
  createdAt: Date;
  sentAt: Date | null;
  nextRetryAt: Date | null;
}): EmailOutboxAdminRow {
  return {
    id: row.id,
    toEmail: row.toEmail,
    subject: row.subject,
    kind: row.kind,
    status: (VALID_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as EmailOutboxAdminRow["status"])
      : "QUEUED",
    attempts: row.attempts,
    lastError: row.lastError,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt ? row.sentAt.toISOString() : null,
    nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status")?.trim() ?? "";
    const status = (VALID_STATUSES as readonly string[]).includes(statusParam)
      ? statusParam
      : undefined;

    const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "", 10) || 1);
    const pageSizeRaw = Number.parseInt(searchParams.get("pageSize") ?? "", 10) || PAGE_SIZE_DEFAULT;
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, pageSizeRaw));

    const where = status ? { status } : {};
    const [total, rows] = await Promise.all([
      db.emailOutbox.count({ where }),
      db.emailOutbox.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return NextResponse.json({ items: rows.map(toRow), total });
  } catch (error) {
    console.error("[GET /api/admin/emails]", error);
    return NextResponse.json({ error: "Gagal memuat log email. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
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
      return NextResponse.json({ error: "Email tidak ditemukan." }, { status: 404 });
    }
    // Retry manual hanya untuk email yang gagal/dilewati — email SENT tidak
    // dikirim ulang (hindari spam dobel ke pelamar).
    if (record.status !== "FAILED" && record.status !== "SKIPPED") {
      return NextResponse.json(
        { error: `Email berstatus ${record.status} tidak bisa dikirim ulang.` },
        { status: 409 },
      );
    }

    const result = await sendEmailViaSmtp({
      toEmail: record.toEmail,
      subject: record.subject,
      body: record.body,
    });

    if (!result.ok && result.error === "SMTP belum dikonfigurasi") {
      // Konsisten dengan /api/admin/outbox: tanpa SMTP email ditandai SKIPPED.
      const updated = await db.emailOutbox.update({
        where: { id },
        data: { status: "SKIPPED", attempts: { increment: 1 }, lastError: result.error },
      });
      return NextResponse.json({
        ok: true,
        status: "SKIPPED",
        message: "SMTP belum dikonfigurasi — email terarsip saja.",
        item: toRow(updated),
      });
    }

    if (result.ok) {
      const updated = await db.emailOutbox.update({
        where: { id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          attempts: { increment: 1 },
          error: null,
          lastError: null,
          nextRetryAt: null,
        },
      });
      await db.activityLog.create({
        data: {
          applicationId: record.applicationId,
          actor: session.name,
          action: "EMAIL_RETRY",
          detail: `Kirim ulang manual ke ${record.toEmail} — subjek "${record.subject}" BERHASIL`,
        },
      });
      return NextResponse.json({ ok: true, status: "SENT", item: toRow(updated) });
    }

    // Gagal kirim: attempts++, catat error + jadwal retry backoff berikutnya.
    const nextAttempts = record.attempts + 1;
    const backoffIndex = Math.min(nextAttempts - 1, EMAIL_RETRY_BACKOFF_MINUTES.length - 1);
    const isFinal = nextAttempts >= EMAIL_MAX_ATTEMPTS;
    const updated = await db.emailOutbox.update({
      where: { id },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
        lastError: result.error ?? "Gagal mengirim email",
        error: result.error ?? "Gagal mengirim email",
        nextRetryAt: isFinal ? null : new Date(Date.now() + EMAIL_RETRY_BACKOFF_MINUTES[backoffIndex] * 60 * 1000),
      },
    });
    await db.activityLog.create({
      data: {
        applicationId: record.applicationId,
        actor: session.name,
        action: "EMAIL_RETRY",
        detail: `Kirim ulang manual ke ${record.toEmail} GAGAL — penyebab: ${(result.error ?? "?").slice(0, 150)}`,
      },
    });
    return NextResponse.json({
      ok: false,
      status: "FAILED",
      message: `Gagal mengirim email: ${(result.error ?? "").slice(0, 200)}`,
      item: toRow(updated),
    });
  } catch (error) {
    console.error("[POST /api/admin/emails]", error);
    return NextResponse.json({ error: "Gagal mengirim ulang email. Coba lagi nanti." }, { status: 500 });
  }
}
