// POST /api/public/offer/respond — pelamar menjawab penawaran dari halaman status:
//   ACCEPT  -> WAJIB signatureName (e-signature, K30): offerStatus ACCEPTED, status ACCEPTED,
//              offerSignature disimpan, hiredAt + probationEnd diisi, welcome message,
//              NR-40: template rencana onboarding posisi terpasang otomatis bila pelamar belum punya rencana
//   DECLINE -> offerStatus DECLINED (+ alasan)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { APPLICATION_INCLUDE, parseOnboardingTemplate, serializeApplication } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { emitWebhook } from "@/lib/webhooks";
import { sendSystemEvent } from "@/lib/notify";
import { appendStageHistory } from "@/lib/stage-history";
import { ensureEmployeeCard } from "@/lib/employee-cards";

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
            onboardingTemplate: true, // NR-40 — auto-install rencana onboarding saat offer diterima
          },
        },
      },
    });
    if (!application) {
      return NextResponse.json({ error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
    }
    // Tahap sudah berubah ke Ditolak -> penawaran apa pun tidak berlaku lagi
    // (mencegah kandidat ditolak masih bisa menerima offer sisa yang menggantung).
    if (application.status === "REJECTED") {
      return NextResponse.json(
        { error: "Lamaran sudah ditolak — penawaran tidak berlaku lagi." },
        { status: 400 },
      );
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

    // NR-41 K30 — e-signature: menerima penawaran WAJIB disertai nama lengkap
    // yang diketik pelamar (3–120 karakter). Tanpa itu -> 400 (alur DECLINE
    // dan kedaluwarsa tidak berubah).
    const signatureName =
      typeof data.signatureName === "string" ? data.signatureName.trim() : "";
    if (action === "ACCEPT" && (signatureName.length < 3 || signatureName.length > 120)) {
      return NextResponse.json(
        { error: "Tanda tangan (nama lengkap) wajib diisi untuk menerima penawaran." },
        { status: 400 },
      );
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
      // Webhook keluar (Task 27): pelamar sudah menjawab penawaran (fire-and-forget).
      await emitWebhook("offer.responded", {
        id: application.id,
        name: application.name,
        offerStatus: "DECLINED",
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

    // NR-40 — auto-install template rencana onboarding posisi saat offer diterima.
    // Hanya bila posisi punya template (>= 1 item) DAN pelamar masih kosong rencananya
    // ("[]" / rusak / 0 item) — rencana yang sudah diisi manual TIDAK ditimpa.
    let onboardingPlanJson = application.onboardingPlan;
    let installedTemplateCount = 0;
    if (!onboardingPlanJson || onboardingPlanJson === "[]") {
      const template = parseOnboardingTemplate(application.position?.onboardingTemplate ?? null);
      if (template && template.length > 0) {
        // Basis H+0: tanggal mulai dari offer, selain itu hari penerimaan (UTC tengah malam).
        const base = application.offerStartDate ?? nowDate;
        const baseUtcMidnight = Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate());
        onboardingPlanJson = JSON.stringify(
          template.map((item, i) => ({
            id: `onb${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}${i}`,
            label: item.label,
            owner: item.owner ?? null,
            dueAt: new Date(baseUtcMidnight + (item.offsetDays ?? 0) * 24 * 60 * 60 * 1000).toISOString(),
            done: false,
          })),
        );
        installedTemplateCount = template.length;
      }
    }

    const updated = await db.application.update({
      where: { id: application.id },
      data: {
        offerStatus: "ACCEPTED",
        offerRespondedAt: nowDate,
        status: "ACCEPTED",
        // NR-41 K30 — e-signature tersimpan sebagai JSON OfferSignature.
        offerSignature: JSON.stringify({
          name: signatureName,
          method: "TYPED",
          at: nowDate.toISOString(),
          ip:
            req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            req.headers.get("x-real-ip")?.trim() ||
            null,
          ua: req.headers.get("user-agent")?.slice(0, 300) || null,
        }),
        // Riwayat tahap (NR-15): penerimaan offer tercatat sebagai perpindahan tahap.
        stageHistory: appendStageHistory(application.stageHistory, "ACCEPTED", application.status),
        hiredAt: nowDate,
        probationEnd,
        onboardingDocs: onboardingDocsJson,
        // NR-40 — rencana onboarding dari template posisi (bila terpasang).
        ...(onboardingPlanJson !== application.onboardingPlan
          ? { onboardingPlan: onboardingPlanJson }
          : {}),
      },
      include: APPLICATION_INCLUDE,
    });

    const acceptLogs: { applicationId: string; actor: string; action: string; detail: string }[] = [
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
    ];
    if (installedTemplateCount > 0) {
      acceptLogs.push({
        applicationId: application.id,
        actor: "Sistem",
        action: "ONBOARDING_PLAN_INSTALLED",
        detail: `${installedTemplateCount} item dari template posisi`,
      });
    }
    acceptLogs.push({
      applicationId: application.id,
      actor: "Pelamar",
      action: "OFFER_SIGNED",
      detail: `Ditandatangani elektronik oleh ${signatureName} (TYPED)`,
    });
    await db.activityLog.createMany({ data: acceptLogs });

    // Webhook keluar (Task 27): pelamar sudah menjawab penawaran (fire-and-forget).
    await emitWebhook("offer.responded", {
      id: application.id,
      name: application.name,
      offerStatus: "ACCEPTED",
    });

    // Cek-in masa percobaan 30/60/90 hari: dibuat sekali di awal onboarding
    // (dueAt = hiredAt + n hari), hanya bila application ini belum punya CheckIn.
    const existingCheckIns = await db.checkIn.count({ where: { applicationId: application.id } });
    if (existingCheckIns === 0) {
      await db.checkIn.createMany({
        data: [30, 60, 90].map((day) => ({
          applicationId: application.id,
          day,
          dueAt: new Date(nowDate.getTime() + day * 24 * 60 * 60 * 1000),
        })),
      });
    }

    // NR-39 — Kartu Karyawan terbit otomatis saat offer diterima (hiredAt terisi).
    // Kegagalan penerbitan kartu TIDAK menggagalkan penerimaan offer.
    await ensureEmployeeCard(application.id, { actor: "Sistem" }).catch((err) => {
      console.error("[offer-accept] gagal menerbitkan kartu karyawan", err);
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
