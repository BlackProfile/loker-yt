// NR56 — Peta referensi FileAsset (SERVER-ONLY).
// Dipakai Pusat Kelola Berkas untuk:
// 1. Menentukan "milik siapa" sebuah berkas (lamaran, posisi, tugas uji, dst).
// 2. Mendeteksi berkas yatim — tidak dirujuk entri mana pun (kandidat pembersihan).
// 3. Melepas (detach) referensi JSON/kolom non-FK sebelum berkas dihapus — relasi FK
//    (cvFile, introFile, coverFile, assessmentSubmittedFile) otomatis SetNull oleh Prisma.
//
// Sumber referensi yang dipetakan (hasil audit menyeluruh):
// - FK        : Position.coverFileId, Application.cvFileId, Application.introFileId,
//               Assessment.submittedFileId
// - JSON App  : Application.extraDocs, onboardingDocs, botFiles, formAnswers (jawaban file Form Builder)
// - Kolom     : InternalDoc.fileId, Interview.recordingUrl ("/api/files/{id}")
// - JSON Draft: ApplicationDraft.files (hanya draft yang belum kedaluwarsa)
// - Pengecualian: kind=OFFER_PDF adalah arsip tanpa rujukan BY DESIGN — tidak pernah dianggap yatim.
import { unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";

export type FileRefDisplay = {
  applications: {
    id: string;
    name: string;
    trackingCode: string | null;
    position: string | null;
    sources: string[];
  }[];
  positions: { id: string; title: string }[];
  assessments: { id: string; title: string }[];
  internalDocs: { label: string }[];
  drafts: { email: string }[];
  interviews: number;
  // Data mesin untuk detach (tidak dikirim ke UI):
  appIds: string[];
  internalDocIds: string[];
  draftTokens: string[];
  interviewIds: string[];
};

export type FileRefMap = Map<string, FileRefDisplay>;

function emptyRefs(): FileRefDisplay {
  return {
    applications: [],
    positions: [],
    assessments: [],
    internalDocs: [],
    drafts: [],
    interviews: 0,
    appIds: [],
    internalDocIds: [],
    draftTokens: [],
    interviewIds: [],
  };
}

/** Ambil semua nilai fileId dari array JSON [{fileId,...}] — aman terhadap JSON rusak. */
function fileIdsFromJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const item of parsed) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const id = (item as Record<string, unknown>).fileId;
        if (typeof id === "string" && id) ids.push(id);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

/** Ambil fileId dari jawaban file Form Builder — JSON bebas berisi objek {fileId}. */
function fileIdsFromJsonDeep(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const found: string[] = [];
  const visit = (node: unknown, depth: number): void => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child, depth + 1);
      return;
    }
    if (typeof node === "object") {
      const fileId = (node as Record<string, unknown>).fileId;
      if (typeof fileId === "string" && fileId) found.push(fileId);
      for (const value of Object.values(node as Record<string, unknown>)) {
        if (value && typeof value === "object") visit(value, depth + 1);
      }
    }
  };
  try {
    visit(JSON.parse(raw), 0);
  } catch {
    // JSON rusak — abaikan.
  }
  return found;
}

/** Ekstrak id FileAsset dari URL "/api/files/{id}". */
function fileIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /\/api\/files\/([A-Za-z0-9_-]+)/.exec(url);
  return match ? match[1] : null;
}

const SOURCE_LABELS = {
  cv: "CV",
  intro: "Video/Audio Intro",
  extraDocs: "Dokumen Wajib",
  onboardingDocs: "Dokumen Onboarding",
  botFiles: "Lampiran Bot",
  formAnswers: "Jawaban Form",
} as const;

/**
 * Bangun peta fileId -> referensi dari seluruh tabel terkait.
 * Satu kali query paralel — cukup cepat untuk dipanggil di GET list maupun DELETE.
 */
export async function collectFileRefs(): Promise<FileRefMap> {
  const now = Date.now();
  const [
    positions,
    applications,
    assessments,
    internalDocs,
    drafts,
    interviews,
  ] = await Promise.all([
    db.position.findMany({
      where: { coverFileId: { not: null } },
      select: { id: true, title: true, coverFileId: true },
    }),
    db.application.findMany({
      select: {
        id: true,
        name: true,
        trackingCode: true,
        cvFileId: true,
        introFileId: true,
        extraDocs: true,
        onboardingDocs: true,
        botFiles: true,
        formAnswers: true,
        position: { select: { title: true } },
      },
    }),
    db.assessment.findMany({
      where: { submittedFileId: { not: null } },
      select: { id: true, title: true, submittedFileId: true },
    }),
    db.internalDoc.findMany({
      select: { id: true, label: true, fileId: true },
    }),
    db.applicationDraft.findMany({
      where: { files: { not: "[]" }, expiresAt: { gt: new Date() } },
      select: { token: true, email: true, files: true },
    }),
    db.interview.findMany({
      where: { recordingUrl: { contains: "/api/files/" } },
      select: { id: true, recordingUrl: true },
    }),
  ]);

  const map: FileRefMap = new Map();
  const ensure = (fileId: string): FileRefDisplay => {
    let refs = map.get(fileId);
    if (!refs) {
      refs = emptyRefs();
      map.set(fileId, refs);
    }
    return refs;
  };
  const addAppSource = (fileId: string, appId: string, source: string): void => {
    const refs = ensure(fileId);
    if (!refs.appIds.includes(appId)) {
      refs.appIds.push(appId);
      refs.applications.push({
        id: appId,
        name: "",
        trackingCode: null,
        position: null,
        sources: [],
      });
    }
    const entry = refs.applications.find((a) => a.id === appId);
    if (entry && !entry.sources.includes(source)) entry.sources.push(source);
  };

  for (const pos of positions) {
    if (!pos.coverFileId) continue;
    const refs = ensure(pos.coverFileId);
    if (!refs.positions.some((p) => p.id === pos.id)) {
      refs.positions.push({ id: pos.id, title: pos.title });
    }
  }

  for (const app of applications) {
    const positionTitle = app.position?.title ?? null;
    const fillMeta = (fileId: string | null, source?: string): void => {
      if (!fileId) return;
      if (source) addAppSource(fileId, app.id, source);
      const refs = ensure(fileId);
      const entry = refs.applications.find((a) => a.id === app.id);
      if (entry) {
        entry.name = app.name;
        entry.trackingCode = app.trackingCode;
        entry.position = positionTitle;
      }
    };
    fillMeta(app.cvFileId, SOURCE_LABELS.cv);
    fillMeta(app.introFileId, SOURCE_LABELS.intro);
    for (const id of fileIdsFromJsonArray(app.extraDocs)) fillMeta(id, SOURCE_LABELS.extraDocs);
    for (const id of fileIdsFromJsonArray(app.onboardingDocs)) fillMeta(id, SOURCE_LABELS.onboardingDocs);
    for (const id of fileIdsFromJsonArray(app.botFiles)) fillMeta(id, SOURCE_LABELS.botFiles);
    for (const id of fileIdsFromJsonDeep(app.formAnswers)) fillMeta(id, SOURCE_LABELS.formAnswers);
  }

  for (const asmt of assessments) {
    if (!asmt.submittedFileId) continue;
    const refs = ensure(asmt.submittedFileId);
    if (!refs.assessments.some((a) => a.id === asmt.id)) {
      refs.assessments.push({ id: asmt.id, title: asmt.title });
    }
  }

  for (const doc of internalDocs) {
    const refs = ensure(doc.fileId);
    if (!refs.internalDocIds.includes(doc.id)) {
      refs.internalDocIds.push(doc.id);
      refs.internalDocs.push({ label: doc.label });
    }
  }

  for (const draft of drafts) {
    for (const id of fileIdsFromJsonArray(draft.files)) {
      const refs = ensure(id);
      if (!refs.draftTokens.includes(draft.token)) {
        refs.draftTokens.push(draft.token);
        refs.drafts.push({ email: draft.email });
      }
    }
  }

  for (const iv of interviews) {
    const fileId = fileIdFromUrl(iv.recordingUrl);
    if (!fileId) continue;
    const refs = ensure(fileId);
    if (!refs.interviewIds.includes(iv.id)) {
      refs.interviewIds.push(iv.id);
      refs.interviews += 1;
    }
  }

  return map;
}

/** True bila berkas tidak punya referensi apa pun (kandidat pembersihan). */
export function isOrphan(refs: FileRefDisplay | undefined): boolean {
  if (!refs) return true;
  return (
    refs.appIds.length === 0 &&
    refs.positions.length === 0 &&
    refs.assessments.length === 0 &&
    refs.internalDocIds.length === 0 &&
    refs.draftTokens.length === 0 &&
    refs.interviewIds.length === 0
  );
}

/**
 * Lepas SEMUA referensi non-FK untuk fileId (JSON lamaran, dokumen internal,
 * draft, rekaman wawancara). Relasi FK dibiarkan Prisma yang SetNull saat row dihapus.
 * Return jumlah referensi yang dilepas.
 */
export async function detachFileReferences(fileId: string): Promise<number> {
  const refs = (await collectFileRefs()).get(fileId);
  if (!refs) return 0;
  let detached = 0;

  // 1) JSON pada lamaran: extraDocs / onboardingDocs / botFiles / formAnswers.
  for (const appId of refs.appIds) {
    const app = await db.application.findUnique({
      where: { id: appId },
      select: { extraDocs: true, onboardingDocs: true, botFiles: true, formAnswers: true },
    });
    if (!app) continue;

    const stripArray = (raw: string): string | null => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return null;
        let changed = false;
        const filtered = parsed.filter((item) => {
          const id = item && typeof item === "object" && !Array.isArray(item)
            ? (item as Record<string, unknown>).fileId
            : undefined;
          if (id === fileId) {
            changed = true;
            return false;
          }
          return true;
        });
        return changed ? JSON.stringify(filtered) : null;
      } catch {
        return null;
      }
    };

    const data: Record<string, string> = {};
    for (const field of ["extraDocs", "onboardingDocs", "botFiles"] as const) {
      const next = stripArray(app[field]);
      if (next !== null) {
        data[field] = next;
        detached += 1;
      }
    }

    // formAnswers — ganti nilai jawaban file {fileId} menjadi null.
    if (app.formAnswers) {
      try {
        const parsed: unknown = JSON.parse(app.formAnswers);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          let changed = false;
          const obj = parsed as Record<string, unknown>;
          for (const [key, value] of Object.entries(obj)) {
            if (
              value &&
              typeof value === "object" &&
              !Array.isArray(value) &&
              (value as Record<string, unknown>).fileId === fileId
            ) {
              obj[key] = null;
              changed = true;
            }
          }
          if (changed) {
            data.formAnswers = JSON.stringify(obj);
            detached += 1;
          }
        }
      } catch {
        // JSON rusak — abaikan.
      }
    }

    if (Object.keys(data).length > 0) {
      await db.application.update({ where: { id: appId }, data });
    }
  }

  // 2) Dokumen internal — hapus barisnya (tak bermakna tanpa berkasnya).
  if (refs.internalDocIds.length > 0) {
    await db.internalDoc.deleteMany({ where: { id: { in: refs.internalDocIds } } });
    detached += refs.internalDocIds.length;
  }

  // 3) Draft wizard — buang entri berkas dari JSON files.
  for (const token of refs.draftTokens) {
    const draft = await db.applicationDraft.findUnique({ where: { token }, select: { files: true } });
    if (!draft) continue;
    const next = stripArray(draft.files);
    if (next !== null) {
      await db.applicationDraft.update({ where: { token }, data: { files: next } });
      detached += 1;
    }
  }

  // 4) Rekaman wawancara — kosongkan recordingUrl yang menunjuk berkas ini.
  if (refs.interviewIds.length > 0) {
    const result = await db.interview.updateMany({
      where: { id: { in: refs.interviewIds }, recordingUrl: { contains: fileId } },
      data: { recordingUrl: null },
    });
    detached += result.count;
  }

  return detached;
}

/** Hapus file fisik dari disk (plus varian .webp) — tidak pernah melempar error. */
export async function unlinkAssetFiles(assetPath: string): Promise<void> {
  const absolutePath = path.join(process.cwd(), assetPath);
  try {
    await unlink(absolutePath);
  } catch {
    // Sudah terhapus / tidak ada — abaikan.
  }
  try {
    await unlink(`${absolutePath}.webp`);
  } catch {
    // Varian tidak ada — abaikan.
  }
}
