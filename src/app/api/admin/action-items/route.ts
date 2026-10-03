// GET /api/admin/action-items — daftar hal yang butuh tindakan admin (semua role):
// lamaran belum ditinjau > 3 hari, permintaan reschedule, offer menunggu jawaban
// (dengan urgensi deadline), wawancara selesai tanpa skor, onboarding belum lengkap,
// lamaran duplikat yang perlu dicek, dan tahap pipeline yang melebihi batas
// kapasitas (wipOver — NR-19).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseOnboardingDocs } from "@/lib/seed";
import { findWipOverages, parseStageWipLimits } from "@/lib/wip-limits";
import type { ActionItemsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCORE_SLA_DAYS = 3; // wawancara selesai > 3 hari tanpa skor -> perlu tindakan
const REVIEW_SLA_DAYS = 3; // lamaran baru belum ditinjau > 3 hari -> perlu tindakan

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
    const [rescheduleRows, offerRows, unscoredRows, onboardingRows, staleNewRows, duplicateRows] = await Promise.all([
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
