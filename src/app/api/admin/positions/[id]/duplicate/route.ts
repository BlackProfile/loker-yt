// POST /api/admin/positions/[id]/duplicate — salin posisi menjadi draft baru (OWNER/HR).
// Menyalin SELURUH field v3; slug baru unik; views & jadwal auto-close direset.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { ensureUniqueSlug, serializePosition } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const existing = await db.position.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const title = `${existing.title} (Salinan)`;
    const maxOrder = await db.position.aggregate({ _max: { order: true } });
    const order = (maxOrder._max.order ?? 0) + 1;
    const slug = await ensureUniqueSlug(title);

    const created = await db.position.create({
      data: {
        title,
        slug,
        department: existing.department,
        type: existing.type,
        location: existing.location,
        description: existing.description,
        requirements: existing.requirements,
        isActive: false, // duplikat selalu mulai sebagai draft
        closesAt: null, // batas waktu lama tidak relevan untuk salinan
        order,

        coverFileId: existing.coverFileId,
        salaryText: existing.salaryText,
        salaryVisible: existing.salaryVisible,
        benefits: existing.benefits,
        examples: existing.examples,
        urgent: existing.urgent,
        featured: existing.featured,

        screeningQuestions: existing.screeningQuestions,
        requireCv: existing.requireCv,
        requireIntro: existing.requireIntro,
        requirePortfolio: existing.requirePortfolio,
        customDocs: existing.customDocs,
        maxApplicants: existing.maxApplicants,

        publishAt: existing.publishAt,

        stages: existing.stages,
        aiCriteria: existing.aiCriteria,
        autoShortlistScore: existing.autoShortlistScore,
        autoShortlistStage: existing.autoShortlistStage,
        applyTemplate: existing.applyTemplate,
        acceptTemplate: existing.acceptTemplate,
        rejectTemplate: existing.rejectTemplate,
        assignmentTitle: existing.assignmentTitle,
        assignmentUrl: existing.assignmentUrl,
        assignmentNote: existing.assignmentNote,

        rubricCriteria: existing.rubricCriteria,
        checklistTemplate: existing.checklistTemplate,
        noteTemplates: existing.noteTemplates,
        views: 0, // penghitung view direset untuk salinan
      },
    });

    return NextResponse.json(serializePosition(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/positions/[id]/duplicate]", error);
    return NextResponse.json({ error: "Gagal menduplikasi posisi. Coba lagi nanti." }, { status: 500 });
  }
}
