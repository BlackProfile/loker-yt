// POST /api/public/track — lacak status lamaran memakai kode tracking (tanpa data pribadi).
// Tahap-aware: pipeline bawaan (5 status) memakai alur lama; pipeline kustom per posisi
// menampilkan satu langkah per tahap kustom.
// v4: sertakan juga info wawancara (Zoom/Meet), penawaran (offer), alasan penolakan,
//     dan onboarding (checklist dokumen) agar pelamar bisa bertindak dari halaman status.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseRequirements } from "@/lib/seed";
import { isBuiltInStage } from "@/lib/stages";
import {
  INTERVIEW_PLATFORM_LABELS,
  REJECTION_REASON_LABELS,
  STATUS_FLOW,
  STATUS_LABELS,
  type ApplicationStatus,
  type InterviewMode,
  type InterviewPlatform,
  type InterviewStatus,
  type OfferStatus,
  type RejectionReason,
  type StageKey,
  type TrackResponse,
} from "@/lib/types";
import { parseOnboardingDocs } from "@/lib/seed";

export const dynamic = "force-dynamic";

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const rawCode =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).code
        : undefined;

    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json({ error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    const code = rawCode.trim().toUpperCase();

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      include: {
        position: {
          select: {
            title: true,
            slug: true,
            stages: true,
            assignmentTitle: true,
            assignmentUrl: true,
            assignmentNote: true,
            welcomeTemplate: true,
          },
        },
        interviews: { orderBy: { round: "asc" } },
      },
    });

    if (!application) {
      const notFound: TrackResponse = { found: false };
      return NextResponse.json(notFound);
    }

    // Lazy expiry: offer PENDING yang lewat deadline otomatis ditandai kedaluwarsa.
    const rawStatus = application.status.trim() || "NEW";
    let offerStatusRaw = application.offerStatus;
    if (offerStatusRaw === "PENDING" && application.offerDeadline && application.offerDeadline.getTime() < Date.now()) {
      await db.application.update({
        where: { id: application.id },
        data: { offerStatus: "EXPIRED" },
      });
      offerStatusRaw = "EXPIRED";
    }
    // Lazy repair: lamaran ber tahap Ditolak tidak boleh menyisakan offer PENDING
    // (sisa data lama) — batalkan senyap agar kartu penawaran tidak tampil lagi.
    if (offerStatusRaw === "PENDING" && rawStatus === "REJECTED") {
      await db.application.update({
        where: { id: application.id },
        data: { offerStatus: null },
      });
      offerStatusRaw = null;
    }

    const isTerminal = rawStatus === "ACCEPTED" || rawStatus === "REJECTED";
    const customStages = application.position ? parseRequirements(application.position.stages) : [];

    const steps: NonNullable<TrackResponse["steps"]> = [
      { key: "SUBMITTED", label: "Lamaran Diterima", done: true, at: application.createdAt.toISOString() },
    ];

    let status: StageKey;
    if (customStages.length === 0) {
      // Pipeline bawaan — perilaku lama dipertahankan persis.
      status = isBuiltInStage(rawStatus) ? (rawStatus as ApplicationStatus) : "NEW";
      const terminal = status === "ACCEPTED" || status === "REJECTED";
      const currentIndex = STATUS_FLOW.indexOf(status as ApplicationStatus);
      for (let i = 0; i < STATUS_FLOW.length; i++) {
        const key = STATUS_FLOW[i];
        const label = key === "NEW" ? "Menunggu Ditinjau" : STATUS_LABELS[key];
        steps.push({
          key,
          label,
          done: terminal || currentIndex >= i,
          at: null,
        });
      }
      if (terminal) {
        steps.push({
          key: status,
          label: status === "ACCEPTED" ? "Diterima" : "Tidak Lolos",
          done: true,
          at: application.updatedAt.toISOString(),
        });
      }
    } else {
      // Pipeline kustom — satu langkah per tahap, label = tahap apa adanya.
      status = rawStatus;
      const stages = customStages;
      const currentIndex = stages.indexOf(rawStatus);
      for (let i = 0; i < stages.length; i++) {
        steps.push({
          key: stages[i],
          label: stages[i],
          done: isTerminal || (currentIndex >= 0 && currentIndex >= i),
          at: null,
        });
      }
    }

    const assignmentInfo = application.position
      ? {
          title: application.position.assignmentTitle ?? null,
          url: application.position.assignmentUrl ?? null,
          note: application.position.assignmentNote ?? null,
        }
      : null;

    // Sesi wawancara (riwayat + aktif), diurutkan ronde
    const interviews = application.interviews
      .filter((iv) => iv.status !== "CANCELLED")
      .map((iv) => ({
        id: iv.id,
        round: iv.round,
        mode: (iv.mode === "ONSITE" ? "ONSITE" : "ONLINE") as InterviewMode,
        platform: iv.platform as InterviewPlatform,
        meetingLink: iv.meetingLink,
        address: iv.address,
        scheduledAt: iv.scheduledAt.toISOString(),
        durationMin: iv.durationMin,
        interviewers: (() => {
          try {
            const parsed: unknown = JSON.parse(iv.interviewers || "[]");
            return Array.isArray(parsed)
              ? parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
              : [];
          } catch {
            return [];
          }
        })(),
        status: iv.status as InterviewStatus,
        rescheduleReason: iv.rescheduleReason,
        rescheduleProposedAt: iv.rescheduleProposedAt ? iv.rescheduleProposedAt.toISOString() : null,
      }));

    // Penawaran (offer)
    let offer: TrackResponse["offer"] = null;
    if (offerStatusRaw) {
      const positionTitle = application.position?.title ?? "-";
      const deadlineStr = application.offerDeadline
        ? application.offerDeadline.toLocaleDateString("id-ID", { dateStyle: "long" })
        : "-";
      const baseMessage = application.position
        ? null
        : null;
      void baseMessage;
      const message = [
        `Kami menawarkanmu posisi ${positionTitle}${application.offerType ? ` (${application.offerType})` : ""} di Lumina Studio.`,
        application.offerSalary ? `Kompensasi: ${application.offerSalary}.` : null,
        application.offerStartDate
          ? `Rencana mulai: ${application.offerStartDate.toLocaleDateString("id-ID", { dateStyle: "long" })}.`
          : null,
        application.offerNote ?? null,
        `Mohon jawab sebelum ${deadlineStr}.`,
      ]
        .filter(Boolean)
        .join(" ");
      offer = {
        status: offerStatusRaw as OfferStatus,
        salary: application.offerSalary,
        type: application.offerType,
        startDate: application.offerStartDate ? application.offerStartDate.toISOString() : null,
        note: application.offerNote,
        deadline: application.offerDeadline ? application.offerDeadline.toISOString() : null,
        sentAt: application.offerSentAt ? application.offerSentAt.toISOString() : null,
        respondedAt: application.offerRespondedAt ? application.offerRespondedAt.toISOString() : null,
        declineReason: application.offerDeclineReason,
        message,
      };
    }

    // Penolakan (alasan + feedback bila admin mengisinya)
    let rejection: TrackResponse["rejection"] = null;
    if (rawStatus === "REJECTED" && application.rejectionReason) {
      rejection = {
        reasonLabel: REJECTION_REASON_LABELS[application.rejectionReason as RejectionReason] ?? "Alasan lain",
        note: application.rejectionNote?.trim() || null,
      };
    }

    // Onboarding (setelah diterima)
    let onboarding: TrackResponse["onboarding"] = null;
    if (application.hiredAt) {
      const welcomeMessage = application.position
        ? fill(
            application.position.welcomeTemplate ??
              "Selamat bergabung di Lumina Studio, {nama}! Kami sangat senang kamu resmi menjadi bagian dari tim {posisi}. Persiapkan dirimu untuk hari pertama yang penuh semangat.",
            {
              nama: application.name,
              posisi: application.position.title,
              tanggal: application.hiredAt.toLocaleDateString("id-ID", { dateStyle: "long" }),
            },
          )
        : null;
      onboarding = {
        hiredAt: application.hiredAt.toISOString(),
        probationEnd: application.probationEnd ? application.probationEnd.toISOString() : null,
        docs: parseOnboardingDocs(application.onboardingDocs),
        welcomeMessage,
      };
    }

    const result: TrackResponse = {
      found: true,
      status,
      positionTitle: application.position?.title ?? null,
      positionSlug: application.position?.slug ?? null,
      submittedAt: application.createdAt.toISOString(),
      steps,
      assignment:
        assignmentInfo && (assignmentInfo.title || assignmentInfo.url || assignmentInfo.note)
          ? assignmentInfo
          : null,
      interviews: interviews.length > 0 ? interviews : undefined,
      offer,
      rejection,
      onboarding,
    };
    void INTERVIEW_PLATFORM_LABELS;
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/public/track]", error);
    return NextResponse.json({ error: "Gagal melacak lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
