// NR69 (Fitur #5) — Multi-reviewer scorecard.
// GET  /api/admin/interviews/[id]/scorecards — daftar reviewer terassign + kartu
//      penilaian individual masing-masing reviewer (HR/OWNER/VIEWER — semua role
//      boleh melihat).
// POST /api/admin/interviews/[id]/scorecards {reviewerId, scores, summary?} —
//      upsert kartu penilaian satu reviewer (maks 6 reviewer). Setelah upsert,
//      skor gabungan (Interview.scores) dihitung ulang sebagai rata-rata skor
//      seluruh reviewer per kriteria, lalu disimpan. OWNER/HR saja. Emit realtime
//      + ActivityLog "INTERVIEW_SCORECARD_SAVED".
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { can } from "@/lib/permissions";
import {
  parseAssignedReviewerIds,
  parseReviewerScorecards,
  mergeReviewerScorecards,
  type ReviewerScorecard,
} from "@/lib/scorecard";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { serializeInterview } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Sesi wawancara tidak ditemukan." };

type ReviewerSummary = {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

/** Ambil daftar AdminUser yang terassign sebagai reviewer (urut sesuai assignedReviewerIds). */
async function fetchAssignedReviewers(
  ids: string[],
): Promise<ReviewerSummary[]> {
  if (ids.length === 0) return [];
  const users = await db.adminUser.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true, role: true, isActive: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return ids
    .map((id) => byId.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u)
    .map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
    }));
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const interview = await db.interview.findUnique({
      where: { id },
      select: {
        id: true,
        applicationId: true,
        round: true,
        scores: true,
        assignedReviewerIds: true,
        reviewerScorecards: true,
        updatedAt: true,
      },
    });
    if (!interview) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const assignedIds = parseAssignedReviewerIds(interview.assignedReviewerIds);
    const reviewers = await fetchAssignedReviewers(assignedIds);
    const scorecards = parseReviewerScorecards(interview.reviewerScorecards);

    return NextResponse.json({
      interviewId: interview.id,
      applicationId: interview.applicationId,
      round: interview.round,
      assignedReviewerIds: assignedIds,
      reviewers,
      reviewerScorecards: scorecards,
      mergedScores: (() => {
        try {
          return interview.scores ? JSON.parse(interview.scores) : null;
        } catch {
          return null;
        }
      })(),
      updatedAt: interview.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("[GET /api/admin/interviews/[id]/scorecards]", error);
    return NextResponse.json(
      { error: "Gagal memuat kartu penilaian reviewer." },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    // Hanya OWNER/HR yang boleh menyimpan kartu penilaian.
    const allowed = await can(session.role, "kelola_lamaran");
    if (!allowed) {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const reviewerId =
      typeof data.reviewerId === "string" ? data.reviewerId.trim() : "";
    if (!reviewerId) {
      return NextResponse.json(
        { error: "Reviewer wajib dipilih." },
        { status: 400 },
      );
    }

    const interview = await db.interview.findUnique({
      where: { id },
      select: {
        id: true,
        applicationId: true,
        round: true,
        assignedReviewerIds: true,
        reviewerScorecards: true,
        scores: true,
      },
    });
    if (!interview) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Reviewer harus terdaftar di assignedReviewerIds (autorisasi ringan).
    const assigned = parseAssignedReviewerIds(interview.assignedReviewerIds);
    if (!assigned.includes(reviewerId)) {
      return NextResponse.json(
        {
          error:
            "Reviewer belum ditugaskan ke sesi ini. Tugaskan terlebih dahulu lewat dialog wawancara.",
        },
        { status: 400 },
      );
    }

    // Ambil nama reviewer dari AdminUser (lebih dapat dipercaya daripada body).
    const reviewer = await db.adminUser.findUnique({
      where: { id: reviewerId },
      select: { id: true, name: true, isActive: true },
    });
    if (!reviewer) {
      return NextResponse.json(
        { error: "Reviewer tidak ditemukan." },
        { status: 400 },
      );
    }
    const reviewerName = reviewer.name.trim().slice(0, 80) || reviewer.id;

    // Sanitasi skor — kriteria string 1-120 char, nilai 1-5, maks 8 kriteria.
    const scoresRaw = data.scores;
    const scores: Record<string, number> = {};
    if (scoresRaw && typeof scoresRaw === "object" && !Array.isArray(scoresRaw)) {
      for (const [rawKey, rawValue] of Object.entries(
        scoresRaw as Record<string, unknown>,
      )) {
        const key = typeof rawKey === "string" ? rawKey.trim().slice(0, 120) : "";
        const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!key || !Number.isFinite(num)) continue;
        scores[key] = Math.min(5, Math.max(1, Math.round(num)));
        if (Object.keys(scores).length >= 8) break;
      }
    }
    if (Object.keys(scores).length === 0) {
      return NextResponse.json(
        { error: "Skor minimal satu kriteria harus diisi (1-5)." },
        { status: 400 },
      );
    }

    const summary =
      typeof data.summary === "string" ? data.summary.trim().slice(0, 1000) : "";

    // Upsert: ganti kartu lama bila reviewerId sudah ada, selain itu tambahkan.
    const existing = parseReviewerScorecards(interview.reviewerScorecards);
    const entry: ReviewerScorecard = {
      reviewerId,
      reviewerName,
      scores,
      summary,
      updatedAt: new Date().toISOString(),
    };
    const idx = existing.findIndex((r) => r.reviewerId === reviewerId);
    if (idx >= 0) existing[idx] = entry;
    else existing.push(entry);
    // Batas keras 6 reviewer — buang yang paling lama bila berlebih.
    const capped = existing.slice(0, 6);

    // Hitung ulang skor gabungan (rata-rata per kriteria lintas reviewer).
    const merged = mergeReviewerScorecards(capped);
    const mergedScoresStr =
      Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;

    const updated = await db.interview.update({
      where: { id },
      data: {
        reviewerScorecards: JSON.stringify(capped),
        // Sinkronkan kolom scores lama dengan rata-rata reviewer (recompute otomatis).
        scores: mergedScoresStr,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: interview.applicationId,
        actor: session.name,
        action: "INTERVIEW_SCORECARD_SAVED",
        detail: `Penilaian reviewer "${reviewerName}" disimpan untuk ronde ${interview.round}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);

    return NextResponse.json({
      interview: serializeInterview(updated),
      reviewerScorecards: capped,
      mergedScores: merged,
    });
  } catch (error) {
    console.error("[POST /api/admin/interviews/[id]/scorecards]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan kartu penilaian reviewer. Coba lagi nanti." },
      { status: 500 },
    );
  }
}

// PATCH /api/admin/interviews/[id]/scorecards — simpan penugasan reviewer
// (assignedReviewerIds string[] AdminUser id, maks 6). OWNER/HR saja.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const allowed = await can(session.role, "kelola_lamaran");
    if (!allowed) {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    if (!Array.isArray(data.assignedReviewerIds)) {
      return NextResponse.json(
        { error: "Daftar reviewer tidak valid." },
        { status: 400 },
      );
    }

    const interview = await db.interview.findUnique({
      where: { id },
      select: { id: true, applicationId: true, round: true },
    });
    if (!interview) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Sanitasi: hanya id string, unik, trim, batas 6.
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const item of data.assignedReviewerIds) {
      if (typeof item !== "string") continue;
      const sid = item.trim();
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);
      ids.push(sid);
      if (ids.length >= 6) break;
    }

    // Validasi: semua id harus ada di AdminUser.
    if (ids.length > 0) {
      const found = await db.adminUser.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      });
      const foundSet = new Set(found.map((u) => u.id));
      if (!ids.every((sid) => foundSet.has(sid))) {
        return NextResponse.json(
          { error: "Salah satu reviewer tidak ditemukan." },
          { status: 400 },
        );
      }
    }

    const updated = await db.interview.update({
      where: { id },
      data: { assignedReviewerIds: JSON.stringify(ids) },
    });

    await db.activityLog.create({
      data: {
        applicationId: interview.applicationId,
        actor: session.name,
        action: "INTERVIEW_REVIEWER_ASSIGNED",
        detail: `Reviewer ditugaskan untuk ronde ${interview.round}: ${ids.length} orang`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);

    return NextResponse.json({ interview: serializeInterview(updated) });
  } catch (error) {
    console.error("[PATCH /api/admin/interviews/[id]/scorecards]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan penugasan reviewer." },
      { status: 500 },
    );
  }
}
