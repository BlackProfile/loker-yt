// POST /api/admin/positions/[id]/nurture — siapkan email "nurture" untuk kandidat ditolak (OWNER/HR).
// Kriteria: REJECTED pada posisi ini ATAU posisi satu departemen, bukan MENARIK_DIRI,
// ditolak lebih dari 60 hari lalu, maks 50 kandidat.
// ?preview=1 → hanya hitung jumlah tanpa efek samping (dipakai konfirmasi UI).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";
import { queueEmail } from "@/lib/notify";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan." };

const MAX_CANDIDATES = 50;
const NURTURE_SUBJECT = "Kabar baik dari Lumina Studio";

function nurtureBody(name: string, positionTitle: string, trackingCode: string | null): string {
  return [
    `Halo ${name},`,
    "",
    "Semoga kamu sehat selalu. Kami dari Lumina Studio ingin menyampaikan kabar baik: kami sedang membuka kembali kesempatan untuk bergabung bersama tim, dan kami masih mengingat minatmu pada posisi " +
      positionTitle +
      ".",
    "",
    "Kami sangat senang bila kamu mau melamar kembali — lamaranmu akan kami tinjau dengan prioritas. " +
      (trackingCode
        ? `Kode pelacakan lamaranmu yang lama adalah ${trackingCode}; simpan kode ini untuk memantau progres lamaran berikutnya. `
        : "") +
      "Kunjungi halaman karier kami dan kirimkan lamaran terbaru untuk posisi " +
      positionTitle +
      ".",
    "",
    "Terima kasih atas waktu dan minatmu untuk Lumina Studio. Sampai jumpa lagi!",
    "",
    "Hangat,",
    "Tim HR Lumina Studio",
  ].join("\n");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, { status: anySession ? 403 : 401 });
    }
    const { id } = await params;
    const isPreview = new URL(req.url).searchParams.get("preview") === "1";

    const position = await db.position.findUnique({ where: { id } });
    if (!position) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Lingkup kandidat: posisi ini ATAU semua posisi dalam departemen yang sama.
    const sameDeptPositions = await db.position.findMany({
      where: { department: position.department },
      select: { id: true },
    });

    const cutoff60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const candidates = await db.application.findMany({
      where: {
        status: "REJECTED",
        hiredAt: null,
        rejectionReason: { not: "MENARIK_DIRI" },
        rejectedAt: { lt: cutoff60d },
        email: { not: "" },
        positionId: { in: sameDeptPositions.map((p) => p.id) },
      },
      select: { id: true, name: true, email: true, trackingCode: true },
      orderBy: { rejectedAt: "asc" }, // paling lama ditolak duluan
      take: MAX_CANDIDATES,
    });

    if (isPreview) {
      return NextResponse.json({ count: candidates.length });
    }

    if (candidates.length === 0) {
      return NextResponse.json({ queued: 0 });
    }

    let queued = 0;
    for (const candidate of candidates) {
      try {
        await queueEmail({
          toEmail: candidate.email,
          subject: NURTURE_SUBJECT,
          body: nurtureBody(candidate.name, position.title, candidate.trackingCode),
          kind: "NURTURE",
          applicationId: candidate.id,
        });
        await db.activityLog.create({
          data: {
            applicationId: candidate.id,
            actor: session.name,
            action: "NURTURE_SENT",
            detail: `Email "${NURTURE_SUBJECT}" disiapkan (nurture posisi ${position.title})`,
          },
        });
        queued += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[nurture] gagal menyiapkan email untuk", candidate.email, message);
      }
    }

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ queued });
  } catch (error) {
    console.error("[POST /api/admin/positions/[id]/nurture]", error);
    return NextResponse.json({ error: "Gagal menyiapkan email nurture. Coba lagi nanti." }, { status: 500 });
  }
}
