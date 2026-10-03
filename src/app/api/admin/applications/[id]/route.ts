// PATCH  /api/admin/applications/[id] — update status/catatan/rating/tags/wawancara/talent pool/rubrik/checklist/catatan video
//        + fitur per pelamar NR-24: ekspektasi gaji, bintang personal (starred), HOLD
//        (holdReason/holdReviewAt), dan masa berlaku dokumen (docExpiries) (OWNER/HR).
// DELETE /api/admin/applications/[id] — pindahkan lamaran ke tong sampah (soft delete, OWNER/HR).
// Setiap perubahan dicatat ke ActivityLog. Perubahan tahap memicu webhook application.stage_changed.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  parseDocExpiries,
  parseRequirements,
  parseScoreRecord,
  parseTags,
  parseVideoNotes,
  serializeApplication,
} from "@/lib/seed";
import { isBuiltInStage } from "@/lib/stages";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { emitWebhook } from "@/lib/webhooks";
import { sendCandidateStatusEmail } from "@/lib/candidate-emails";
import { appendStageHistory } from "@/lib/stage-history";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

// Batas NR-24
const EXPECTED_SALARY_MAX = 1_000_000_000; // Rp 1 miliar — pelindung salah ketik
const HOLD_REASON_MAX = 300;
const DOC_EXPIRY_KEY_MAX = 64;
const DOC_EXPIRY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function labelOf(status: string): string {
  return isBuiltInStage(status) ? STATUS_LABELS[status as ApplicationStatus] : status;
}

function formatDateTimeId(value: Date): string {
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const updateData: {
      status?: string;
      offerStatus?: string | null;
      adminNotes?: string | null;
      rating?: number;
      tags?: string;
      interviewAt?: Date | null;
      talentPool?: boolean;
      rubricScores?: string | null;
      checklistState?: string;
      videoNotes?: string | null;
      stageUpdatedAt?: Date;
      stageHistory?: string;
      // NR-24 — fitur per pelamar
      expectedSalary?: number | null;
      starredBy?: string;
      holdReason?: string | null;
      holdReviewAt?: Date | null;
      docExpiries?: string | null;
    } = {};
    // Field yang perlu merge dengan nilai existing — dihitung setelah record diambil.
    let starredToggle: boolean | undefined;
    let docExpiryPatch: Record<string, string | null> | undefined;

    if (data.status !== undefined) {
      // Status/tahap menerima string apa pun (5 status bawaan ATAU tahap kustom posisi).
      if (typeof data.status !== "string") {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      const status = data.status.trim();
      if (!status || status.length > 40) {
        return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
      }
      updateData.status = status;
    }

    if (data.adminNotes !== undefined) {
      if (data.adminNotes === null) {
        updateData.adminNotes = null;
      } else if (typeof data.adminNotes === "string") {
        const notes = data.adminNotes.trim();
        updateData.adminNotes = notes.length > 0 ? notes : null;
      } else {
        return NextResponse.json({ error: "Catatan admin harus berupa teks." }, { status: 400 });
      }
    }

    if (data.rating !== undefined) {
      if (typeof data.rating !== "number" || !Number.isInteger(data.rating) || data.rating < 0 || data.rating > 5) {
        return NextResponse.json({ error: "Rating harus angka bulat 0-5." }, { status: 400 });
      }
      updateData.rating = data.rating;
    }

    if (data.tags !== undefined) {
      if (!Array.isArray(data.tags)) {
        return NextResponse.json({ error: "Tags harus berupa array teks." }, { status: 400 });
      }
      const tags = data.tags
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      updateData.tags = JSON.stringify(tags);
    }

    if (data.interviewAt !== undefined) {
      if (data.interviewAt === null) {
        updateData.interviewAt = null;
      } else if (typeof data.interviewAt === "string") {
        const parsed = new Date(data.interviewAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Tanggal wawancara tidak valid." }, { status: 400 });
        }
        updateData.interviewAt = parsed;
      } else {
        return NextResponse.json({ error: "Tanggal wawancara tidak valid." }, { status: 400 });
      }
    }

    if (data.talentPool !== undefined) {
      if (typeof data.talentPool !== "boolean") {
        return NextResponse.json({ error: "talentPool harus berupa boolean." }, { status: 400 });
      }
      updateData.talentPool = data.talentPool;
    }

    // Rubrik evaluasi: terima JSON string ATAU object {kriteria: nilai}.
    // Disanitasi: nilai integer 1..5, kriteria non-kosong maks 120 karakter, maks 8 entri.
    if (data.rubricScores !== undefined) {
      let raw: unknown = data.rubricScores;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return NextResponse.json(
            { error: "Rubrik tidak valid (JSON tidak bisa dibaca)." },
            { status: 400 }
          );
        }
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return NextResponse.json(
          { error: "Rubrik harus berupa objek {kriteria: nilai}." },
          { status: 400 }
        );
      }
      const scores: Record<string, number> = {};
      for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
        const key = rawKey.trim().slice(0, 120);
        if (!key || scores[key] !== undefined) continue;
        if (
          typeof rawValue !== "number" ||
          !Number.isInteger(rawValue) ||
          rawValue < 1 ||
          rawValue > 5
        ) {
          continue;
        }
        scores[key] = rawValue;
        if (Object.keys(scores).length >= 8) break;
      }
      updateData.rubricScores = Object.keys(scores).length > 0 ? JSON.stringify(scores) : null;
    }

    // Checklist evaluasi: terima JSON string ATAU array teks.
    // Disanitasi: maks 8 item, tiap item maks 120 karakter, tanpa duplikat.
    if (data.checklistState !== undefined) {
      let raw: unknown = data.checklistState;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return NextResponse.json(
            { error: "Checklist tidak valid (JSON tidak bisa dibaca)." },
            { status: 400 }
          );
        }
      }
      if (!Array.isArray(raw)) {
        return NextResponse.json(
          { error: "Checklist harus berupa array teks." },
          { status: 400 }
        );
      }
      const seen = new Set<string>();
      for (const item of raw) {
        if (typeof item !== "string") continue;
        const clean = item.trim().slice(0, 120);
        if (!clean || seen.has(clean)) continue;
        seen.add(clean);
        if (seen.size >= 8) break;
      }
      updateData.checklistState = JSON.stringify(Array.from(seen));
    }

    // Catatan video intro: terima array {t,note} (atau JSON string) lalu disanitasi
    // persis seperti parseVideoNotes di seed — maks 100 item, t int >= 0, note maks 300 char.
    if (data.videoNotes !== undefined) {
      let raw: unknown = data.videoNotes;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          // Biarkan string apa adanya — parseVideoNotes menoleransi JSON string tak terbaca.
        }
      }
      if (!Array.isArray(raw) && typeof raw !== "string") {
        return NextResponse.json(
          { error: "Catatan video harus berupa array {t, note}." },
          { status: 400 }
        );
      }
      const source = typeof raw === "string" ? raw : JSON.stringify(raw);
      const notes = parseVideoNotes(source);
      updateData.videoNotes = notes.length > 0 ? JSON.stringify(notes) : null;
    }

    // NR-24 — Ekspektasi gaji bulanan (Rp): null = hapus; number = integer 0..1 miliar.
    if (data.expectedSalary !== undefined) {
      if (data.expectedSalary === null) {
        updateData.expectedSalary = null;
      } else if (
        typeof data.expectedSalary === "number" &&
        Number.isInteger(data.expectedSalary) &&
        data.expectedSalary >= 0 &&
        data.expectedSalary <= EXPECTED_SALARY_MAX
      ) {
        updateData.expectedSalary = data.expectedSalary;
      } else {
        return NextResponse.json(
          { error: `Ekspektasi gaji harus angka bulat antara 0 dan ${EXPECTED_SALARY_MAX.toLocaleString("id-ID")}, atau null untuk menghapus.` },
          { status: 400 }
        );
      }
    }

    // NR-24 — Bintang personal per admin (toggle session.id pada kolom starredBy).
    if (data.starred !== undefined) {
      if (typeof data.starred !== "boolean") {
        return NextResponse.json({ error: "starred harus berupa boolean." }, { status: 400 });
      }
      starredToggle = data.starred;
    }

    // NR-24 — Tahan proses (HOLD): alasan singkat; string kosong = lepas tahanan.
    if (data.holdReason !== undefined) {
      if (data.holdReason === null) {
        updateData.holdReason = null;
      } else if (typeof data.holdReason === "string") {
        const reason = data.holdReason.trim();
        if (reason.length > HOLD_REASON_MAX) {
          return NextResponse.json(
            { error: `Alasan tahan proses maksimal ${HOLD_REASON_MAX} karakter.` },
            { status: 400 }
          );
        }
        updateData.holdReason = reason.length > 0 ? reason : null;
      } else {
        return NextResponse.json({ error: "Alasan tahan proses harus berupa teks." }, { status: 400 });
      }
    }

    // NR-24 — Tanggal review ulang HOLD: ISO string valid atau null (hapus jadwal).
    if (data.holdReviewAt !== undefined) {
      if (data.holdReviewAt === null) {
        updateData.holdReviewAt = null;
      } else if (typeof data.holdReviewAt === "string") {
        const parsed = new Date(data.holdReviewAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Tanggal review HOLD tidak valid." }, { status: 400 });
        }
        updateData.holdReviewAt = parsed;
      } else {
        return NextResponse.json({ error: "Tanggal review HOLD tidak valid." }, { status: 400 });
      }
    }

    // NR-24 — Masa berlaku dokumen tambahan: patch {fileId: "YYYY-MM-DD" | null}.
    // Digabung (merge) dengan map existing; null/false menghapus kunci; hasil kosong disimpan null.
    if (data.docExpiries !== undefined) {
      if (!data.docExpiries || typeof data.docExpiries !== "object" || Array.isArray(data.docExpiries)) {
        return NextResponse.json(
          { error: "Masa berlaku dokumen harus berupa objek {fileId: tanggal}." },
          { status: 400 }
        );
      }
      const patch: Record<string, string | null> = {};
      for (const [rawKey, rawValue] of Object.entries(data.docExpiries as Record<string, unknown>)) {
        const key = rawKey.trim();
        if (!key || key.length > DOC_EXPIRY_KEY_MAX) {
          return NextResponse.json(
            { error: `ID dokumen tidak valid (maksimal ${DOC_EXPIRY_KEY_MAX} karakter).` },
            { status: 400 }
          );
        }
        if (rawValue === null || rawValue === false) {
          patch[key] = null; // hapus kunci
        } else if (typeof rawValue === "string" && DOC_EXPIRY_DATE_RE.test(rawValue)) {
          patch[key] = rawValue;
        } else {
          return NextResponse.json(
            { error: `Tanggal masa berlaku untuk "${key.slice(0, 20)}" harus berformat YYYY-MM-DD.` },
            { status: 400 }
          );
        }
      }
      docExpiryPatch = patch;
    }

    const hasMergeFields = starredToggle !== undefined || docExpiryPatch !== undefined;
    if (Object.keys(updateData).length === 0 && !hasMergeFields) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Merge bintang personal: tambah/hapus session.id dari JSON string[] existing.
    if (starredToggle !== undefined) {
      const current = parseTags(existing.starredBy);
      const next = starredToggle
        ? current.includes(session.id)
          ? current
          : [...current, session.id]
        : current.filter((uid) => uid !== session.id);
      updateData.starredBy = JSON.stringify(next);
    }

    // Merge masa berlaku dokumen: map existing + patch; nilai null menghapus kunci.
    if (docExpiryPatch !== undefined) {
      const merged = parseDocExpiries(existing.docExpiries);
      for (const [key, value] of Object.entries(docExpiryPatch)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
      }
      updateData.docExpiries = Object.keys(merged).length > 0 ? JSON.stringify(merged) : null;
    }

    const stageChanged =
      updateData.status !== undefined && updateData.status !== existing.status;
    if (stageChanged && updateData.status) {
      // SLA per tahap: reset penanda waktu setiap kali tahap pipeline berubah.
      updateData.stageUpdatedAt = new Date();
      // Riwayat tahap (NR-15): catat perpindahan untuk timeline bertanggal pelamar.
      updateData.stageHistory = appendStageHistory(existing.stageHistory, updateData.status, existing.status);
    }

    // Tahap berubah ke Ditolak -> penawaran aktif otomatis dibatalkan agar halaman
    // status pelamar tidak lagi menampilkan kartu offer yang sudah tak relevan.
    if (
      updateData.status === "REJECTED" &&
      existing.status !== "REJECTED" &&
      existing.offerStatus === "PENDING"
    ) {
      updateData.offerStatus = null;
    }

    const updated = await db.application.update({
      where: { id },
      data: updateData,
      include: APPLICATION_INCLUDE,
    });

    // Catat setiap field yang berubah ke ActivityLog
    const logs: { actor: string; action: string; detail: string }[] = [];
    if (updateData.status !== undefined && updateData.status !== existing.status) {
      logs.push({
        actor: session.name,
        action: "STATUS_CHANGE",
        detail: `${labelOf(existing.status)} → ${labelOf(updateData.status)}`,
      });
    }
    if (updateData.offerStatus === null && existing.offerStatus === "PENDING") {
      logs.push({
        actor: session.name,
        action: "OFFER_CANCELLED",
        detail: "Penawaran aktif dibatalkan otomatis — lamaran ditolak",
      });
    }
    if (updateData.adminNotes !== undefined &&
      (updateData.adminNotes ?? "") !== (existing.adminNotes ?? "")) {
      logs.push({ actor: session.name, action: "NOTE", detail: "Catatan admin diperbarui" });
    }
    if (updateData.rating !== undefined && updateData.rating !== existing.rating) {
      logs.push({ actor: session.name, action: "RATING", detail: `Rating: ${existing.rating} → ${updateData.rating}` });
    }
    if (updateData.tags !== undefined && updateData.tags !== existing.tags) {
      const oldTags = parseTags(existing.tags).join(", ") || "-";
      const newTags = parseTags(updateData.tags).join(", ") || "-";
      logs.push({ actor: session.name, action: "TAGS", detail: `Tags: ${oldTags} → ${newTags}` });
    }
    if (updateData.interviewAt !== undefined) {
      const oldTime = existing.interviewAt ? existing.interviewAt.toISOString() : null;
      const newTime = updateData.interviewAt ? updateData.interviewAt.toISOString() : null;
      if (oldTime !== newTime) {
        logs.push({
          actor: session.name,
          action: "INTERVIEW_SCHEDULED",
          detail: updateData.interviewAt
            ? `Wawancara dijadwalkan ${formatDateTimeId(updateData.interviewAt)}`
            : "Jadwal wawancara dibatalkan",
        });
      }
    }
    if (updateData.talentPool !== undefined && updateData.talentPool !== existing.talentPool) {
      logs.push({
        actor: session.name,
        action: "TALENT_POOL",
        detail: updateData.talentPool ? "Ditambahkan ke talent pool" : "Dikeluarkan dari talent pool",
      });
    }
    if (updateData.rubricScores !== undefined && updateData.rubricScores !== existing.rubricScores) {
      const newScores = parseScoreRecord(updateData.rubricScores);
      logs.push({
        actor: session.name,
        action: "RUBRIC",
        detail: `Rubrik evaluasi diperbarui (${Object.keys(newScores ?? {}).length} kriteria dinilai)`,
      });
    }
    if (updateData.checklistState !== undefined && updateData.checklistState !== existing.checklistState) {
      const newItems = parseRequirements(updateData.checklistState);
      logs.push({
        actor: session.name,
        action: "CHECKLIST",
        detail: `Checklist evaluasi: ${newItems.length} item tercentang`,
      });
    }
    if (updateData.videoNotes !== undefined && updateData.videoNotes !== existing.videoNotes) {
      const newNotes = parseVideoNotes(updateData.videoNotes);
      logs.push({
        actor: session.name,
        action: "NOTE",
        detail: `Catatan video diperbarui (${newNotes.length} catatan)`,
      });
    }

    // NR-24 — log fitur per pelamar (hanya bila nilai benar-benar berubah)
    if (updateData.expectedSalary !== undefined && updateData.expectedSalary !== existing.expectedSalary) {
      logs.push({
        actor: session.name,
        action: "SALARY_EXPECTATION",
        detail: updateData.expectedSalary === null
          ? "Ekspektasi gaji dihapus"
          : `Ekspektasi gaji diatur: Rp ${updateData.expectedSalary.toLocaleString("id-ID")}`,
      });
    }
    if (updateData.starredBy !== undefined) {
      const wasStarred = parseTags(existing.starredBy).includes(session.id);
      const nowStarred = parseTags(updateData.starredBy).includes(session.id);
      if (nowStarred !== wasStarred) {
        logs.push(
          nowStarred
            ? { actor: session.name, action: "STAR", detail: `Ditandai penting oleh ${session.name}` }
            : { actor: session.name, action: "UNSTAR", detail: `Bintang dilepas (${session.name})` }
        );
      }
    }
    if (updateData.holdReason !== undefined && updateData.holdReason !== existing.holdReason) {
      logs.push(
        updateData.holdReason
          ? { actor: session.name, action: "HOLD_SET", detail: `Proses ditahan: ${updateData.holdReason}` }
          : { actor: session.name, action: "HOLD_CLEAR", detail: "Tahan proses dilepas" }
      );
    }
    if (updateData.holdReviewAt !== undefined) {
      const oldReview = existing.holdReviewAt ? existing.holdReviewAt.toISOString() : null;
      const newReview = updateData.holdReviewAt ? updateData.holdReviewAt.toISOString() : null;
      if (oldReview !== newReview) {
        logs.push(
          updateData.holdReviewAt
            ? {
                actor: session.name,
                action: "HOLD_REVIEW",
                detail: `Review HOLD dijadwalkan ${formatDateTimeId(updateData.holdReviewAt)}`,
              }
            : { actor: session.name, action: "HOLD_REVIEW_CLEARED", detail: "Jadwal review HOLD dihapus" }
        );
      }
    }
    if (updateData.docExpiries !== undefined && updateData.docExpiries !== existing.docExpiries) {
      const entryCount = Object.keys(parseDocExpiries(updateData.docExpiries)).length;
      logs.push({
        actor: session.name,
        action: "DOC_EXPIRY",
        detail: `Masa berlaku dokumen diperbarui (${entryCount} entri)`,
      });
    }
    if (logs.length > 0) {
      await db.activityLog.createMany({
        data: logs.map((log) => ({ ...log, applicationId: id })),
      });
    }

    // Webhook keluar: tahap pelamar berubah — fire-and-forget ke endpoint berlangganan.
    if (stageChanged) {
      await emitWebhook("application.stage_changed", {
        id,
        name: existing.name,
        from: existing.status,
        to: updateData.status,
      });
      // Email otomatis ke kandidat saat status berubah (template per status,
      // bisa dimatikan dari Setelan). Fire-and-forget — tidak pernah melempar error.
      void sendCandidateStatusEmail({
        applicationId: id,
        name: existing.name,
        email: existing.email,
        trackingCode: existing.trackingCode,
        toStatus: updateData.status as string,
        positionTitle: updated.position?.title ?? null,
        origin: req.headers.get("origin") ?? undefined,
      });
    }

    // Realtime: perubahan lamaran (status/catatan/wawancara) disebarkan ke semua admin
    // dan ke publik (pembaruan status pelacakan tanpa refresh).
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(serializeApplication(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/applications/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui lamaran. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Soft delete: lamaran masuk tong sampah (deletedAt terisi), data tidak hilang.
    await db.application.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    // Realtime: lamaran dihapus — segarkan daftar admin & statistik.
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, trashed: true });
  } catch (error) {
    console.error("[DELETE /api/admin/applications/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
