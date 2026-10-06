// NR-40 — Siklus hidup karyawan (SERVER-ONLY — jangan diimpor dari komponen klien).
// Kontrak bersama untuk tab Karyawan: DTO karyawan (pola GET /api/admin/hire),
// sanitasi rencana onboarding/offboarding, checklist offboarding bawaan, dan
// penerapan offboarding (exit) yang dipakai bersama oleh:
//   POST /api/admin/hire/probation (decision END)
//   POST /api/admin/hire/exit
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { pushNotification } from "@/lib/notify";
import { EXIT_REASONS, EXIT_REASON_LABELS, type ExitReason } from "@/lib/types";

const MAX_ITEMS = 30;

/** Item rencana/checklist (onboarding & offboarding memakai bentuk yang sama). */
export type LifecyclePlanItem = {
  id: string;
  label: string;
  owner: string | null;
  dueAt: string | null;
  done: boolean;
};

/** Parse plan (JSON string) menjadi daftar item aman terhadap nilai rusak. */
export function parseLifecyclePlan(raw: string): LifecyclePlanItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: LifecyclePlanItem[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const obj = parsed[i] && typeof parsed[i] === "object" && !Array.isArray(parsed[i])
        ? (parsed[i] as Record<string, unknown>)
        : {};
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      if (!label) continue;
      const dueAt =
        typeof obj.dueAt === "string" && obj.dueAt && !Number.isNaN(new Date(obj.dueAt).getTime())
          ? new Date(obj.dueAt).toISOString()
          : null;
      items.push({
        id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `item${i + 1}`,
        label,
        owner: typeof obj.owner === "string" && obj.owner.trim() ? obj.owner.trim() : null,
        dueAt,
        done: obj.done === true,
      });
    }
    return items;
  } catch {
    return [];
  }
}

/** Sanitasi daftar item dari input tak dikenal (array atau JSON string) — pola onboardingPlan. */
export function sanitizeLifecyclePlan(raw: unknown): LifecyclePlanItem[] | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null; // JSON string rusak
    }
  }
  if (!Array.isArray(parsed)) return null;

  const items: LifecyclePlanItem[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < parsed.length && items.length < MAX_ITEMS; i++) {
    const obj = parsed[i] && typeof parsed[i] === "object" && !Array.isArray(parsed[i])
      ? (parsed[i] as Record<string, unknown>)
      : {};
    const label = typeof obj.label === "string" ? obj.label.trim().slice(0, 120) : "";
    if (!label) continue;

    let id = typeof obj.id === "string" ? obj.id.trim().slice(0, 40) : "";
    if (!id || usedIds.has(id)) id = `item${Date.now().toString(36)}${i}`;
    usedIds.add(id);

    const owner = typeof obj.owner === "string" && obj.owner.trim() ? obj.owner.trim().slice(0, 60) : null;
    const dueAtRaw = typeof obj.dueAt === "string" ? obj.dueAt.trim() : "";
    const dueAt = dueAtRaw && !Number.isNaN(new Date(dueAtRaw).getTime()) ? new Date(dueAtRaw).toISOString() : null;

    items.push({ id, label, owner, dueAt, done: obj.done === true });
  }
  return items;
}

/** Checklist offboarding bawaan (5 item serah terima) — diisi saat exit bila masih kosong. */
const DEFAULT_OFFBOARDING_LABELS = [
  "Pengembalian peralatan kantor",
  "Serah terima tugas & akses akun",
  "Penyelesaian gaji & administrasi",
  "Wawancara keluar (exit interview)",
  "Arsip dokumen karyawan",
] as const;

export function defaultOffboardingPlan(): LifecyclePlanItem[] {
  return DEFAULT_OFFBOARDING_LABELS.map((label) => ({
    id: randomUUID(),
    label,
    owner: null,
    dueAt: null,
    done: false,
  }));
}

/**
 * Terapkan offboarding karyawan (dipakai POST /exit dan keputusan probasi END):
 * set exitAt/exitReason/exitNote, isi checklist offboarding bawaan bila masih "[]",
 * cabut kartu current (REVOKED), catat ActivityLog EMPLOYMENT_ENDED, kirim
 * NotificationItem "Karyawan keluar", dan sebarkan realtime.
 */
export async function applyExitOffboarding(opts: {
  applicationId: string;
  applicationName: string;
  positionTitle: string | null;
  exitAt: Date;
  exitReason: ExitReason;
  exitNote: string | null;
  actor: string;
}): Promise<void> {
  const reasonLabel = EXIT_REASON_LABELS[opts.exitReason];
  const exitDateLabel = opts.exitAt.toLocaleDateString("id-ID", { dateStyle: "long" });

  const existing = await db.application.findUnique({
    where: { id: opts.applicationId },
    select: { offboardingPlan: true },
  });
  const planEmpty = !existing || parseLifecyclePlan(existing.offboardingPlan).length === 0;

  await db.application.update({
    where: { id: opts.applicationId },
    data: {
      exitAt: opts.exitAt,
      exitReason: opts.exitReason,
      exitNote: opts.exitNote,
      ...(planEmpty ? { offboardingPlan: JSON.stringify(defaultOffboardingPlan()) } : {}),
    },
  });

  // Cabut kartu current bila ada & belum dicabut — QR lama otomatis tidak berlaku.
  const card = await db.employeeCard.findFirst({
    where: { applicationId: opts.applicationId, isCurrent: true },
    select: { id: true, status: true },
  });
  if (card && card.status !== "REVOKED") {
    await db.employeeCard.update({
      where: { id: card.id },
      data: {
        status: "REVOKED",
        revokedAt: new Date(),
        revokedReason: `Akhir kerja sama — ${reasonLabel}`,
      },
    });
  }

  await db.activityLog.create({
    data: {
      applicationId: opts.applicationId,
      actor: opts.actor,
      action: "EMPLOYMENT_ENDED",
      detail: `${reasonLabel} — keluar ${exitDateLabel}`,
    },
  });

  await pushNotification({
    title: "Karyawan keluar",
    body: `${opts.applicationName}${opts.positionTitle ? ` (${opts.positionTitle})` : ""} keluar per ${exitDateLabel} — ${reasonLabel.toLowerCase()}.`,
    category: "APPLICATION",
    applicationId: opts.applicationId,
  });

  void emitRealtime(REALTIME_EVENTS.applications);
}

/* ------------------------------ DTO karyawan (tab Karyawan) ------------------------------ */

export type EmployeeCheckInDto = {
  id: string;
  day: number;
  dueAt: string | null;
  rating: number | null;
  notes: string | null;
  recommendation: string | null;
  completedAt: string | null;
};

export type EmployeeDto = {
  id: string;
  name: string;
  email: string;
  phone: string;
  trackingCode: string | null;
  positionTitle: string | null;
  hiredAt: string;
  probationEnd: string | null;
  permanentAt: string | null;
  exitAt: string | null;
  exitReason: ExitReason | null;
  exitNote: string | null;
  onboardingPlan: LifecyclePlanItem[];
  offboardingPlan: LifecyclePlanItem[];
  checkIns: EmployeeCheckInDto[];
};

/** Baris Prisma Application + checkIns seperti yang dimuat route hire. */
export type EmployeeRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  trackingCode: string | null;
  position?: { title: string | null } | null;
  hiredAt: Date | null;
  probationEnd: Date | null;
  permanentAt: Date | null;
  exitAt: Date | null;
  exitReason: string | null;
  exitNote: string | null;
  onboardingPlan: string;
  offboardingPlan: string;
  checkIns: {
    id: string;
    day: number;
    dueAt: Date | null;
    rating: number | null;
    notes: string | null;
    recommendation: string | null;
    completedAt: Date | null;
  }[];
};

/** Include Prisma standar untuk memuat karyawan + relasi yang dipakai DTO. */
export const employeeInclude = {
  position: { select: { title: true } },
  checkIns: { orderBy: { day: "asc" as const } },
} as const;

/** Ubah baris Prisma -> DTO karyawan untuk klien (pola GET /api/admin/hire). */
export function serializeEmployee(row: EmployeeRow): EmployeeDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    trackingCode: row.trackingCode,
    positionTitle: row.position?.title ?? null,
    hiredAt: (row.hiredAt ?? new Date()).toISOString(),
    probationEnd: row.probationEnd ? row.probationEnd.toISOString() : null,
    permanentAt: row.permanentAt ? row.permanentAt.toISOString() : null,
    exitAt: row.exitAt ? row.exitAt.toISOString() : null,
    exitReason: (EXIT_REASONS as readonly string[]).includes(row.exitReason ?? "")
      ? (row.exitReason as ExitReason)
      : null,
    exitNote: row.exitNote,
    onboardingPlan: parseLifecyclePlan(row.onboardingPlan),
    offboardingPlan: parseLifecyclePlan(row.offboardingPlan),
    checkIns: row.checkIns.map((c) => ({
      id: c.id,
      day: c.day,
      dueAt: c.dueAt ? c.dueAt.toISOString() : null,
      rating: c.rating,
      notes: c.notes,
      recommendation: c.recommendation,
      completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    })),
  };
}
