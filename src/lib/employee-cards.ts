// NR-39 — Logika server Kartu Karyawan digital.
// Terbit otomatis saat hiredAt terisi (offer diterima), verifikasi publik via
// token acak 192-bit + HMAC (integritas), siklus status, dan re-issue.
// HANYA untuk sisi server (dipakai route handler) — jangan diimpor dari klien.

import crypto from "crypto";
import { db } from "@/lib/db";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { EmployeeCardDto, EmployeeCardStatus, IdentityChecks } from "@/lib/types";

const SECRET_KEY = "card_secret"; // Setting.key — rahasia HMAC per-instalasi
const CARD_PREFIX = "LUM-EMP-";

/** NIK termask: 4 digit pertama + 8 titik + 4 digit terakhir (panjang tetap 16). */
export function maskNik(nik: string | null | undefined): string | null {
  if (!nik) return null;
  const digits = nik.replace(/\D/g, "");
  if (digits.length < 8) return "•".repeat(Math.max(digits.length, 8));
  return `${digits.slice(0, 4)}${"•".repeat(8)}${digits.slice(-4)}`;
}

/** Ambil (atau buat sekali) rahasia HMAC per-instalasi dari tabel Setting. */
export async function getCardSecret(): Promise<string> {
  const existing = await db.setting.findUnique({ where: { key: SECRET_KEY } });
  if (existing?.value) return existing.value;
  const value = crypto.randomBytes(32).toString("hex");
  try {
    await db.setting.create({ data: { key: SECRET_KEY, value } });
  } catch {
    // Balapan antar-request: baca ulang nilai pemenang.
    const winner = await db.setting.findUnique({ where: { key: SECRET_KEY } });
    if (winner?.value) return winner.value;
  }
  return value;
}

/** Token QR bertanda tangan: `{token}.{hmac16}` — sampah/garangan ditolak tanpa sentuh DB. */
export async function signCardToken(token: string): Promise<string> {
  const secret = await getCardSecret();
  const sig = crypto.createHmac("sha256", secret).update(token).digest("hex").slice(0, 16);
  return `${token}.${sig}`;
}

/** Verifikasi tanda tangan; kembalikan token murni bila valid, null bila rusak/palsu. */
export async function verifyCardSignature(raw: string | null | undefined): Promise<string | null> {
  if (!raw) return null;
  const value = raw.trim().slice(0, 200);
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const token = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^[0-9a-f]{16}$/.test(sig) || !/^[0-9a-f]{48}$/.test(token)) return null;
  const secret = await getCardSecret();
  const expected = crypto.createHmac("sha256", secret).update(token).digest("hex").slice(0, 16);
  // bandingkan waktu-konstan sederhana
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? token : null;
}

/** Nomor kartu berurutan global: LUM-EMP-0001, 0002, ... (aman dari balapan via cek unik). */
export async function nextCardNumberFor(): Promise<string> {
  const count = await db.employeeCard.count();
  for (let i = 1; i <= 200; i++) {
    const candidate = `${CARD_PREFIX}${String(count + i).padStart(4, "0")}`;
    const taken = await db.employeeCard.findUnique({ where: { cardNumber: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Fallback ekstrem: nomor berbasis waktu (tetap unik).
  return `${CARD_PREFIX}${Date.now().toString(36).toUpperCase().slice(-6)}`;
}

function randomToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export { randomToken as randomCardToken };

/** PROBATION yang sudah lewat tanggal dianggap ACTIVE (upgrade malas saat dibaca). */
export function effectiveStatus(card: {
  status: string;
  probationUntil: Date | null;
}): EmployeeCardStatus {
  if (
    card.status === "PROBATION" &&
    card.probationUntil &&
    card.probationUntil.getTime() <= Date.now()
  ) {
    return "ACTIVE";
  }
  return card.status as EmployeeCardStatus;
}

function parseChecks(raw: string): IdentityChecks {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    return {
      docs: obj.docs === true,
      nikMatch: obj.nikMatch === true,
      contract: obj.contract === true,
    };
  } catch {
    return { docs: false, nikMatch: false, contract: false };
  }
}

/** Status beralih-aktif setelah gerbang checklist: PROBATION bila masih dalam masa percobaan. */
export function activationStatusOf(probationUntil: Date | null): EmployeeCardStatus {
  return probationUntil && probationUntil.getTime() > Date.now() ? "PROBATION" : "ACTIVE";
}

const activationStatus = activationStatusOf;

/**
 * Pastikan karyawan (hiredAt terisi) punya kartu current — terbit otomatis.
 * Dipanggil dari: offer ACCEPT, PATCH status ACCEPTED (hired), GET kartu admin, my-card.
 * Mengembalikan DTO kartu current atau null (belum hired / gagal).
 */
export async function ensureEmployeeCard(
  applicationId: string,
  opts: { actor?: string } = {}
): Promise<EmployeeCardDto | null> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, hiredAt: true, probationEnd: true },
  });
  if (!app?.hiredAt) return null;

  const existing = await db.employeeCard.findFirst({
    where: { applicationId, isCurrent: true },
  });
  if (existing) {
    // Upgrade malas PROBATION -> ACTIVE bila masa percobaan berlalu.
    if (effectiveStatus(existing) === "ACTIVE" && existing.status === "PROBATION") {
      const updated = await db.employeeCard
        .update({ where: { id: existing.id }, data: { status: "ACTIVE" } })
        .catch(() => existing);
      return serializeCard(updated, app);
    }
    return serializeCard(existing, app);
  }

  const card = await db.employeeCard.create({
    data: {
      applicationId,
      cardNumber: await nextCardNumberFor(),
      token: randomToken(),
      status: "PENDING",
      probationUntil: app.probationEnd,
    },
  });
  await db.activityLog
    .create({
      data: {
        applicationId,
        actor: opts.actor ?? "Sistem",
        action: "CARD_ISSUED",
        detail: `Kartu karyawan ${card.cardNumber} terbit otomatis (menunggu verifikasi identitas)`,
      },
    })
    .catch(() => undefined);
  void emitRealtime(REALTIME_EVENTS.applications);
  return serializeCard(card, app);
}

/**
 * Sinkron kartu saat status pipeline berubah (dipanggil dari PATCH admin):
 * - REJECTED -> kartu dicabut otomatis (karyawan keluar)
 * - ACCEPTED -> kartu SUSPENDED diaktifkan kembali
 * - doNotHire -> kartu dicabut
 */
export async function syncCardOnStatusChange(
  applicationId: string,
  nextStatus: string | undefined,
  opts: { doNotHire?: boolean; actor?: string } = {}
): Promise<void> {
  const card = await db.employeeCard.findFirst({
    where: { applicationId, isCurrent: true },
  });
  if (!card) return;

  const actor = opts.actor ?? "Sistem";
  const revoke = async (reason: string) => {
    if (card.status === "REVOKED") return;
    await db.employeeCard.update({
      where: { id: card.id },
      data: { status: "REVOKED", revokedAt: new Date(), revokedReason: reason },
    });
    await db.activityLog
      .create({
        data: {
          applicationId,
          actor,
          action: "CARD_STATUS",
          detail: `Kartu ${card.cardNumber} dicabut otomatis — ${reason}`,
        },
      })
      .catch(() => undefined);
    void emitRealtime(REALTIME_EVENTS.applications);
  };

  if (opts.doNotHire === true) {
    await revoke("Lamaran ditandai do-not-hire");
    return;
  }
  if (nextStatus === "REJECTED") {
    await revoke("Status karyawan keluar dari Diterima");
    return;
  }
  if (nextStatus === "ACCEPTED" && card.status === "SUSPENDED") {
    const app = await db.application.findUnique({
      where: { id: applicationId },
      select: { probationEnd: true },
    });
    const next = activationStatus(app?.probationEnd ?? card.probationUntil);
    await db.employeeCard.update({ where: { id: card.id }, data: { status: next } });
    await db.activityLog
      .create({
        data: {
          applicationId,
          actor,
          action: "CARD_STATUS",
          detail: `Kartu ${card.cardNumber} diaktifkan kembali (${next === "PROBATION" ? "Masa Percobaan" : "Aktif"})`,
        },
      })
      .catch(() => undefined);
    void emitRealtime(REALTIME_EVENTS.applications);
  }
}

/** Ubah baris Prisma -> DTO klien. */
export function serializeCard(
  card: {
    id: string;
    applicationId: string;
    cardNumber: string;
    token: string;
    status: string;
    identityChecks: string;
    issuedAt: Date;
    probationUntil: Date | null;
    revokedAt: Date | null;
    revokedReason: string | null;
    verifyCount: number;
    lastVerifiedAt: Date | null;
    isCurrent: boolean;
  },
  owner?: { name: string; positionTitle: string | null; hiredAt: Date | null; nik: string | null; trackingCode: string | null }
): EmployeeCardDto {
  return {
    id: card.id,
    applicationId: card.applicationId,
    cardNumber: card.cardNumber,
    status: effectiveStatus(card),
    identityChecks: parseChecks(card.identityChecks),
    issuedAt: card.issuedAt.toISOString(),
    probationUntil: card.probationUntil ? card.probationUntil.toISOString() : null,
    revokedAt: card.revokedAt ? card.revokedAt.toISOString() : null,
    revokedReason: card.revokedReason,
    verifyCount: card.verifyCount,
    lastVerifiedAt: card.lastVerifiedAt ? card.lastVerifiedAt.toISOString() : null,
    isCurrent: card.isCurrent,
    name: owner?.name ?? "",
    positionTitle: owner?.positionTitle ?? null,
    hiredAt: owner?.hiredAt ? owner.hiredAt.toISOString() : null,
    nikMasked: maskNik(owner?.nik),
    trackingCode: owner?.trackingCode ?? null,
  };
}
