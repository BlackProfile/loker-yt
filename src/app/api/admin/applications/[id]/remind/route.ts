// POST /api/admin/applications/[id]/remind — kirim email pengingat ke pelamar yang
// belum menjawab penawaran (NR-15, idea 6). Role OWNER/HR.
// Aturan:
// - Hanya bila offerStatus = "PENDING" (selain itu 409/400).
// - Dedupe: maks SATU email pengingat per offer — penanda disimpan di Setting
//   "site".offerRemindSent = { applicationId: ISO waktu kirim }.
// - Email masuk EmailOutbox kind REMINDER (terkirim otomatis bila SMTP aktif).
// - ActivityLog OFFER_REMIND dengan aktor nama admin.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { queueEmail } from "@/lib/notify";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

/** Baca objek Setting "site" secara aman (read-modify-write sederhana). */
async function readSiteObj(): Promise<Record<string, unknown>> {
  const row = await db.setting.findUnique({ where: { key: "site" } });
  try {
    const parsed: unknown = row ? JSON.parse(row.value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {};
  } catch {
    return {};
  }
}

async function writeSiteObj(obj: Record<string, unknown>): Promise<void> {
  await db.setting.upsert({
    where: { key: "site" },
    update: { value: JSON.stringify(obj) },
    create: { key: "site", value: JSON.stringify(obj) },
  });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        offerStatus: true,
        offerDeadline: true,
        offerType: true,
        position: { select: { title: true } },
      },
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (application.offerStatus !== "PENDING") {
      return NextResponse.json(
        { error: "Pengingat hanya untuk penawaran yang masih menunggu jawaban." },
        { status: 409 },
      );
    }

    // Dedupe: satu email pengingat per offer (penanda di Setting "site").
    const site = await readSiteObj();
    const sentMap =
      site.offerRemindSent && typeof site.offerRemindSent === "object" && !Array.isArray(site.offerRemindSent)
        ? { ...(site.offerRemindSent as Record<string, string>) }
        : {};
    if (sentMap[application.id]) {
      return NextResponse.json(
        { ok: true, alreadySent: true, message: "Email pengingat untuk offer ini sudah pernah dikirim." },
      );
    }

    const positionTitle = application.position?.title ?? "posisi";
    const deadlineLabel = application.offerDeadline
      ? application.offerDeadline.toLocaleDateString("id-ID", { dateStyle: "long" })
      : "secepatnya";

    await queueEmail({
      toEmail: application.email,
      subject: "Pengingat: Menunggu Jawaban Penawaran",
      body: [
        `Halo ${application.name},`,
        "",
        `Kami ingin mengingatkan bahwa penawaran untuk posisi ${positionTitle}${application.offerType ? ` (${application.offerType})` : ""} di Lumina Studio masih menunggu jawabanmu.`,
        `Mohon jawab paling lambat ${deadlineLabel} melalui halaman status lamaran dengan kode pelacakanmu.`,
        "",
        "Bila ada pertanyaan atau butuh waktu lebih, jangan ragu menghubungi kami.",
        "",
        "Salam hangat,",
        "Tim Lumina Studio",
      ].join("\n"),
      kind: "REMINDER",
      applicationId: application.id,
    });

    // Tandai terkirim (dedupe) — cap 500 entri agar blob tidak membesar tanpa batas.
    const nowIso = new Date().toISOString();
    const entries = Object.entries(sentMap);
    if (entries.length >= 500) {
      entries.sort((a, b) => (a[1] < b[1] ? -1 : 1));
      for (const [oldId] of entries.slice(0, entries.length - 499)) {
        delete sentMap[oldId];
      }
    }
    sentMap[application.id] = nowIso;
    site.offerRemindSent = sentMap;
    await writeSiteObj(site);

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: session.name,
        action: "OFFER_REMIND",
        detail: `Email pengingat penawaran dikirim ke ${application.email} — batas jawaban ${deadlineLabel}`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/remind]", error);
    return NextResponse.json(
      { error: "Gagal mengirim pengingat. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
