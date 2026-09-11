// POST /api/public/offer/respond — pelamar menjawab penawaran dari halaman status:
//   ACCEPT  -> offerStatus ACCEPTED, status ACCEPTED, hiredAt + probationEnd diisi, welcome message
//   DECLINE -> offerStatus DECLINED (+ alasan)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { APPLICATION_INCLUDE, serializeApplication } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { sendSystemEvent } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Rate limit sederhana per kode
const rateMap = new Map<string, number>();
const RATE_MS = 1000;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
    const action = typeof data.action === "string" ? data.action.trim() : "";
    if (!code) {
      return NextResponse.json({ error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    if (!["ACCEPT", "DECLINE"].includes(action)) {
      return NextResponse.json({ error: "Aksi tidak valid." }, { status: 400 });
    }

    const now = Date.now();
    const last = rateMap.get(code) ?? 0;
    if (now - last < RATE_MS) {
      return NextResponse.json({ error: "Terlalu sering. Coba beberapa detik lagi." }, { status: 429 });
    }
    rateMap.set(code, now);

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      include: {
        ...APPLICATION_INCLUDE,
        position: {
          select: {
            title: true,
            welcomeTemplate: true,
            probationMonths: true,
            onboardingDocs: true,
          },
        },
      },
    });
    if (!application) {
      return NextResponse.json({ error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
    }
    if (application.offerStatus !== "PENDING") {
      return NextResponse.json(
        { error: "Penawaran tidak sedang menunggu jawabanmu." },
        { status: 400 },
      );
    }
    if (application.offerDeadline && application.offerDeadline.getTime() < Date.now()) {
      await db.application.update({ where: { id: application.id }, data: { offerStatus: "EXPIRED" } });
      void emitRealtime(REALTIME_EVENTS.applications);
      return NextResponse.json({ error: "Batas waktu jawaban penawaran sudah terlewat." }, { status: 400 });
    }

    if (action === "DECLINE") {
      const reason =
        typeof data.reason === "string" && data.reason.trim()
          ? data.reason.trim().slice(0, 500)
          : null;
      const updated = await db.application.update({
        where: { id: application.id },
        data: {
          offerStatus: "DECLINED",
          offerRespondedAt: new Date(),
          offerDeclineReason: reason,
        },
        include: APPLICATION_INCLUDE,
      });
      await db.activityLog.create({
        data: {
          applicationId: application.id,
          actor: "Pelamar",
          action: "OFFER_DECLINED",
          detail: `Pelamar menolak penawaran${reason ? ` — alasan: ${reason}` : ""}`,
        },
      });
      void sendSystemEvent({
        title: "Offer Ditolak Pelamar",
        detail: `${application.name} menolak penawaran posisi ${application.position?.title ?? "-"}${reason ? ` — alasan: ${reason}` : ""}. Pertimbangkan kandidat cadangan.`,
        applicationId: application.id,
        action: "OFFER_DECLINED",
      });
      void emitRealtime(REALTIME_EVENTS.applications);
      return NextResponse.json({ ok: true, application: serializeApplication(updated) });
    }

    // ACCEPT
    const nowDate = new Date();
    const startDate = application.offerStartDate ?? nowDate;
    const months = application.position?.probationMonths ?? 3;
    const probationEnd =
      months > 0 ? new Date(startDate.getTime() + months * 30 * 24 * 60 * 60 * 1000) : null;

    // Init dokumen onboarding dari template posisi bila belum ada (label -> doc, urut doc1..docN)
    let onboardingDocsJson = application.onboardingDocs;
    if (!onboardingDocsJson || onboardingDocsJson === "[]") {
      let labels: string[] = [];
      try {
        const parsed: unknown = JSON.parse(application.position?.onboardingDocs ?? "[]");
        if (Array.isArray(parsed)) {
          labels = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
        }
      } catch {
        labels = [];
      }
      onboardingDocsJson = JSON.stringify(
        labels.slice(0, 10).map((label, i) => ({
          id: `doc${i + 1}`,
          label,
          required: false,
          done: false,
          fileId: null,
        })),
      );
    }

    const updated = await db.application.update({
      where: { id: application.id },
      data: {
        offerStatus: "ACCEPTED",
        offerRespondedAt: nowDate,
        status: "ACCEPTED",
        hiredAt: nowDate,
        probationEnd,
        onboardingDocs: onboardingDocsJson,
      },
      include: APPLICATION_INCLUDE,
    });

    await db.activityLog.createMany({
      data: [
        {
          applicationId: application.id,
          actor: "Pelamar",
          action: "OFFER_ACCEPTED",
          detail: "Pelamar MENERIMA penawaran — selamat bergabung!",
        },
        {
          applicationId: application.id,
          actor: "Sistem",
          action: "STATUS_CHANGE",
          detail: "Diterima (Hired) — onboarding dimulai",
        },
      ],
    });

    void sendSystemEvent({
      title: "Offer Diterima",
      detail: `${application.name} MENERIMA penawaran posisi ${application.position?.title ?? "-"}! Mulai onboarding${probationEnd ? ` — masa percobaan s.d. ${probationEnd.toLocaleDateString("id-ID", { dateStyle: "long" })}` : ""}.`,
      applicationId: application.id,
      action: "OFFER_ACCEPTED",
    });

    const welcomeTemplate = application.position?.welcomeTemplate;
    const welcomeMessage = fill(
      welcomeTemplate ??
        "Selamat bergabung di Lumina Studio, {nama}! Kami sangat senang kamu resmi menjadi bagian dari tim {posisi}. Persiapkan dirimu untuk hari pertama yang penuh semangat — detail lengkap ada di halaman ini.",
      {
        nama: application.name,
        posisi: application.position?.title ?? "-",
        tanggal: nowDate.toLocaleDateString("id-ID", { dateStyle: "long" }),
      },
    );

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({
      ok: true,
      application: serializeApplication(updated),
      welcomeMessage,
    });
  } catch (error) {
    console.error("[POST /api/public/offer/respond]", error);
    return NextResponse.json({ error: "Gagal memproses jawaban. Coba lagi nanti." }, { status: 500 });
  }
}
