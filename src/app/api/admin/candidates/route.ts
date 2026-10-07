// NR-41 G9 — GET /api/admin/candidates — daftar kandidat terpusat (OWNER/HR).
// Query: ?q= pencarian nama/email/telepon (substring, case tidak dipisah karena
// email sudah dinormalisasi lowercase di level Candidate).
// Respons: CandidateSummary[] — agregasi dihitung dari lamaran milik tiap kandidat.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import type { CandidateSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") ?? "").trim().slice(0, 80);

    const rows = await db.candidate.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q } },
              { email: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : undefined,
      include: {
        // Select hemat: hanya field yang dipakai agregasi & ringkasan.
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
      orderBy: { updatedAt: "desc" },
      take: 500,
    });

    const summaries: CandidateSummary[] = rows.map((row) => {
      const apps = row.applications;
      const positions: string[] = [];
      for (const app of apps) {
        const title = app.position?.title ?? "Posisi telah dihapus";
        if (!positions.includes(title)) positions.push(title);
      }
      // Status aktif terbaru per posisi (status pipeline yang bukan tahap final).
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
    });

    // Paling baru melamar di atas.
    summaries.sort((a, b) => (b.lastAppliedAt ?? "").localeCompare(a.lastAppliedAt ?? ""));
    return NextResponse.json(summaries);
  } catch (error) {
    console.error("[GET /api/admin/candidates]", error);
    return NextResponse.json({ error: "Gagal memuat daftar kandidat. Coba lagi nanti." }, { status: 500 });
  }
}
