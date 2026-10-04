// GET /api/admin/action-items — daftar hal yang butuh tindakan admin (semua role):
// lamaran belum ditinjau > 3 hari, permintaan reschedule, offer menunggu jawaban
// (dengan urgensi deadline), wawancara selesai tanpa skor, onboarding belum lengkap,
// lamaran duplikat yang perlu dicek, tahap pipeline yang melebihi batas kapasitas
// (wipOver — NR-19), serta item NR-24: tindak lanjut jatuh tempo (followUpsDue),
// review lamaran HOLD jatuh tempo (holdReviewsDue), dan tugas uji mendekati/lewat
// tenggat belum dikumpul (assessmentsDue).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseOnboardingDocs } from "@/lib/seed";
import { findWipOverages, parseStageWipLimits } from "@/lib/wip-limits";
import type { ActionItemsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCORE_SLA_DAYS = 3; // wawancara selesai > 3 hari tanpa skor -> perlu tindakan
const REVIEW_SLA_DAYS = 3; // lamaran baru belum ditinjau > 3 hari -> perlu tindakan
const DUE_SOON_DAYS = 3; // NR-24: snooze/review HOLD <= 3 hari lagi -> masuk daftar due

// Perluasan respons untuk Pusat Tugas (Task 20-a) — field tambahan di atas kontrak bawaan.
type SimpleApplicationItem = {
  applicationId: string;
  name: string;
  positionTitle: string | null;
  createdAt: string;
};

export type ExtendedActionItemsResponse = ActionItemsResponse & {
  staleNewApplications: SimpleApplicationItem[];
  duplicateApplications: SimpleApplicationItem[];
};

const BUILTIN_FINAL_STAGES = new Set(["ACCEPTED", "REJECTED"]);

/** Tahap final untuk satu posisi: ACCEPTED/REJECTED bawaan + tahap kustom berkategori final. */
function finalStagesOfPosition(categoriesRaw: string): Set<string> {
  const final = new Set<string>(BUILTIN_FINAL_STAGES);
  try {
    const categories: unknown = JSON.parse(categoriesRaw || "{}");
    if (categories && typeof categories === "object" && !Array.isArray(categories)) {
      for (const [stage, category] of Object.entries(categories as Record<string, unknown>)) {
        if (category === "ACCEPTED" || category === "REJECTED") final.add(stage);
      }
    }
  } catch {
    // JSON kategori rusak — pakai final bawaan saja.
  }
  // Tahap kustom tanpa kategori dianggap non-final (bisa jadi tahap kerja aktif).
  return final;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Silakan login terlebih dahulu." }, { status: 401 });
    }

    const reviewCutoff = new Date(Date.now() - REVIEW_SLA_DAYS * 24 * 60 * 60 * 1000);
    // NR-24 — item "jatuh tempo" dipakai utk followUpAt/holdReviewAt/assessment.dueAt:
    // jendela 3 hari ke depan; item yang sudah lewat tenggat tetap masuk (lte).
    const in3Days = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const [rescheduleRows, offerRows, unscoredRows, onboardingRows, staleNewRows, duplicateRows, followUpRows, holdReviewRows, dueAssessments] = await Promise.all([
      db.interview.findMany({
        where: { status: "RESCHEDULE_REQUESTED" },
        orderBy: { scheduledAt: "asc" },
        take: 20,
        include: {
          application: { select: { id: true, name: true, position: { select: { title: true } } } },
        },
      }),
      db.application.findMany({
        where: { offerStatus: "PENDING" },
        orderBy: { offerDeadline: "asc" },
        take: 20,
        select: {
          id: true,
          name: true,
          offerSalary: true,
          offerDeadline: true,
          position: { select: { title: true } },
        },
      }),
      db.interview.findMany({
        where: {
          status: "COMPLETED",
          OR: [{ scores: null }, { recommendation: null }],
          completedAt: { lt: new Date(Date.now() - SCORE_SLA_DAYS * 24 * 60 * 60 * 1000) },
        },
        orderBy: { completedAt: "asc" },
        take: 20,
        include: {
          application: { select: { id: true, name: true, position: { select: { title: true } } } },
        },
      }),
      db.application.findMany({
        where: { hiredAt: { not: null } },
        select: {
          id: true,
          name: true,
          onboardingDocs: true,
          position: { select: { title: true } },
        },
      }),
      db.application.findMany({
        where: { status: "NEW", createdAt: { lt: reviewCutoff }, talentPool: false },
        orderBy: { createdAt: "asc" },
        take: 20,
        select: { id: true, name: true, createdAt: true, position: { select: { title: true } } },
      }),
      db.application.findMany({
        where: { isDuplicate: true },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, name: true, createdAt: true, position: { select: { title: true } } },
      }),
      // NR-24 — tindak lanjut (snooze) jatuh tempo dalam 3 hari.
      db.application.findMany({
        where: { followUpAt: { lte: in3Days, not: null }, deletedAt: null, mergedIntoId: null },
        orderBy: { followUpAt: "asc" },
        take: 20,
        select: { id: true, name: true, followUpAt: true, createdAt: true, position: { select: { title: true } } },
      }),
      // NR-24 — review lamaran HOLD jatuh tempo dalam 3 hari.
      db.application.findMany({
        where: {
          holdReviewAt: { lte: in3Days, not: null },
          holdAt: { not: null },
          deletedAt: null,
          mergedIntoId: null,
        },
        orderBy: { holdReviewAt: "asc" },
        take: 20,
        select: {
          id: true,
          name: true,
          holdReason: true,
          holdReviewAt: true,
          createdAt: true,
          position: { select: { title: true } },
        },
      }),
      // NR-24 — tugas uji mendekati/lewat tenggat yang belum dikumpul.
      db.assessment.findMany({
        where: { status: "DIKIRIM", dueAt: { lte: in3Days } },
        orderBy: { dueAt: "asc" },
        take: 20,
        include: {
          application: {
            select: { id: true, name: true, deletedAt: true, position: { select: { title: true } } },
          },
        },
      }),
    ]);

    const body: ExtendedActionItemsResponse = {
      rescheduleRequests: rescheduleRows.map((row) => ({
        interviewId: row.id,
        applicationId: row.applicationId,
        name: row.application.name,
        positionTitle: row.application.position?.title ?? null,
        scheduledAt: row.scheduledAt.toISOString(),
        proposedAt: row.rescheduleProposedAt ? row.rescheduleProposedAt.toISOString() : null,
        reason: row.rescheduleReason,
      })),
      offersAwaiting: offerRows.map((row) => ({
        applicationId: row.id,
        name: row.name,
        positionTitle: row.position?.title ?? null,
        salary: row.offerSalary,
        deadline: row.offerDeadline ? row.offerDeadline.toISOString() : null,
      })),
      unscoredInterviews: unscoredRows.map((row) => ({
        interviewId: row.id,
        applicationId: row.applicationId,
        name: row.application.name,
        positionTitle: row.application.position?.title ?? null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      })),
      onboardingIncomplete: onboardingRows
        .map((row) => {
          const docs = parseOnboardingDocs(row.onboardingDocs);
          const missing = docs.filter((d) => d.required && !d.done).map((d) => d.label);
          return {
            applicationId: row.id,
            name: row.name,
            positionTitle: row.position?.title ?? null,
            missingDocs: missing,
          };
        })
        .filter((row) => row.missingDocs.length > 0)
        .slice(0, 20),
      staleNewApplications: staleNewRows.map((row) => ({
        applicationId: row.id,
        name: row.name,
        positionTitle: row.position?.title ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      duplicateApplications: duplicateRows.map((row) => ({
        applicationId: row.id,
        name: row.name,
        positionTitle: row.position?.title ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      followUpsDue: followUpRows.map((row) => ({
        applicationId: row.id,
        name: row.name,
        positionTitle: row.position?.title ?? null,
        dueAt: (row.followUpAt ?? row.createdAt).toISOString(),
      })),
      holdReviewsDue: holdReviewRows.map((row) => ({
        applicationId: row.id,
        name: row.name,
        positionTitle: row.position?.title ?? null,
        holdReason: row.holdReason,
        reviewAt: (row.holdReviewAt ?? row.createdAt).toISOString(),
      })),
      assessmentsDue: dueAssessments
        .filter((row) => row.application.deletedAt === null)
        .map((row) => ({
          assessmentId: row.id,
          applicationId: row.application.id,
          name: row.application.name,
          positionTitle: row.application.position?.title ?? null,
          title: row.title,
          dueAt: row.dueAt.toISOString(),
        })),
    };

    const wipOver: NonNullable<ActionItemsResponse["wipOver"]> = [];

    // NR-19 — Tahap yang melebihi batas kapasitas (WIP limit) per posisi.
    // Hitungan mengikuti papan kanban: lamaran yang tidak di tong sampah dan
    // berada pada tahap non-final (bukan ACCEPTED/REJECTED bawaan maupun tahap
    // kustom berkategori final).
    try {
      const wipPositions = await db.position.findMany({
        where: { stageWipLimits: { not: null } },
        select: {
          id: true,
          title: true,
          stageCategories: true,
          stageWipLimits: true,
        },
      });
      if (wipPositions.length > 0) {
        const grouped = await db.application.groupBy({
          by: ["positionId", "status"],
          where: {
            positionId: { in: wipPositions.map((p) => p.id) },
            deletedAt: null,
          },
          _count: { _all: true },
        });
        for (const position of wipPositions) {
          const limits = parseStageWipLimits(position.stageWipLimits);
          if (!limits) continue;
          const finalStages = finalStagesOfPosition(position.stageCategories);
          const stageCounts: Record<string, number> = {};
          for (const row of grouped) {
            if (row.positionId !== position.id) continue;
            if (finalStages.has(row.status)) continue;
            stageCounts[row.status] = (stageCounts[row.status] ?? 0) + row._count._all;
          }
          for (const overage of findWipOverages(limits, stageCounts)) {
            wipOver.push({
              positionId: position.id,
              positionTitle: position.title,
              stage: overage.stage,
              count: overage.count,
              limit: overage.limit,
            });
          }
        }
      }
    } catch (wipError) {
      // Peringatan kapasitas bersifat pelengkap — jangan gagalkan endpoint.
      console.error("[GET /api/admin/action-items] wipOver", wipError);
    }
    body.wipOver = wipOver;

    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/admin/action-items]", error);
    return NextResponse.json({ error: "Gagal memuat daftar tindakan. Coba lagi nanti." }, { status: 500 });
  }
}
