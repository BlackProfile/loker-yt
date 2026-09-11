// GET  /api/admin/positions — daftar SEMUA posisi (termasuk nonaktif), semua role.
// POST /api/admin/positions — buat posisi baru (OWNER/HR), mendukung seluruh field v3.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { closeExpiredPositions, serializePosition } from "@/lib/seed";
import { sanitizePositionInput } from "@/lib/position-input";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    await closeExpiredPositions();

    const rows = await db.position.findMany({
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json(rows.map(serializePosition));
  } catch (error) {
    console.error("[GET /api/admin/positions]", error);
    return NextResponse.json({ error: "Gagal memuat daftar posisi. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data posisi tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const sanitized = await sanitizePositionInput(data, { mode: "create" });
    if (!sanitized.ok) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 });
    }
    const f = sanitized.value;

    // Order: ikuti input bila dikirim, selain itu di bawah posisi terakhir.
    let order: number;
    if (f.order !== undefined) {
      order = f.order;
    } else {
      const maxOrder = await db.position.aggregate({ _max: { order: true } });
      order = (maxOrder._max.order ?? 0) + 1;
    }

    const created = await db.position.create({
      data: {
        title: f.title ?? "",
        slug: f.slug ?? null,
        department: f.department ?? "Umum",
        type: f.type ?? "Full-time",
        location: f.location ?? "Remote",
        description: f.description ?? "",
        requirements: JSON.stringify(f.requirements ?? []),
        isActive: f.isActive ?? true,
        closesAt: f.closesAt ?? null,
        order,

        coverFileId: f.coverFileId ?? null,
        salaryText: f.salaryText ?? null,
        salaryVisible: f.salaryVisible ?? false,
        benefits: JSON.stringify(f.benefits ?? []),
        examples: JSON.stringify(f.examples ?? []),
        urgent: f.urgent ?? false,
        featured: f.featured ?? false,

        screeningQuestions: f.screeningQuestions ?? "[]",
        requireCv: f.requireCv ?? false,
        requireIntro: f.requireIntro ?? false,
        requirePortfolio: f.requirePortfolio ?? false,
        maxApplicants: f.maxApplicants ?? null,

        publishAt: f.publishAt ?? null,

        stages: f.stages ?? "[]",
        aiCriteria: f.aiCriteria ?? null,
        autoShortlistScore: f.autoShortlistScore ?? null,
        autoShortlistStage: f.autoShortlistStage ?? null,
        applyTemplate: f.applyTemplate ?? null,
        acceptTemplate: f.acceptTemplate ?? null,
        rejectTemplate: f.rejectTemplate ?? null,
        assignmentTitle: f.assignmentTitle ?? null,
        assignmentUrl: f.assignmentUrl ?? null,
        assignmentNote: f.assignmentNote ?? null,

        rubricCriteria: JSON.stringify(f.rubricCriteria ?? []),
        checklistTemplate: JSON.stringify(f.checklistTemplate ?? []),
        noteTemplates: JSON.stringify(f.noteTemplates ?? []),
      },
    });

    // Realtime: daftar posisi publik & admin diperbarui otomatis.
    void emitRealtime(REALTIME_EVENTS.positions);
    return NextResponse.json(serializePosition(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/positions]", error);
    return NextResponse.json({ error: "Gagal membuat posisi. Coba lagi nanti." }, { status: 500 });
  }
}
