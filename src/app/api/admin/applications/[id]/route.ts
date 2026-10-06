// PATCH  /api/admin/applications/[id] — update status/catatan/rating/tags/wawancara/talent pool/rubrik/checklist/catatan video
//        + NR-24: bintang personal, tindak lanjut (snooze), ekspektasi gaji, HOLD, masa berlaku dokumen (OWNER/HR).
// DELETE /api/admin/applications/[id] — pindahkan lamaran ke tong sampah (soft delete, OWNER/HR).
// Setiap perubahan dicatat ke ActivityLog. Perubahan tahap memicu webhook application.stage_changed.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  maskApplicationForViewer,
  parseDocExpiries,
  parseRequirements,
  parseScoreRecord,
  parseStarredBy,
  parseTags,
  parseVideoNotes,
  serializeApplication,
} from "@/lib/seed";
import { isBuiltInStage } from "@/lib/stages";
import { HOLD_REASONS, STATUS_LABELS, type ApplicationStatus } from "@/lib/types";
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

// NR38-C fitur 1 — GET detail lamaran: dipakai dialog detail saat membuka satu
// lamaran. Efek samping: adminSeenAt diisi "now" BILA masih null (tandai sudah
// dilihat — dasar filter "Belum dilihat" di daftar). Write kecil tidak menahan
// respons; kegagalan diabaikan. Payload = serializeApplication + field tambahan
// aditif (adminSeenAt, screeningVerdicts, cvSummary, cvSummaryAt).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const record = await db.application.findUnique({
      where: { id },
      include: APPLICATION_INCLUDE,
    });
    if (!record || record.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const seenAt = record.adminSeenAt ?? new Date();
    if (!record.adminSeenAt) {
      void db.application
        .update({ where: { id }, data: { adminSeenAt: seenAt } })
        .catch(() => {
          // Penandaan dilihat bersifat pelengkap — abaikan kegagalan.
        });
    }

    const payload = {
      ...serializeApplication(record),
      adminSeenAt: seenAt.toISOString(),
      screeningVerdicts: record.screeningVerdicts ?? null,
      cvSummary: record.cvSummary ?? null,
      cvSummaryAt: record.cvSummaryAt ? record.cvSummaryAt.toISOString() : null,
    };

    // VIEWER: mask PII (phone & CV) konsisten dengan level respons list.
    return NextResponse.json(
      session.role === "VIEWER" ? maskApplicationForViewer(payload) : payload
    );
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]]", error);
    return NextResponse.json({ error: "Gagal memuat detail lamaran. Coba lagi nanti." }, { status: 500 });
  }
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

    // Muat lamaran lebih awal — validasi bintang/hold memerlukan nilai lama.
    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

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
      starredBy?: string;
      followUpAt?: Date | null;
      salaryExpectation?: number | null;
      holdAt?: Date | null;
      holdReason?: string | null;
      holdNote?: string | null;
      holdReviewAt?: Date | null;
      holdClear?: boolean;
      docExpiries?: string;
      screeningVerdicts?: string | null; // NR38-C — verdict admin per jawaban screening
    };
    // Field yang perlu merge dengan nilai existing — dihitung setelah record diambil.
    let starredToggle: boolean | undefined;

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

    if (data.star !== undefined) {
      // Bintang personal per admin (NR-24): id admin diambil dari sesi, bukan dari body.
      if (typeof data.star !== "boolean") {
        return NextResponse.json({ error: "Nilai bintang tidak valid." }, { status: 400 });
      }
      const starred = parseStarredBy(existing.starredBy);
      const next = data.star
        ? [...new Set([...starred, session.id])]
        : starred.filter((sid) => sid !== session.id);
      updateData.starredBy = JSON.stringify(next);
    }

    if (data.followUpAt !== undefined) {
      if (data.followUpAt === null || data.followUpAt === "") {
        updateData.followUpAt = null;
      } else if (typeof data.followUpAt === "string") {
        const parsed = new Date(data.followUpAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Tanggal tindak lanjut tidak valid." }, { status: 400 });
        }
        updateData.followUpAt = parsed;
      } else {
        return NextResponse.json({ error: "Tanggal tindak lanjut tidak valid." }, { status: 400 });
      }
    }

    if (data.salaryExpectation !== undefined) {
      if (data.salaryExpectation === null || data.salaryExpectation === "") {
        updateData.salaryExpectation = null;
      } else if (typeof data.salaryExpectation === "number" && Number.isInteger(data.salaryExpectation)) {
        if (data.salaryExpectation < 0 || data.salaryExpectation > 1_000_000_000) {
          return NextResponse.json({ error: "Ekspektasi gaji di luar rentang wajar." }, { status: 400 });
        }
        updateData.salaryExpectation = data.salaryExpectation;
      } else {
        return NextResponse.json({ error: "Ekspektasi gaji harus angka bulat (rupiah)." }, { status: 400 });
      }
    }

    // HOLD (NR-24): {holdReason, holdNote?, holdReviewAt?} untuk menahan;
    // {holdClear: true} untuk melepas. Tidak mengubah tahap pipeline.
    if (data.holdClear === true) {
      updateData.holdAt = null;
      updateData.holdReason = null;
      updateData.holdNote = null;
      updateData.holdReviewAt = null;
    } else if (data.holdReason !== undefined) {
      if (typeof data.holdReason !== "string" || !(HOLD_REASONS as string[]).includes(data.holdReason)) {
        return NextResponse.json({ error: "Alasan hold tidak valid." }, { status: 400 });
      }
      updateData.holdReason = data.holdReason;
      updateData.holdAt = existing.holdAt ?? new Date();
      if (data.holdNote !== undefined) {
        if (data.holdNote === null || data.holdNote === "") {
          updateData.holdNote = null;
        } else if (typeof data.holdNote === "string") {
          updateData.holdNote = data.holdNote.trim().slice(0, 300) || null;
        } else {
          return NextResponse.json({ error: "Catatan hold tidak valid." }, { status: 400 });
        }
      }
      if (data.holdReviewAt !== undefined) {
        if (data.holdReviewAt === null || data.holdReviewAt === "") {
          updateData.holdReviewAt = null;
        } else if (typeof data.holdReviewAt === "string") {
          const parsed = new Date(data.holdReviewAt);
          if (Number.isNaN(parsed.getTime())) {
            return NextResponse.json({ error: "Tanggal review hold tidak valid." }, { status: 400 });
          }
          updateData.holdReviewAt = parsed;
        } else {
          return NextResponse.json({ error: "Tanggal review hold tidak valid." }, { status: 400 });
        }
      }
    }

    // Masa berlaku dokumen (NR-24): array {label, expiresAt} -> JSON tersanitasi.
    if (data.docExpiries !== undefined) {
      let raw: unknown = data.docExpiries;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return NextResponse.json({ error: "Masa berlaku dokumen tidak valid." }, { status: 400 });
        }
      }
      if (!Array.isArray(raw)) {
        return NextResponse.json({ error: "Masa berlaku dokumen harus berupa array." }, { status: 400 });
      }
      const items = raw
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .filter((item) => typeof item.label === "string" && item.label.trim())
        .map((item, i) => ({
          id: typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 40) : `d${i}`,
          label: (item.label as string).trim().slice(0, 60),
          expiresAt:
            typeof item.expiresAt === "string" && !Number.isNaN(new Date(item.expiresAt).getTime())
              ? new Date(item.expiresAt).toISOString()
              : "",
        }))
        .filter((item) => item.expiresAt !== "");
      updateData.docExpiries = JSON.stringify(items.slice(0, 20));
    }

    // NR38-C — verdict screening: JSON {questionId: "PASS"|"WARN"|"FAIL"}.
    // Klien mengirim rekaman lengkap hasil merge (verdict lama dipertahankan
    // berdasarkan id pertanyaan di sisi klien); server hanya menyanitasi.
    if (data.screeningVerdicts !== undefined) {
      let raw: unknown = data.screeningVerdicts;
      if (typeof raw === "string") {
        try {
          raw = JSON.parse(raw);
        } catch {
          return NextResponse.json({ error: "Verdict screening tidak valid." }, { status: 400 });
        }
      }
      if (raw === null) {
        updateData.screeningVerdicts = null;
      } else {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          return NextResponse.json(
            { error: "Verdict screening harus berupa objek {questionId: verdict}." },
            { status: 400 }
          );
        }
        const VERDICT_VALUES = new Set(["PASS", "WARN", "FAIL"]);
        const verdicts: Record<string, string> = {};
        for (const [rawKey, rawValue] of Object.entries(raw as Record<string, unknown>)) {
          const key = rawKey.trim().slice(0, 60);
          if (!key || verdicts[key] !== undefined) continue;
          if (typeof rawValue !== "string" || !VERDICT_VALUES.has(rawValue)) continue;
          verdicts[key] = rawValue;
          if (Object.keys(verdicts).length >= 40) break;
        }
        updateData.screeningVerdicts =
          Object.keys(verdicts).length > 0 ? JSON.stringify(verdicts) : null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
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
    // NR-24 — log fitur per pelamar
    if (updateData.starredBy !== undefined && updateData.starredBy !== existing.starredBy) {
      const nowStarred = parseStarredBy(updateData.starredBy).includes(session.id);
      logs.push({
        actor: session.name,
        action: "STAR",
        detail: nowStarred ? "Ditandai bintang (pin penting)" : "Bintang dilepas",
      });
    }
    if (updateData.followUpAt !== undefined) {
      const oldFollow = existing.followUpAt ? existing.followUpAt.toISOString() : null;
      const newFollow = updateData.followUpAt ? updateData.followUpAt.toISOString() : null;
      if (oldFollow !== newFollow) {
        logs.push({
          actor: session.name,
          action: "FOLLOWUP",
          detail: updateData.followUpAt
            ? `Tindak lanjut dijadwalkan ${formatDateTimeId(updateData.followUpAt)}`
            : "Tanggal tindak lanjut dihapus",
        });
      }
    }
    if (updateData.salaryExpectation !== undefined &&
      updateData.salaryExpectation !== existing.salaryExpectation) {
      const fmt = (v: number | null | undefined) =>
        v == null ? "-" : `Rp ${v.toLocaleString("id-ID")}`;
      logs.push({
        actor: session.name,
        action: "SALARY_EXPECTATION",
        detail: `Ekspektasi gaji: ${fmt(existing.salaryExpectation)} → ${fmt(updateData.salaryExpectation)}`,
      });
    }
    if (data.holdClear === true && existing.holdAt) {
      logs.push({
        actor: session.name,
        action: "HOLD",
        detail: "Tahanan lamaran dilepas (lanjut proses normal)",
      });
    } else if (updateData.holdReason !== undefined && updateData.holdReason !== existing.holdReason) {
      logs.push({
        actor: session.name,
        action: "HOLD",
        detail: `Lamaran ditahan (${data.holdReason})${updateData.holdReviewAt ? ` — review ${formatDateTimeId(updateData.holdReviewAt)}` : ""}`,
      });
    }
    if (updateData.docExpiries !== undefined && updateData.docExpiries !== existing.docExpiries) {
      const newDocs = parseDocExpiries(updateData.docExpiries);
      logs.push({
        actor: session.name,
        action: "DOC_EXPIRY",
        detail: `Masa berlaku dokumen diperbarui (${newDocs.length} dokumen terlacak)`,
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
    if (updateData.salaryExpectation !== undefined && updateData.salaryExpectation !== existing.salaryExpectation) {
      logs.push({
        actor: session.name,
        action: "SALARY_EXPECTATION",
        detail: updateData.salaryExpectation === null
          ? "Ekspektasi gaji dihapus"
          : `Ekspektasi gaji diatur: Rp ${updateData.salaryExpectation.toLocaleString("id-ID")}`,
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
    // snoozeUntil (snooze bot Telegram) dikelola langsung oleh bot via db —
    // bukan bagian dari PATCH admin, sehingga tidak perlu log di sini.
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
