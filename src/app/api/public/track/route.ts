// POST /api/public/track — lacak status lamaran memakai kode tracking (tanpa data pribadi).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { APPLICATION_STATUSES, STATUS_FLOW, STATUS_LABELS, type ApplicationStatus, type TrackResponse } from "@/lib/types";

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
      include: { position: { select: { title: true } } },
    });

    if (!application) {
      const notFound: TrackResponse = { found: false };
      return NextResponse.json(notFound);
    }

    const status: ApplicationStatus = (APPLICATION_STATUSES as string[]).includes(application.status)
      ? (application.status as ApplicationStatus)
      : "NEW";
    const isTerminal = status === "ACCEPTED" || status === "REJECTED";
    const currentIndex = STATUS_FLOW.indexOf(status);

    const steps: NonNullable<TrackResponse["steps"]> = [
      { key: "SUBMITTED", label: "Lamaran Diterima", done: true, at: application.createdAt.toISOString() },
    ];
    for (let i = 0; i < STATUS_FLOW.length; i++) {
      const key = STATUS_FLOW[i];
      const label = key === "NEW" ? "Menunggu Ditinjau" : STATUS_LABELS[key];
      steps.push({
        key,
        label,
        done: isTerminal || currentIndex >= i,
        at: null,
      });
    }
    if (isTerminal) {
      steps.push({
        key: status,
        label: status === "ACCEPTED" ? "Diterima" : "Tidak Lolos",
        done: true,
        at: application.updatedAt.toISOString(),
      });
    }

    const result: TrackResponse = {
      found: true,
      status,
      positionTitle: application.position?.title ?? null,
      submittedAt: application.createdAt.toISOString(),
      steps,
    };
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/public/track]", error);
    return NextResponse.json({ error: "Gagal melacak lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
