// POST /api/admin/applications/[id]/email — kirim email manual ke pelamar dari
// dialog detail lamaran (OWNER/HR). Email terarsip di EmailOutbox (terkirim
// bila SMTP terkonfigurasi) + dicatat ke ActivityLog.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { can } from "@/lib/permissions";
import { queueEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    // NR46 — matriks izin: kirim email kandidat.
    if (!(await can(session.role, "kirim_email"))) {
      return NextResponse.json(
        { error: "Aksi ini tidak diizinkan untuk role Anda — lihat Matriks Izin di Pengaturan." },
        { status: 403 },
      );
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const subject = typeof data.subject === "string" ? data.subject.trim() : "";
    const content = typeof data.body === "string" ? data.body.trim() : "";
    if (!subject || subject.length > 200) {
      return NextResponse.json({ error: "Subjek wajib diisi (maks 200 karakter)." }, { status: 400 });
    }
    if (!content || content.length > 5000) {
      return NextResponse.json({ error: "Isi email wajib diisi (maks 5000 karakter)." }, { status: 400 });
    }

    const application = await db.application.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, trackingCode: true, deletedAt: true },
    });
    if (!application || application.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (!application.email || !application.email.includes("@")) {
      return NextResponse.json(
        { error: "Lamaran ini tidak memiliki alamat email yang valid." },
        { status: 400 },
      );
    }

    await queueEmail({
      toEmail: application.email,
      subject,
      body: content,
      kind: "SYSTEM",
      applicationId: application.id,
    });

    try {
      await db.activityLog.create({
        data: {
          applicationId: application.id,
          actor: session.name,
          action: "EMAIL",
          detail: `Email manual dikirim ke ${application.email}: ${subject}`,
        },
      });
    } catch {
      // logging tidak boleh menggagalkan alur utama
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/email]", error);
    return NextResponse.json({ error: "Gagal mengirim email. Coba lagi nanti." }, { status: 500 });
  }
}
