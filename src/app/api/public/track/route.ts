// POST /api/public/track — lacak status lamaran memakai kode tracking (tanpa data pribadi).
// Tahap-aware: pipeline bawaan (5 status) memakai alur lama; pipeline kustom per posisi
// menampilkan satu langkah per tahap kustom.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseRequirements } from "@/lib/seed";
import { isBuiltInStage } from "@/lib/stages";
import {
  STATUS_FLOW,
  STATUS_LABELS,
  type ApplicationStatus,
  type StageKey,
  type TrackResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";

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
          },
        },
      },
    });

    if (!application) {
      const notFound: TrackResponse = { found: false };
      return NextResponse.json(notFound);
    }

    const rawStatus = application.status.trim() || "NEW";
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
    };
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/public/track]", error);
    return NextResponse.json({ error: "Gagal melacak lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
