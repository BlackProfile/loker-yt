// NR-41 G11 — GET /api/admin/data-health — laporan kesehatan data (OWNER/HR).
// Memeriksa 8 kelas masalah kualitas data (DataHealthReport di types.ts):
//   INVALID_EMAIL, ORPHAN_DISK, ORPHAN_FILE, NO_POSITION, EXPIRED_DOC,
//   STALE_DRAFT, DUPLICATE_PAIR, UNCONFIRMED_SUBSCRIBER.
// Setiap issue: count + maks 5 sampel identitas (tanpa PII mentah — email penuh
// aman di sini karena endpoint dipagari role). ok=true bila semua bersih.
import { readdirSync } from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";
import type { DataHealthReport } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FINAL_STATUSES = ["REJECTED", "ACCEPTED", "HIRED"];
const SAMPLE_MAX = 5;

type IssueReport = DataHealthReport["issues"][number];

/** Issue + jumlah sebenarnya (sampel hanya 5 pertama). */
function issueWithCount(
  code: string,
  label: string,
  severity: IssueReport["severity"],
  samples: string[],
  count: number,
): IssueReport {
  return { code, label, severity, count, sample: samples.slice(0, SAMPLE_MAX) };
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await requireRole(["OWNER", "HR", "VIEWER"]);
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const now = new Date();
    const issues: IssueReport[] = [];

    /* 1) INVALID_EMAIL — format email lamaran tidak memenuhi pola sederhana. */
    const appsBasic = await db.application.findMany({
      where: { deletedAt: null },
      select: { id: true, email: true },
    });
    const badEmails = appsBasic
      .filter((app) => !EMAIL_REGEX.test((app.email ?? "").trim()))
      .map((app) => app.email || app.id);
    if (badEmails.length > 0) {
      issues.push(issueWithCount("INVALID_EMAIL", "Format email lamaran tidak valid", "WARN", badEmails, badEmails.length));
    }

    /* 2) ORPHAN_DISK — berkas fisik di uploads/ tanpa row FileAsset. */
    try {
      const uploadsDir = path.join(process.cwd(), "uploads");
      let diskNames: string[] = [];
      try {
        diskNames = readdirSync(uploadsDir).filter((name) => !name.startsWith("."));
      } catch {
        diskNames = []; // folder belum ada — bukan masalah
      }
      const assets = await db.fileAsset.findMany({ select: { path: true } });
      const known = new Set(assets.map((asset) => asset.path.split("/").pop() ?? ""));
      const orphans = diskNames.filter((name) => !known.has(name));
      if (orphans.length > 0) {
        issues.push(issueWithCount("ORPHAN_DISK", "Berkas di disk tanpa catatan FileAsset", "WARN", orphans, orphans.length));
      }
    } catch (error) {
      console.error("[data-health] ORPHAN_DISK gagal:", error);
    }

    /* 3) ORPHAN_FILE — FileAsset tidak direferensikan di mana pun
     *    (subset utama: cvFileId, introFileId, cover posisi, assessment,
     *    internal doc, dokumen JSON lamaran). */
    const assetsAll = await db.fileAsset.findMany({ select: { id: true, filename: true } });
    const [cvIds, introIds, coverIds, assessmentIds, internalDocIds] = await Promise.all([
      db.application.findMany({ where: { cvFileId: { not: null } }, select: { cvFileId: true } }),
      db.application.findMany({ where: { introFileId: { not: null } }, select: { introFileId: true } }),
      db.position.findMany({ where: { coverFileId: { not: null } }, select: { coverFileId: true } }),
      db.assessment.findMany({ where: { submittedFileId: { not: null } }, select: { submittedFileId: true } }),
      db.internalDoc.findMany({ select: { fileId: true } }),
    ]);
    const referenced = new Set<string>();
    for (const row of cvIds) if (row.cvFileId) referenced.add(row.cvFileId);
    for (const row of introIds) if (row.introFileId) referenced.add(row.introFileId);
    for (const row of coverIds) if (row.coverFileId) referenced.add(row.coverFileId);
    for (const row of assessmentIds) if (row.submittedFileId) referenced.add(row.submittedFileId);
    for (const row of internalDocIds) referenced.add(row.fileId);
    // Dokumen JSON pada lamaran (extraDocs/onboardingDocs/botFiles) — murah.
    const appsJson = await db.application.findMany({
      select: { extraDocs: true, onboardingDocs: true, botFiles: true },
    });
    const fileIdFromJson = (raw: string): string[] => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        const ids: string[] = [];
        for (const item of parsed) {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            const id = (item as Record<string, unknown>).fileId;
            if (typeof id === "string") ids.push(id);
          }
        }
        return ids;
      } catch {
        return [];
      }
    };
    for (const app of appsJson) {
      for (const id of [...fileIdFromJson(app.extraDocs), ...fileIdFromJson(app.onboardingDocs), ...fileIdFromJson(app.botFiles)]) {
        referenced.add(id);
      }
    }
    const orphanAssets = assetsAll.filter((asset) => !referenced.has(asset.id));
    if (orphanAssets.length > 0) {
      issues.push(
        issueWithCount(
          "ORPHAN_FILE",
          "FileAsset tidak direferensikan lamaran/posisi mana pun",
          "WARN",
          orphanAssets.map((asset) => asset.filename || asset.id),
          orphanAssets.length,
        ),
      );
    }

    /* 4) NO_POSITION — lamaran aktif tanpa posisi (positionId null). */
    const noPosition = await db.application.findMany({
      where: { deletedAt: null, positionId: null, status: { notIn: FINAL_STATUSES } },
      select: { id: true, name: true },
      take: 50,
    });
    if (noPosition.length > 0) {
      issues.push(
        issueWithCount(
          "NO_POSITION",
          "Lamaran aktif tanpa posisi",
          "WARN",
          noPosition.map((app) => `${app.name} (${app.id})`),
          noPosition.length,
        ),
      );
    }

    /* 5) EXPIRED_DOC — masa berlaku dokumen (docExpiries) sudah lewat. */
    const appsWithDocs = await db.application.findMany({
      where: { deletedAt: null, docExpiries: { not: "[]" } },
      select: { id: true, trackingCode: true, docExpiries: true },
    });
    const expiredDocs: string[] = [];
    for (const app of appsWithDocs) {
      try {
        const parsed: unknown = JSON.parse(app.docExpiries);
        if (!Array.isArray(parsed)) continue;
        for (const item of parsed) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const doc = item as Record<string, unknown>;
          const label = typeof doc.label === "string" ? doc.label : "dokumen";
          const expiresAt = typeof doc.expiresAt === "string" ? Date.parse(doc.expiresAt) : NaN;
          if (Number.isFinite(expiresAt) && expiresAt < now.getTime()) {
            expiredDocs.push(`${label} — ${app.trackingCode ?? app.id}`);
          }
        }
      } catch {
        // JSON rusak dilewati
      }
    }
    if (expiredDocs.length > 0) {
      issues.push(issueWithCount("EXPIRED_DOC", "Dokumen dengan masa berlaku lewat", "WARN", expiredDocs, expiredDocs.length));
    }

    /* 6) STALE_DRAFT — draft wizard kedaluwarsa lebih dari 7 hari. */
    const staleCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const staleDrafts = await db.applicationDraft.findMany({
      where: { expiresAt: { lt: staleCutoff } },
      select: { id: true, email: true, expiresAt: true },
      take: 50,
    });
    if (staleDrafts.length > 0) {
      issues.push(
        issueWithCount(
          "STALE_DRAFT",
          "Draft lamaran kedaluwarsa lebih dari 7 hari",
          "INFO",
          staleDrafts.map((draft) => draft.id),
          staleDrafts.length,
        ),
      );
    }

    /* 7) DUPLICATE_PAIR — penanda duplikat tanpa rujukan sumber. */
    const brokenDup = await db.application.findMany({
      where: { isDuplicate: true, duplicateOfId: null, mergedIntoId: null, deletedAt: null },
      select: { id: true, trackingCode: true },
      take: 50,
    });
    if (brokenDup.length > 0) {
      issues.push(
        issueWithCount(
          "DUPLICATE_PAIR",
          "Lamaran ditandai duplikat tanpa lamaran sumber",
          "INFO",
          brokenDup.map((app) => app.trackingCode ?? app.id),
          brokenDup.length,
        ),
      );
    }

    /* 8) UNCONFIRMED_SUBSCRIBER — pelanggan lama (>7 hari) belum konfirmasi. */
    const subscriberCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const unconfirmed = await db.subscriber.findMany({
      where: { confirmedAt: null, createdAt: { lt: subscriberCutoff } },
      select: { email: true, createdAt: true },
      take: 50,
    });
    if (unconfirmed.length > 0) {
      issues.push(
        issueWithCount(
          "UNCONFIRMED_SUBSCRIBER",
          "Pelanggan belum konfirmasi langganan lebih dari 7 hari",
          "INFO",
          unconfirmed.map((row) => row.email),
          unconfirmed.length,
        ),
      );
    }

    const report: DataHealthReport = {
      checkedAt: now.toISOString(),
      issues,
      ok: issues.every((item) => item.count === 0),
    };
    return NextResponse.json(report);
  } catch (error) {
    console.error("[GET /api/admin/data-health]", error);
    return NextResponse.json({ error: "Gagal memeriksa kesehatan data. Coba lagi nanti." }, { status: 500 });
  }
}
