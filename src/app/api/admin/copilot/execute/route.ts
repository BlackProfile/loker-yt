// POST /api/admin/copilot/execute — eksekusi aksi usulan Copilot Admin (NR49 Paket B).
// VERIFIKASI SERVER KETAT: UI tidak dipercaya sama sekali. Tipe aksi di-whitelist,
// izin dicek ulang lewat matriks (can()), seluruh param divalidasi + di-clamp, dan
// setiap perubahan tercatat di ActivityLog dengan aktor "<nama> (Copilot)".
// Tidak memakai AI — AiGateError tidak relevan di sini.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { appendStageHistory } from "@/lib/stage-history";
import { categoryForStage, stageLabel, stagesForPosition } from "@/lib/stages";
import { parseStarredBy, parseStageCategories } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { getSession } from "@/lib/server-auth";
import { can } from "@/lib/permissions";
import { rejectionStageForPosition } from "@/lib/copilot-context";
import { type PermissionActionKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const BULK_LIMIT = 200;
const BULK_SCAN_LIMIT = 500;

/** Error berstatus HTTP untuk alur pesan Indonesia yang rapi. */
class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Izin matriks yang mengatur tiap tipe aksi (sumber kebenaran: permissions.ts). */
const ACTION_PERMISSIONS: Record<string, PermissionActionKey> = {
  set_application_status: "kelola_lamaran",
  toggle_position: "kelola_posisi",
  bulk_reject_stale: "kelola_lamaran",
};

function asSafeString(value: unknown, maxLen: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLen) : "";
}

/** Resolve boolean longgar untuk params (1/0, "true"/"false", boolean). */
function asBooleanOrUndefined(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "buka", "ya"].includes(v)) return true;
    if (["0", "false", "tutup", "tidak"].includes(v)) return false;
  }
  return undefined;
}

/** Ubah status satu lamaran (izin kelola_lamaran sudah dicek pemanggil). */
async function executeSetApplicationStatus(
  actor: string,
  params: Record<string, unknown>,
): Promise<{ message: string }> {
  const applicationId = asSafeString(params.applicationId, 64);
  const status = asSafeString(params.status, 40);
  if (!applicationId || !status) {
    throw new HttpError(400, "Parameter aksi tidak lengkap (applicationId dan status wajib).");
  }

  const application = await db.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      name: true,
      status: true,
      stageHistory: true,
      offerStatus: true,
      hiredAt: true,
      rejectionReason: true,
      rejectionNote: true,
      deletedAt: true,
      position: { select: { title: true, stages: true, stageCategories: true } },
    },
  });
  if (!application || application.deletedAt) {
    throw new HttpError(404, "Lamaran tidak ditemukan.");
  }

  const currentStatus = application.status.trim() || "NEW";
  if (currentStatus === status) {
    throw new HttpError(400, `Lamaran sudah berada di tahap "${stageLabel(status)}".`);
  }

  // Status harus sah untuk posisi lamaran tersebut (bawaan ATAU tahap kustom).
  const rawStages = application.position?.stages ?? null;
  const validStages = stagesForPosition(
    (() => {
      if (!rawStages) return null;
      try {
        const parsed: unknown = JSON.parse(rawStages);
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : null;
      } catch {
        return null;
      }
    })(),
  );
  if (!validStages.includes(status)) {
    throw new HttpError(
      400,
      `Status "${stageLabel(status)}" tidak valid untuk posisi ${
        application.position?.title ?? "(tanpa posisi)"
      }. Pilihan yang sah: ${validStages.map((s) => stageLabel(s)).join(", ")}.`,
    );
  }

  // Gerbang kategori (konsisten dengan rute PATCH lamaran agar Copilot tidak
  // menjadi celah pintu belakang aturan pipeline).
  const category = categoryForStage(
    status,
    parseStageCategories(application.position?.stageCategories ?? null),
  );
  const updateData: {
    status: string;
    stageUpdatedAt: Date;
    stageHistory: string;
    rejectionReason?: string;
    rejectionNote?: string;
    rejectedAt?: Date;
    offerStatus?: null;
  } = {
    status,
    stageUpdatedAt: new Date(),
    stageHistory: appendStageHistory(application.stageHistory, status, currentStatus),
  };

  if (category === "INTERVIEW") {
    const activeInterviews = await db.interview.count({
      where: { applicationId, status: { not: "CANCELLED" } },
    });
    if (activeInterviews === 0) {
      // interviewAt lama juga diakui (pola rute PATCH).
      const legacy = await db.application.findUnique({
        where: { id: applicationId },
        select: { interviewAt: true },
      });
      if (!legacy?.interviewAt) {
        throw new HttpError(
          400,
          "Jadwalkan sesi wawancara terlebih dahulu sebelum memindahkan kandidat ke tahap wawancara.",
        );
      }
    }
  } else if (category === "ACCEPTED") {
    if (application.offerStatus !== "ACCEPTED" && !application.hiredAt) {
      throw new HttpError(
        400,
        "Pindah ke tahap diterima hanya boleh melalui penawaran yang diterima pelamar. Kirim offer terlebih dahulu.",
      );
    }
  } else if (category === "REJECTED") {
    if (!application.rejectionReason) {
      updateData.rejectionReason = "LAINNYA";
      updateData.rejectionNote = application.rejectionNote?.trim()
        ? application.rejectionNote
        : "Ditolak via Copilot.";
      updateData.rejectedAt = new Date();
    }
    // Offer aktif otomatis dibatalkan saat pindah ke Ditolak (pola rute PATCH).
    if (application.offerStatus === "PENDING") {
      updateData.offerStatus = null;
    }
  }

  await db.application.update({ where: { id: applicationId }, data: updateData });
  await db.activityLog.create({
    data: {
      applicationId,
      actor,
      action: "COPILOT_ACTION",
      detail: `Status diubah ke ${stageLabel(status)} via Copilot`,
    },
  });
  void emitRealtime(REALTIME_EVENTS.applications);

  return { message: `Status lamaran ${application.name} diubah ke ${stageLabel(status)}.` };
}

/** Buka/tutup satu posisi (izin kelola_posisi sudah dicek pemanggil). */
async function executeTogglePosition(
  actor: string,
  params: Record<string, unknown>,
): Promise<{ message: string }> {
  const positionId = asSafeString(params.positionId, 64);
  if (!positionId) {
    throw new HttpError(400, "Parameter aksi tidak lengkap (positionId wajib).");
  }

  const position = await db.position.findUnique({
    where: { id: positionId },
    select: { id: true, title: true, isActive: true },
  });
  if (!position) {
    throw new HttpError(404, "Posisi tidak ditemukan.");
  }

  const active = asBooleanOrUndefined(params.active) ?? !position.isActive;
  if (active === position.isActive) {
    return {
      message: `Posisi ${position.title} sudah dalam keadaan ${active ? "terbuka" : "ditutup"}.`,
    };
  }

  await db.position.update({ where: { id: positionId }, data: { isActive: active } });
  await db.activityLog.create({
    data: {
      actor,
      action: "COPILOT_ACTION",
      detail: `Posisi ${position.title} ${active ? "dibuka" : "ditutup"} via Copilot`,
    },
  });
  void emitRealtime(REALTIME_EVENTS.positions);

  return { message: `Posisi ${position.title} ${active ? "dibuka" : "ditutup"}.` };
}

/**
 * Tolak massal lamaran NEW yang belum pernah dilihat admin (izin kelola_lamaran).
 * Kriteria: status "NEW", adminSeenAt null, rating 0, tidak dibintangi, lebih tua
 * dari N hari (14-120), bukan di tong sampah. Maks 200 lamaran per eksekusi.
 * Setiap lamaran dipindah ke tahap penolakan yang SAH untuk posisinya (bawaan
 * "REJECTED" atau tahap kustom berkategori REJECTED), dengan alasan "LAINNYA".
 */
async function executeBulkRejectStale(
  actor: string,
  params: Record<string, unknown>,
): Promise<{ message: string }> {
  const rawDays = Number(params.days);
  if (!Number.isFinite(rawDays)) {
    throw new HttpError(400, "Parameter days wajib berupa angka (14-120 hari).");
  }
  const days = Math.min(120, Math.max(14, Math.round(rawDays)));
  const positionId = asSafeString(params.positionId, 64);

  if (positionId) {
    const position = await db.position.findUnique({
      where: { id: positionId },
      select: { id: true },
    });
    if (!position) {
      throw new HttpError(404, "Posisi tidak ditemukan.");
    }
  }

  const cutoff = new Date(Date.now() - days * DAY_MS);
  const candidates = await db.application.findMany({
    where: {
      status: "NEW",
      adminSeenAt: null,
      rating: 0,
      createdAt: { lt: cutoff },
      deletedAt: null,
      ...(positionId ? { positionId } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: BULK_SCAN_LIMIT,
    select: {
      id: true,
      stageHistory: true,
      starredBy: true,
      position: { select: { stages: true, stageCategories: true } },
    },
  });

  const now = new Date();
  const targets: { id: string; stageHistory: string; targetStage: string }[] = [];
  for (const app of candidates) {
    if (targets.length >= BULK_LIMIT) break;
    // SKIP lamaran yang dibintangi admin mana pun.
    if (parseStarredBy(app.starredBy).length > 0) continue;
    // Hanya pindah ke tahap penolakan yang sah untuk posisi tersebut.
    const targetStage = rejectionStageForPosition(
      app.position?.stages ?? null,
      app.position?.stageCategories ?? null,
    );
    if (!targetStage) continue;
    targets.push({ id: app.id, stageHistory: app.stageHistory, targetStage });
  }

  if (targets.length === 0) {
    return {
      message: `Tidak ada lamaran yang memenuhi kriteria (status Baru, belum dilihat admin, lebih dari ${days} hari).`,
    };
  }

  await db.$transaction(
    targets.map((target) =>
      db.application.update({
        where: { id: target.id },
        data: {
          status: target.targetStage,
          rejectionReason: "LAINNYA",
          rejectionNote: `Ditolak massal via Copilot: lamaran lebih dari ${days} hari tanpa review`,
          rejectedAt: now,
          stageUpdatedAt: now,
          stageHistory: appendStageHistory(target.stageHistory, target.targetStage, "NEW"),
        },
      }),
    ),
  );

  // Satu entri log agregat (tanpa applicationId) agar tidak menumpuk log per lamaran.
  await db.activityLog.create({
    data: {
      actor,
      action: "COPILOT_ACTION",
      detail: `Menolak massal ${targets.length} lamaran via Copilot (> ${days} hari tanpa review)`,
    },
  });
  void emitRealtime(REALTIME_EVENTS.applications);

  return {
    message: `Menolak ${targets.length} lamaran massal (lebih dari ${days} hari tanpa review) ke tahap ${stageLabel(
      targets[0].targetStage,
    )}.`,
  };
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    const obj =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const type = asSafeString(obj.type, 40);
    const rawParams =
      obj.params && typeof obj.params === "object" && !Array.isArray(obj.params)
        ? (obj.params as Record<string, unknown>)
        : {};

    const permission = ACTION_PERMISSIONS[type];
    if (!permission) {
      return NextResponse.json({ error: "Tipe aksi tidak dikenal." }, { status: 400 });
    }

    // NR46 — matriks izin dicek ulang di server (UI tidak dipercaya).
    if (!(await can(session.role, permission))) {
      return NextResponse.json(
        { error: "Aksi ini tidak diizinkan untuk role Anda — lihat Matriks Izin di Pengaturan." },
        { status: 403 },
      );
    }

    const actor = `${session.name} (Copilot)`;
    let result: { message: string };
    switch (type) {
      case "set_application_status":
        result = await executeSetApplicationStatus(actor, rawParams);
        break;
      case "toggle_position":
        result = await executeTogglePosition(actor, rawParams);
        break;
      case "bulk_reject_stale":
        result = await executeBulkRejectStale(actor, rawParams);
        break;
      default:
        return NextResponse.json({ error: "Tipe aksi tidak dikenal." }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[POST /api/admin/copilot/execute]", error);
    return NextResponse.json(
      { error: "Gagal menjalankan aksi Copilot. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
