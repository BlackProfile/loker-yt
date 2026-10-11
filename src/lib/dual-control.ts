// SERVER-ONLY — NR46: prinsip empat mata (dual control) untuk aksi destruktif.
// Alur: OWNER A mengajukan (payload tersimpan) → OWNER AKTIF LAIN menyetujui →
// eksekusi berjalan dengan parameter yang sama. Pengaju TIDAK dapat menyetujui
// permintaannya sendiri. Bila fitur mati atau hanya ada satu OWNER aktif, aksi
// berjalan langsung seperti sebelumnya (fallback perilaku lama).
import { db } from "@/lib/db";
import { eraseCandidateData } from "@/lib/privacy-center";
import type { ApprovalRequestView, Role } from "@/lib/types";

export type ApprovalKind =
  | "PRIVACY_ERASE"
  | "TRASH_PURGE_POSITION"
  | "TRASH_PURGE_APPLICATION"
  | "USER_DELETE";

const SETTING_KEY = "dual_control";

export const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  PRIVACY_ERASE: "Hapus Data Kandidat (Pusat Privasi)",
  TRASH_PURGE_POSITION: "Hapus Permanen Posisi",
  TRASH_PURGE_APPLICATION: "Hapus Permanen Lamaran",
  USER_DELETE: "Hapus Akun Admin",
};

export async function dualControlEnabled(): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return true; // bawaan AKTIF
    const parsed: unknown = JSON.parse(row.value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return (parsed as Record<string, unknown>).enabled !== false;
    }
    return true;
  } catch {
    return true;
  }
}

export async function writeDualControl(enabled: boolean): Promise<void> {
  const value = JSON.stringify({ enabled: enabled === true });
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
}

async function activeOwnerCount(): Promise<number> {
  return db.adminUser.count({ where: { role: "OWNER", isActive: true } });
}

/** True bila aksi destruktif HARUS lewat persetujuan OWNER kedua. */
export async function shouldRouteToApproval(): Promise<boolean> {
  try {
    if (!(await dualControlEnabled())) return false;
    return (await activeOwnerCount()) >= 2;
  } catch {
    return false; // gagal cek = jangan menggagalkan aksi lama
  }
}

/** Buat permintaan persetujuan baru (status PENDING) + audit + notifikasi. */
export async function createApprovalRequest(input: {
  kind: ApprovalKind;
  payload: Record<string, unknown>;
  summary: string;
  session: { id: string; name: string; role: Role };
}): Promise<string> {
  const row = await db.approvalRequest.create({
    data: {
      kind: input.kind,
      payload: JSON.stringify(input.payload),
      summary: input.summary.slice(0, 300),
      status: "PENDING",
      requestedById: input.session.id,
      requestedByName: input.session.name,
    },
  });
  await db.activityLog.create({
    data: {
      applicationId: null,
      actor: input.session.name,
      action: "APPROVAL_REQUESTED",
      detail: `${APPROVAL_KIND_LABEL[input.kind]}: ${input.summary.slice(0, 200)} — menunggu persetujuan OWNER lain`,
    },
  });
  await db.notificationItem
    .create({
      data: {
        title: "Permintaan Persetujuan Ganda",
        body: `${input.session.name} meminta persetujuan: ${APPROVAL_KIND_LABEL[input.kind]} — ${input.summary.slice(0, 160)}`,
        category: "SYSTEM",
      },
    })
    .catch(() => undefined);
  return row.id;
}

type ApprovalRow = Awaited<ReturnType<typeof db.approvalRequest.findUnique>>;

/** Eksekusi payload permintaan yang sudah disetujui. Melempar bila eksekusi gagal. */
async function executePayload(kind: ApprovalKind, payload: Record<string, unknown>, actorName: string): Promise<string> {
  switch (kind) {
    case "PRIVACY_ERASE": {
      const applicationId = typeof payload.applicationId === "string" ? payload.applicationId : "";
      if (!applicationId) throw new Error("Target lamaran tidak ditemukan pada permintaan.");
      const result = await eraseCandidateData(applicationId, actorName);
      return `Data kandidat dihapus (${result.deletedApplications} lamaran, ${result.deletedFiles} berkas).`;
    }
    case "TRASH_PURGE_POSITION": {
      const positionId = typeof payload.positionId === "string" ? payload.positionId : "";
      const position = await db.position.findUnique({
        where: { id: positionId },
        include: { _count: { select: { applications: true } } },
      });
      if (!position || !position.deletedAt) throw new Error("Posisi tidak lagi berada di tong sampah.");
      if (position._count.applications > 0) {
        throw new Error(`Posisi masih memiliki ${position._count.applications} lamaran — hapus lamarannya lebih dulu.`);
      }
      await db.position.delete({ where: { id: positionId } });
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: actorName,
          action: "POSITION_PURGE",
          detail: `Posisi "${position.title}" dihapus permanen (disetujui via persetujuan ganda)`,
        },
      });
      return `Posisi "${position.title}" dihapus permanen.`;
    }
    case "TRASH_PURGE_APPLICATION": {
      const applicationId = typeof payload.applicationId === "string" ? payload.applicationId : "";
      const app = await db.application.findUnique({
        where: { id: applicationId },
        select: { id: true, name: true, trackingCode: true, deletedAt: true, position: { select: { title: true } } },
      });
      if (!app || !app.deletedAt) throw new Error("Lamaran tidak lagi berada di tong sampah.");
      const label = `${app.name} (${app.trackingCode}) — posisi ${app.position?.title ?? "-"}`;
      await db.application.delete({ where: { id: app.id } });
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: actorName,
          action: "APPLICATION_PURGE",
          detail: `Lamaran ${label} dihapus permanen (disetujui via persetujuan ganda)`,
        },
      });
      return `Lamaran ${label} dihapus permanen.`;
    }
    case "USER_DELETE": {
      const userId = typeof payload.userId === "string" ? payload.userId : "";
      const target = await db.adminUser.findUnique({ where: { id: userId } });
      if (!target) throw new Error("Akun tidak ditemukan (mungkin sudah dihapus).");
      const activeOwners = await db.adminUser.count({ where: { role: "OWNER", isActive: true } });
      if (target.role === "OWNER" && target.isActive && activeOwners <= 1) {
        throw new Error("Tidak dapat menghapus satu-satunya pemilik (OWNER) yang aktif.");
      }
      await db.sessionToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await db.adminUser.delete({ where: { id: target.id } });
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: actorName,
          action: "USER_DELETED",
          detail: `Akun ${target.email} dihapus (disetujui via persetujuan ganda)`,
        },
      });
      return `Akun ${target.email} dihapus.`;
    }
    default:
      throw new Error("Jenis permintaan tidak dikenal.");
  }
}

/**
 * Setujui & eksekusi permintaan. Aturan: PENDING saja, bukan permintaan sendiri,
 * pelaku harus OWNER (diverifikasi route). Mengembalikan ringkasan hasil eksekusi.
 */
export async function approveAndExecute(input: {
  requestId: string;
  session: { id: string; name: string };
  note?: string;
}): Promise<{ ok: true; result: string } | { ok: false; error: string; status: number }> {
  const row: ApprovalRow = await db.approvalRequest.findUnique({ where: { id: input.requestId } });
  if (!row) return { ok: false, error: "Permintaan tidak ditemukan.", status: 404 };
  if (row.status !== "PENDING") {
    return { ok: false, error: "Permintaan ini sudah diproses sebelumnya.", status: 409 };
  }
  if (row.requestedById === input.session.id) {
    return { ok: false, error: "Permintaan Anda sendiri harus disetujui OWNER lain.", status: 403 };
  }

  let payload: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    payload = {};
  }

  const now = new Date();
  try {
    const result = await executePayload(row.kind as ApprovalKind, payload, input.session.name);
    await db.approvalRequest.update({
      where: { id: row.id },
      data: {
        status: "EXECUTED",
        resolvedById: input.session.id,
        resolvedByName: input.session.name,
        resolvedNote: input.note?.slice(0, 300) ?? null,
        resolvedAt: now,
        executedAt: now,
      },
    });
    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: input.session.name,
        action: "APPROVAL_EXECUTED",
        detail: `${APPROVAL_KIND_LABEL[row.kind as ApprovalKind]} dieksekusi: ${result}`,
      },
    });
    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Eksekusi gagal.";
    await db.approvalRequest.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        resolvedById: input.session.id,
        resolvedByName: input.session.name,
        resolvedNote: input.note?.slice(0, 300) ?? null,
        resolvedAt: now,
        executedAt: now,
        error: message.slice(0, 300),
      },
    });
    return { ok: false, error: message, status: 500 };
  }
}

/** Tolak permintaan PENDING (OWNER lain) — tanpa eksekusi. */
export async function rejectApproval(input: {
  requestId: string;
  session: { id: string; name: string };
  note?: string;
}): Promise<{ ok: boolean; error?: string; status?: number }> {
  const row = await db.approvalRequest.findUnique({ where: { id: input.requestId } });
  if (!row) return { ok: false, error: "Permintaan tidak ditemukan.", status: 404 };
  if (row.status !== "PENDING") return { ok: false, error: "Permintaan ini sudah diproses.", status: 409 };
  if (row.requestedById === input.session.id) {
    return { ok: false, error: "Gunakan Batalkan untuk permintaan Anda sendiri.", status: 403 };
  }
  await db.approvalRequest.update({
    where: { id: row.id },
    data: {
      status: "REJECTED",
      resolvedById: input.session.id,
      resolvedByName: input.session.name,
      resolvedNote: input.note?.slice(0, 300) ?? null,
      resolvedAt: new Date(),
    },
  });
  await db.activityLog.create({
    data: {
      applicationId: null,
      actor: input.session.name,
      action: "APPROVAL_REJECTED",
      detail: `${APPROVAL_KIND_LABEL[row.kind as ApprovalKind]} ditolak${input.note ? ` — ${input.note.slice(0, 200)}` : ""}`,
    },
  });
  return { ok: true };
}

/** Pengaju membatalkan permintaan PENDING miliknya. */
export async function cancelApproval(input: {
  requestId: string;
  session: { id: string; name: string };
}): Promise<{ ok: boolean; error?: string; status?: number }> {
  const row = await db.approvalRequest.findUnique({ where: { id: input.requestId } });
  if (!row) return { ok: false, error: "Permintaan tidak ditemukan.", status: 404 };
  if (row.requestedById !== input.session.id) {
    return { ok: false, error: "Hanya pengaju yang dapat membatalkan permintaan ini.", status: 403 };
  }
  if (row.status !== "PENDING") return { ok: false, error: "Permintaan ini sudah diproses.", status: 409 };
  await db.approvalRequest.update({
    where: { id: row.id },
    data: { status: "CANCELLED", resolvedAt: new Date(), resolvedById: input.session.id, resolvedByName: input.session.name },
  });
  await db.activityLog.create({
    data: {
      applicationId: null,
      actor: input.session.name,
      action: "APPROVAL_CANCELLED",
      detail: `${APPROVAL_KIND_LABEL[row.kind as ApprovalKind]} dibatalkan oleh pengaju`,
    },
  });
  return { ok: true };
}

/** Daftar permintaan untuk kartu persetujuan (PENDING lebih dulu, lalu riwayat). */
export async function listApprovalRequests(
  currentUserId: string,
): Promise<ApprovalRequestView[]> {
  const rows = await db.approvalRequest.findMany({
    orderBy: [{ createdAt: "desc" }],
    take: 30,
  });
  const pending = rows.filter((r) => r.status === "PENDING");
  const rest = rows.filter((r) => r.status !== "PENDING").slice(0, 12);
  return [...pending, ...rest].map((r) => ({
    id: r.id,
    kind: r.kind as ApprovalRequestView["kind"],
    summary: r.summary,
    status: r.status as ApprovalRequestView["status"],
    requestedByName: r.requestedByName,
    requestedById: r.requestedById,
    resolvedByName: r.resolvedByName,
    resolvedNote: r.resolvedNote,
    error: r.error,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    executedAt: r.executedAt ? r.executedAt.toISOString() : null,
    isMine: r.requestedById === currentUserId,
  }));
}
