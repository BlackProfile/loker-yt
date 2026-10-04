// /api/admin/applications/[id]/merge — gabungkan lamaran duplikat ke lamaran utama
// (NR-24, fitur 12). POST {duplicateId}.
// Dalam satu transaksi: seluruh timeline & diskusi duplikat (ActivityLog, CallLog,
// InternalDoc, Assessment, Comment, ApplicationQuestion, EmailOutbox, CandidateSurvey)
// dipindahkan ke lamaran utama; field konten utama yang kosong dilengkapi dari
// duplikat; duplikat ditandai mergedIntoId + diarsipkan. Riwayat ronde wawancara
// (Interview) TIDAK dipindah — tetap milik lamaran asal.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, parseDocExpiries, parseExtraDocs, parseTags, serializeApplication } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

type BotFileEntry = { fileId: string; filename: string; mimeType: string; size: number; sentAt: string };

/** Parse kolom Application.botFiles (JSON, aman terhadap data rusak). */
function parseBotFiles(raw: string | null | undefined): BotFileEntry[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is BotFileEntry =>
        Boolean(item) && typeof (item as { fileId?: unknown }).fileId === "string"
    );
  } catch {
    return [];
  }
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    const data = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const duplicateId = typeof data.duplicateId === "string" ? data.duplicateId.trim() : "";
    if (!duplicateId) {
      return NextResponse.json({ error: "ID lamaran duplikat wajib diisi." }, { status: 400 });
    }
    if (duplicateId === id) {
      return NextResponse.json(
        { error: "Tidak dapat menggabungkan lamaran dengan dirinya sendiri." },
        { status: 400 }
      );
    }

    const [main, dup] = await Promise.all([
      db.application.findUnique({ where: { id } }),
      db.application.findUnique({ where: { id: duplicateId } }),
    ]);
    if (!main) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (!dup) {
      return NextResponse.json({ error: "Lamaran duplikat tidak ditemukan." }, { status: 404 });
    }
    if (main.deletedAt) {
      return NextResponse.json(
        { error: "Lamaran utama berada di tong sampah — pulihkan terlebih dahulu." },
        { status: 409 }
      );
    }
    if (dup.deletedAt) {
      return NextResponse.json(
        { error: "Lamaran duplikat berada di tong sampah — pulihkan terlebih dahulu." },
        { status: 409 }
      );
    }
    if (main.mergedIntoId) {
      return NextResponse.json(
        { error: "Lamaran utama sudah merupakan hasil penggabungan duplikat lain." },
        { status: 409 }
      );
    }
    if (dup.mergedIntoId) {
      return NextResponse.json(
        { error: "Lamaran duplikat sudah pernah digabungkan ke lamaran lain." },
        { status: 409 }
      );
    }

    const now = new Date();

    // Gabungkan field konten lamaran utama (urut utama dulu, duplikat hanya melengkapi).
    const mainTags = parseTags(main.tags);
    const mergedTags = [...mainTags, ...parseTags(dup.tags).filter((t) => !mainTags.includes(t))];
    const mergedExtraDocs = [...parseExtraDocs(main.extraDocs), ...parseExtraDocs(dup.extraDocs)];
    const mainDocExpiries = parseDocExpiries(main.docExpiries);
    const mergedDocExpiries = [
      ...mainDocExpiries,
      ...parseDocExpiries(dup.docExpiries).filter((d) => !mainDocExpiries.some((m) => m.label === d.label)),
    ];
    const mergedBotFiles = [...parseBotFiles(main.botFiles), ...parseBotFiles(dup.botFiles)];

    await db.$transaction(async (tx) => {
      // 1. Pindahkan seluruh timeline & diskusi duplikat ke lamaran utama.
      await tx.activityLog.updateMany({ where: { applicationId: dup.id }, data: { applicationId: main.id } });
      await tx.callLog.updateMany({ where: { applicationId: dup.id }, data: { applicationId: main.id } });
      await tx.internalDoc.updateMany({ where: { applicationId: dup.id }, data: { applicationId: main.id } });
      await tx.assessment.updateMany({ where: { applicationId: dup.id }, data: { applicationId: main.id } });
      await tx.comment.updateMany({ where: { applicationId: dup.id }, data: { applicationId: main.id } });
      await tx.applicationQuestion.updateMany({
        where: { applicationId: dup.id },
        data: { applicationId: main.id },
      });
      await tx.emailOutbox.updateMany({ where: { applicationId: dup.id }, data: { applicationId: main.id } });
      await tx.candidateSurvey.updateMany({
        where: { applicationId: dup.id },
        data: { applicationId: main.id },
      });
      // Riwayat ronde wawancara (Interview) sengaja TIDAK dipindah.

      // 2. Lengkapi field konten utama yang kosong dari duplikat.
      await tx.application.update({
        where: { id: main.id },
        data: {
          tags: JSON.stringify(mergedTags),
          extraDocs: JSON.stringify(mergedExtraDocs),
          docExpiries: JSON.stringify(mergedDocExpiries),
          botFiles: JSON.stringify(mergedBotFiles),
          cvFileId: main.cvFileId ?? dup.cvFileId,
          introFileId: main.introFileId ?? dup.introFileId,
          portfolioUrl: emptyToNull(main.portfolioUrl) ?? emptyToNull(dup.portfolioUrl),
          socialLinks: emptyToNull(main.socialLinks) ?? emptyToNull(dup.socialLinks),
          salaryExpectation: main.salaryExpectation ?? dup.salaryExpectation,
          rating: main.rating === 0 ? dup.rating : main.rating,
        },
      });

      // 3. Tandai duplikat: digabungkan ke utama + diarsipkan (muncul di filter Diarsip).
      await tx.application.update({
        where: { id: dup.id },
        data: { mergedIntoId: main.id, archivedAt: now },
      });

      // 4. Audit trail di kedua lamaran.
      await tx.activityLog.create({
        data: {
          applicationId: main.id,
          actor: session.name,
          action: "DUPLICATE_MERGED",
          detail: `Menggabungkan ${dup.trackingCode ?? "lamaran"} (${dup.name}) — timeline, berkas, dan diskusi dipindahkan`,
        },
      });
      await tx.activityLog.create({
        data: {
          applicationId: dup.id,
          actor: session.name,
          action: "DUPLICATE_MERGED_INTO",
          detail: `Digabungkan ke ${main.trackingCode ?? "lamaran"} (${main.name}) sebagai duplikat`,
        },
      });
    });

    void emitRealtime(REALTIME_EVENTS.applications);

    const updatedMain = await db.application.findUnique({ where: { id: main.id }, include: APPLICATION_INCLUDE });
    if (!updatedMain) {
      return NextResponse.json({ error: "Gagal memuat lamaran utama." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, application: serializeApplication(updatedMain) });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/merge]", error);
    return NextResponse.json({ error: "Gagal menggabungkan lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
