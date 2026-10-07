// NR-41 G9 — GET/PATCH /api/admin/candidates/[id] — detail & sunting profil kandidat (OWNER/HR).
// GET   → CandidateDetailResponse: ringkasan + seluruh lamaran milik kandidat.
// PATCH → { notes?, doNotHire?, doNotHireReason? }. Perubahan doNotHire juga
//         dituliskan ke Application.doNotHire pada SEMUA lamaran milik kandidat
//         (bendera global lintas posisi) + ActivityLog aktor admin sesi.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import type { CandidateSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Kandidat tidak ditemukan." };

/** Bangun ringkasan CandidateSummary dari row Candidate + lamarannya. */
function buildSummary(
  row: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    doNotHire: boolean;
    doNotHireReason: string | null;
    notes: string | null;
    firstSeenAt: Date;
    lastAppliedAt: Date | null;
  },
  apps: Array<{
    id: string;
    status: string;
    aiScore: number | null;
    createdAt: Date;
    position: { title: string } | null;
  }>,
): CandidateSummary {
  const positions: string[] = [];
  for (const app of apps) {
    const title = app.position?.title ?? "Posisi telah dihapus";
    if (!positions.includes(title)) positions.push(title);
  }
  const FINAL = ["REJECTED", "ACCEPTED", "HIRED"];
  const activeStatuses: string[] = [];
  for (const app of apps) {
    if (FINAL.includes(app.status)) continue;
    if (!activeStatuses.includes(app.status)) activeStatuses.push(app.status);
  }
  const bestAiScore = apps.reduce<number | null>((best, app) => {
    if (app.aiScore == null) return best;
    return best == null || app.aiScore > best ? app.aiScore : best;
  }, null);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    doNotHire: row.doNotHire,
    doNotHireReason: row.doNotHireReason,
    notes: row.notes,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastAppliedAt: apps[0]?.createdAt.toISOString() ?? row.lastAppliedAt?.toISOString() ?? null,
    applicationCount: apps.length,
    positions,
    activeStatuses,
    bestAiScore,
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }
    const { id } = await ctx.params;
    const row = await db.candidate.findUnique({
      where: { id },
      include: {
        applications: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            stageUpdatedAt: true,
            createdAt: true,
            aiScore: true,
            talentPool: true,
            doNotHire: true,
            trackingCode: true,
            position: { select: { title: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });

    const summary = buildSummary(row, row.applications);
    return NextResponse.json({
      ok: true as const,
      candidate: summary,
      applications: row.applications.map((app) => ({
        id: app.id,
        positionTitle: app.position?.title ?? null,
        status: app.status,
        stageUpdatedAt: app.stageUpdatedAt ? app.stageUpdatedAt.toISOString() : null,
        createdAt: app.createdAt.toISOString(),
        aiScore: app.aiScore,
        talentPool: app.talentPool,
        doNotHire: app.doNotHire,
        trackingCode: app.trackingCode,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/candidates/[id]]", error);
    return NextResponse.json({ error: "Gagal memuat detail kandidat. Coba lagi nanti." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const { id } = await ctx.params;
    const candidate = await db.candidate.findUnique({
      where: { id },
      select: { id: true, doNotHire: true },
    });
    if (!candidate) return NextResponse.json(NOT_FOUND, { status: 404 });

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: { notes?: string | null; doNotHire?: boolean; doNotHireReason?: string | null } = {};

    if (data.notes !== undefined) {
      if (data.notes === null) {
        updateData.notes = null;
      } else if (typeof data.notes === "string") {
        updateData.notes = data.notes.trim().slice(0, 4000) || null;
      } else {
        return NextResponse.json({ error: "Catatan harus berupa teks." }, { status: 400 });
      }
    }

    if (data.doNotHire !== undefined) {
      if (typeof data.doNotHire !== "boolean") {
        return NextResponse.json({ error: "doNotHire harus boolean." }, { status: 400 });
      }
      let reason: string | null =
        typeof data.doNotHireReason === "string" ? data.doNotHireReason.trim().slice(0, 300) : null;
      if (data.doNotHire && !reason) {
        // Pola kunci do-not-hire: alasan wajib saat memasang bendera.
        return NextResponse.json(
          { error: "Alasan do-not-hire wajib diisi saat memasang bendera." },
          { status: 400 },
        );
      }
      if (!data.doNotHire) reason = null;
      updateData.doNotHire = data.doNotHire;
      updateData.doNotHireReason = reason;
    } else if (typeof data.doNotHireReason === "string") {
      updateData.doNotHireReason = data.doNotHireReason.trim().slice(0, 300) || null;
    }

    const updated = await db.candidate.update({
      where: { id },
      data: updateData,
      include: {
        applications: {
          where: { deletedAt: null },
          select: {
            id: true,
            status: true,
            aiScore: true,
            createdAt: true,
            position: { select: { title: true } },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    // Bendera global: cermin ke SEMUA lamaran milik kandidat + audit trail.
    if (updateData.doNotHire !== undefined && updateData.doNotHire !== candidate.doNotHire) {
      await db.application.updateMany({
        where: { candidateId: id },
        data: { doNotHire: updateData.doNotHire, doNotHireReason: updateData.doNotHireReason },
      });
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "CANDIDATE_DO_NOT_HIRE",
          detail: updateData.doNotHire
            ? `Bendera do-not-hire dipasang untuk kandidat ${updated.email} — berlaku di semua lamarannya. Alasan: ${updateData.doNotHireReason ?? "-"}`
            : `Bendera do-not-hire dilepas untuk kandidat ${updated.email}.`,
        },
      });
      await db.activityLog.createMany({
        data: updated.applications.map((app) => ({
          applicationId: app.id,
          actor: session.name,
          action: updateData.doNotHire ? "DO_NOT_HIRE" : "DO_NOT_HIRE_RELEASED",
          detail: updateData.doNotHire
            ? `Do-not-hire dari profil kandidat terpusat — alasan: ${updateData.doNotHireReason ?? "-"}`
            : "Do-not-hire dilepas dari profil kandidat terpusat",
        })),
      });
    } else if (updateData.notes !== undefined) {
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "CANDIDATE_NOTE",
          detail: `Catatan kandidat ${updated.email} diperbarui`,
        },
      });
    }

    const summary = buildSummary(updated, updated.applications);
    return NextResponse.json({ ok: true as const, candidate: summary });
  } catch (error) {
    console.error("[PATCH /api/admin/candidates/[id]]", error);
    return NextResponse.json({ error: "Gagal menyimpan perubahan kandidat. Coba lagi nanti." }, { status: 500 });
  }
}
