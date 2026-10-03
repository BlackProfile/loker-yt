// NR-24 — Gabungkan dua lamaran milik pelamar yang sama (merge duplicates).
// POST /api/admin/applications/[id]/merge — (OWNER/HR) body {sourceId}.
// Seluruh data turunan lamaran sumber (komentar, pertanyaan, log, panggilan, asesmen,
// dokumen internal, check-in, wawancara) dipindahkan ke lamaran target dalam satu transaksi;
// tags/CV/intro/dokumen ekstra/berkas bot/masa berlaku dokumen digabung; lamaran sumber
// ditandai REJECTED (DUPLICATE) + mergedIntoId agar jejaknya tetap terlacak.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, parseDocExpiries, parseTags, serializeApplication } from "@/lib/seed";
import { appendStageHistory } from "@/lib/stage-history";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

const TAGS_MAX = 12;
const EXTRA_DOCS_MAX = 12;
const BOT_FILES_MAX = 12;

type ExtraDoc = { label: string; filename: string; fileId: string };
type BotFile = { fileId: string; filename: string; mimeType?: string; size?: number; sentAt?: string };

/** Parse array JSON aman → objek[] (fallback kosong bila rusak). */
function parseObjectArray(raw: string | null | undefined): Record<string, unknown>[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  } catch {
    return [];
  }
}

/** Sanitasi daftar dokumen ekstra: label/filename/fileId teks non-kosong, maks 12. */
function sanitizeExtraDocs(raw: string | null | undefined): ExtraDoc[] {
  const out: ExtraDoc[] = [];
  for (const item of parseObjectArray(raw)) {
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const filename = typeof item.filename === "string" ? item.filename.trim() : "";
    const fileId = typeof item.fileId === "string" ? item.fileId.trim() : "";
    if (!label || !fileId) continue;
    out.push({ label, filename, fileId });
    if (out.length >= EXTRA_DOCS_MAX) break;
  }
  return out;
}

/** Sanitasi daftar lampiran bot Telegram: fileId wajib, maks 12. */
function sanitizeBotFiles(raw: string | null | undefined): BotFile[] {
  const out: BotFile[] = [];
  for (const item of parseObjectArray(raw)) {
    const fileId = typeof item.fileId === "string" ? item.fileId.trim() : "";
    if (!fileId) continue;
    out.push({
      fileId,
      filename: typeof item.filename === "string" ? item.filename : "",
      mimeType: typeof item.mimeType === "string" ? item.mimeType : undefined,
      size: typeof item.size === "number" ? item.size : undefined,
      sentAt: typeof item.sentAt === "string" ? item.sentAt : undefined,
    });
    if (out.length >= BOT_FILES_MAX) break;
  }
  return out;
}

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

    const body: unknown = await _req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const sourceId = typeof data.sourceId === "string" ? data.sourceId.trim() : "";
    if (!sourceId) {
      return NextResponse.json({ error: "Lamaran sumber wajib dipilih." }, { status: 400 });
    }
    if (sourceId === id) {
      return NextResponse.json(
        { error: "Lamaran sumber tidak boleh sama dengan lamaran ini." },
        { status: 400 }
      );
    }

    const [target, source] = await Promise.all([
      db.application.findUnique({ where: { id } }),
      db.application.findUnique({ where: { id: sourceId } }),
    ]);
    if (!target || target.deletedAt || !source || source.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (source.mergedIntoId) {
      return NextResponse.json({ error: "Lamaran sumber sudah pernah digabung." }, { status: 400 });
    }
    if (source.status === "ACCEPTED" || source.status === "COMPLETED" || source.hiredAt) {
      return NextResponse.json(
        { error: "Lamaran yang sudah diterima tidak bisa digabung." },
        { status: 400 }
      );
    }

    const now = new Date();

    // Gabungkan data JSON di luar transaksi (read-only), hasil dipakai di dalamnya.
    const mergedTags = Array.from(new Set([...parseTags(target.tags), ...parseTags(source.tags)])).slice(0, TAGS_MAX);
    const mergedExtraDocs = [
      ...sanitizeExtraDocs(target.extraDocs),
      ...sanitizeExtraDocs(source.extraDocs),
    ].slice(0, EXTRA_DOCS_MAX);
    const mergedBotFiles = [...sanitizeBotFiles(target.botFiles), ...sanitizeBotFiles(source.botFiles)].slice(
      0,
      BOT_FILES_MAX
    );
    // Masa berlaku dokumen: target menang bila kunci sama, entri sumber menambah kunci baru.
    const mergedDocExpiries = { ...parseDocExpiries(source.docExpiries), ...parseDocExpiries(target.docExpiries) };

    const result = await db.$transaction(async (tx) => {
      // 1. Pindahkan seluruh data turunan sumber → target.
      await tx.comment.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });
      await tx.applicationQuestion.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });
      await tx.activityLog.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });
      await tx.applicationCall.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });
      await tx.applicationAssessment.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });
      await tx.applicationInternalDoc.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });
      await tx.checkIn.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });
      await tx.interview.updateMany({ where: { applicationId: sourceId }, data: { applicationId: id } });

      // 2. Perbarui target: tags union, CV/intro bila kosong, gabungan dokumen & map kedaluwarsa.
      const targetUpdated = await tx.application.update({
        where: { id },
        data: {
          tags: JSON.stringify(mergedTags),
          cvFileId: target.cvFileId ? target.cvFileId : source.cvFileId,
          introFileId: target.introFileId ? target.introFileId : source.introFileId,
          extraDocs: mergedExtraDocs.length > 0 ? JSON.stringify(mergedExtraDocs) : target.extraDocs,
          botFiles: mergedBotFiles.length > 0 ? JSON.stringify(mergedBotFiles) : target.botFiles,
          docExpiries: Object.keys(mergedDocExpiries).length > 0 ? JSON.stringify(mergedDocExpiries) : null,
        },
        include: APPLICATION_INCLUDE,
      });

      // 3. Tandai sumber: ditolak sebagai DUPLICATE + menunjuk lamaran utama.
      await tx.application.update({
        where: { id: sourceId },
        data: {
          status: "REJECTED",
          rejectionReason: "DUPLICATE",
          rejectionNote: `Digabung ke lamaran ${target.trackingCode ?? target.id}`,
          rejectedAt: now,
          mergedIntoId: id,
          isDuplicate: true,
          offerStatus: source.offerStatus === "PENDING" ? null : source.offerStatus,
          stageHistory: appendStageHistory(source.stageHistory, "REJECTED", source.status),
          stageUpdatedAt: now,
        },
      });

      // 4. Audit log (dibuat setelah pemindahan agar tetap di lamaran masing-masing).
      await tx.activityLog.create({
        data: {
          applicationId: id,
          actor: session.name,
          action: "MERGE",
          detail: `Menggabungkan ${source.trackingCode ?? sourceId} ke lamaran ini`,
        },
      });
      await tx.activityLog.create({
        data: {
          applicationId: sourceId,
          actor: session.name,
          action: "MERGED",
          detail: `Digabung ke ${target.trackingCode ?? id} oleh ${session.name}`,
        },
      });

      return targetUpdated;
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, target: serializeApplication(result) });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/merge]", error);
    return NextResponse.json({ error: "Gagal menggabungkan lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
