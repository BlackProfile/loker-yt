// POST /api/public/track — lacak status lamaran memakai KODE + EMAIL (login ganda:
// kode pelacakan berperan sebagai kata sandi; email harus cocok dengan lamaran).
// Tahap-aware: pipeline bawaan (5 status) memakai alur lama; pipeline kustom per posisi
// menampilkan satu langkah per tahap kustom.
// v4: sertakan juga info wawancara (Zoom/Meet), penawaran (offer), alasan penolakan,
//     dan onboarding (checklist dokumen) agar pelamar bisa bertindak dari halaman status.
// v5: sertakan slot jadwal self-service (bila tahap belum final) + rencana onboarding.
// v6: wajib email cocok + throttle per IP + lockout gagal login (status-gate).
// v7 (NR-15): read receipt (candidateSeenAt/Count) + statistik harian, riwayat tahap
//     bertanggal (stageHistory), penjelasan tahap (stageNote), estimasi waktu adaptif
//     (stageEstimates), thread tanya-jawab (questions), nama CV (cvFileName), token
//     survei (surveyToken), dan konfirmasi tanggal mulai (candidateStart).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseRequirements } from "@/lib/seed";
import { isBuiltInStage } from "@/lib/stages";
import { appendStageHistory, parseStageHistory } from "@/lib/stage-history";
import { buildStageNotes, parsePositionStageNotes } from "@/lib/stage-notes";
import { bumpStatusCheckStats } from "@/lib/status-stats";
import {
  clientIp,
  isLockedOut,
  isThrottled,
  clearAuthFails,
  recordAuthFail,
} from "@/lib/status-gate";
import {
  INTERVIEW_PLATFORM_LABELS,
  INTERVIEW_PLATFORMS,
  REJECTION_REASON_LABELS,
  STATUS_FLOW,
  STATUS_LABELS,
  type ApplicationStatus,
  type InterviewMode,
  type InterviewPlatform,
  type InterviewStatus,
  type OfferStatus,
  type RejectionReason,
  type StageHistoryItem,
  type StageKey,
  type TrackResponse,
  type TrackSlotInfo,
} from "@/lib/types";
import { parseOnboardingDocs } from "@/lib/seed";

export const dynamic = "force-dynamic";

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.split(`{${key}}`).join(value),
    template,
  );
}

/** Parse JSON interviewers slot/lamaran menjadi daftar nama bersih. */
function parseInterviewers(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

/** Parse rencana onboarding (JSON {id,label,owner?,dueAt?,done}[]). */
function parseOnboardingPlan(raw: string): TrackResponse["onboardingPlan"] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const items: NonNullable<TrackResponse["onboardingPlan"]> = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const obj = entry as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      if (!label) continue;
      items.push({
        id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : label.slice(0, 40),
        label: label.slice(0, 200),
        owner: typeof obj.owner === "string" && obj.owner.trim() ? obj.owner.trim().slice(0, 120) : undefined,
        dueAt: typeof obj.dueAt === "string" && obj.dueAt ? obj.dueAt : null,
        done: obj.done === true,
      });
    }
    return items.length > 0 ? items : null;
  } catch {
    return null;
  }
}

/** Median dari daftar angka (rata-rata dua nilai tengah bila jumlah genap). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? null) : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Estimasi waktu adaptif per tahap (median hari) dari maks 300 lamaran terbaru:
 * - tahap aktif: now - (stageUpdatedAt ?? createdAt)
 * - REJECTED: rejectedAt - stageUpdatedAt; ACCEPTED: hiredAt - stageUpdatedAt
 *   (lewati sampel null/negatif). Status dengan < 3 sampel tidak dilaporkan.
 */
async function computeStageEstimates(): Promise<Record<string, number>> {
  const now = Date.now();
  const rows = await db.application.findMany({
    where: { deletedAt: null },
    select: {
      status: true,
      stageUpdatedAt: true,
      createdAt: true,
      hiredAt: true,
      rejectedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const samples = new Map<string, number[]>();
  for (const row of rows) {
    const status = row.status.trim() || "NEW";
    const base = (row.stageUpdatedAt ?? row.createdAt).getTime();
    let durationMs: number | null = null;
    if (status === "REJECTED") {
      if (row.rejectedAt && row.stageUpdatedAt) durationMs = row.rejectedAt.getTime() - row.stageUpdatedAt.getTime();
    } else if (status === "ACCEPTED") {
      if (row.hiredAt && row.stageUpdatedAt) durationMs = row.hiredAt.getTime() - row.stageUpdatedAt.getTime();
    } else {
      durationMs = now - base;
    }
    if (durationMs === null || durationMs < 0) continue;
    const list = samples.get(status) ?? [];
    list.push(durationMs);
    samples.set(status, list);
  }
  const estimates: Record<string, number> = {};
  for (const [status, list] of samples) {
    if (list.length < 3) continue;
    const med = median(list);
    if (med === null) continue;
    estimates[status] = Math.round((med / (24 * 60 * 60 * 1000)) * 10) / 10;
  }
  return estimates;
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (isLockedOut(ip)) {
      return NextResponse.json(
        { found: false, lockedOut: true },
        { status: 429 },
      );
    }
    if (isThrottled(`track:${ip}`, 400)) {
      return NextResponse.json({ error: "Terlalu cepat." }, { status: 429 });
    }

    const body: unknown = await req.json().catch(() => null);
    const rawCode =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).code
        : undefined;
    const rawEmail =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).email
        : undefined;

    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json({ error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    if (typeof rawEmail !== "string" || !/\S+@\S+\.\S+/.test(rawEmail.trim())) {
      return NextResponse.json({ error: "Email wajib diisi dengan format yang benar." }, { status: 400 });
    }
    const code = rawCode.trim().toUpperCase();
    const email = rawEmail.trim().toLowerCase();

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      include: {
        position: {
          select: {
            title: true,
            slug: true,
            stages: true,
            stageNotes: true,
            assignmentTitle: true,
            assignmentUrl: true,
            assignmentNote: true,
            welcomeTemplate: true,
          },
        },
        interviews: { orderBy: { round: "asc" } },
        // Thread tanya-jawab (NR-15): terbaru dulu, maks 20 untuk halaman status.
        questions: { orderBy: { createdAt: "desc" }, take: 20 },
        cvFile: { select: { filename: true } },
      },
    });

    // Login ganda: email harus cocok dengan email lamaran. Respons SELALU sama
    // (found:false) baik kode salah, email salah, ATAU lamaran di tong sampah —
    // agar tidak membocorkan keberadaan kode. Tiap kegagalan dicatat untuk lockout.
    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== email) {
      recordAuthFail(ip);
      const notFound: TrackResponse = { found: false };
      return NextResponse.json(notFound);
    }
    clearAuthFails(ip);

    // Read receipt (NR-15, idea 5): catat bahwa pelamar membuka status lamaran ini
    // + statistik harian. Fire-and-forget — tidak pernah memblokir/menggagalkan respons.
    void db.application
      .update({
        where: { id: application.id },
        data: { candidateSeenAt: new Date(), candidateSeenCount: { increment: 1 } },
      })
      .catch(() => undefined);
    void bumpStatusCheckStats("checks");

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
          key: stages[i]!,
          label: stages[i]!,
          done: isTerminal || (currentIndex >= 0 && currentIndex >= i),
          at: null,
        });
      }
    }

    // Riwayat tahap bertanggal (NR-15, idea 1): parse field stageHistory;
    // lamaran lama tanpa riwayat disintesis minimal (tahap sekarang + waktu).
    const historyRaw = parseStageHistory(application.stageHistory);
    const stageHistory: StageHistoryItem[] = (
      historyRaw.length > 0
        ? historyRaw
        : [{ status: rawStatus, at: (application.stageUpdatedAt ?? application.createdAt).toISOString() }]
    ).map((entry) => ({
      key: entry.status,
      label: isBuiltInStage(entry.status) ? STATUS_LABELS[entry.status as ApplicationStatus] : entry.status,
      at: entry.at,
    }));

    // Penjelasan tahap (NR-15, idea 2): override posisi > teks bawaan > teks generik.
    const stageNotesOverride = parsePositionStageNotes(application.position?.stageNotes);
    const stageNote = buildStageNotes(
      steps.map((step) => step.key),
      stageNotesOverride,
    );

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
      updatedAt: application.updatedAt.toISOString(),
      steps,
      assignment:
        assignmentInfo && (assignmentInfo.title || assignmentInfo.url || assignmentInfo.note)
          ? assignmentInfo
          : null,
      interviews: interviews.length > 0 ? interviews : undefined,
      offer,
      rejection,
      rejectionReason: application.rejectionReason ?? null,
      onboarding,
      onboardingPlan: parseOnboardingPlan(application.onboardingPlan),
      stageHistory,
      stageNote,
      questions: application.questions.map((q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
        askedAt: q.createdAt.toISOString(),
        answeredAt: q.answeredAt ? q.answeredAt.toISOString() : null,
      })),
      cvFileName: application.cvFile?.filename ?? null,
    };
    void INTERVIEW_PLATFORM_LABELS;

    // Konfirmasi tanggal mulai (NR-15, idea 13) — hanya relevan setelah diterima.
    if (application.hiredAt) {
      result.candidateStart = {
        startDate: application.offerStartDate ? application.offerStartDate.toISOString() : null,
        confirmedAt: application.startConfirmedAt ? application.startConfirmedAt.toISOString() : null,
        proposedAt: application.startProposedAt ? application.startProposedAt.toISOString() : null,
        note: application.startProposedNote ?? null,
      };
    }

    // Token survei pengalaman kandidat (NR-15, idea 17) — status final & belum diisi.
    if (isTerminal) {
      try {
        const survey = await db.candidateSurvey.findFirst({
          where: { applicationId: application.id, score: 0 },
          select: { token: true },
        });
        if (survey) result.surveyToken = survey.token;
      } catch {
        // survei kosmetik — abaikan kegagalan
      }
    }

    // Slot self-service: hanya bila tahap belum final dan lamaran punya posisi.
    if (!isTerminal && application.positionId) {
      const slotRows = await db.interviewSlot.findMany({
        where: {
          positionId: application.positionId,
          bookedByApplicationId: null,
          scheduledAt: { gt: new Date() },
        },
        orderBy: { scheduledAt: "asc" },
        take: 8,
      });
      const slots: TrackSlotInfo[] = slotRows.map((s) => ({
        id: s.id,
        scheduledAt: s.scheduledAt.toISOString(),
        durationMin: s.durationMin,
        mode: (s.mode === "ONSITE" ? "ONSITE" : "ONLINE") as InterviewMode,
        platform: ((INTERVIEW_PLATFORMS as string[]).includes(s.platform)
          ? s.platform
          : "GOOGLE_MEET") as InterviewPlatform,
        meetingLink: s.meetingLink,
        address: s.address,
        interviewers: parseInterviewers(s.interviewers),
      }));
      if (slots.length > 0) {
        result.slots = slots;
      }
    }

    // Estimasi waktu adaptif (NR-15, idea 3) — dihitung dari data historis; kegagalan
    // tidak boleh menggagalkan respons track.
    try {
      result.stageEstimates = await computeStageEstimates();
    } catch {
      result.stageEstimates = null;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/public/track]", error);
    return NextResponse.json({ error: "Gagal melacak lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
