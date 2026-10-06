// NR38-B — tipe & helper lokal bersama untuk file milik agent NR38-B
// (applications-tab, applications-table, tasks-tab, dialog bandingkan/kartu).
// DILARANG mengedit src/lib/types.ts — perluasan tipe didefinisikan di sini.

import type { Application } from "@/lib/types";

/**
 * Perluasan payload daftar lamaran dari GET /api/admin/applications (NR38-B):
 * field tambahan di atas kontrak `Application` bawaan. Field opsional agar
 * aman terhadap respons lama / konteks lain yang belum menyertakan field baru.
 */
export type ApplicationRow = Application & {
  /** Saat admin (siapa pun) pertama membuka dialog detail — null = belum dilihat. */
  adminSeenAt?: string | null;
  /** Jadwal snooze bot (bila diisi) — dipakai panel "Perlu dihubungi hari ini". */
  snoozeUntil?: string | null;
  /** Rentang gaji posisi (dari include position) untuk chip gaji vs range. */
  positionSalaryMin?: number | null;
  positionSalaryMax?: number | null;
};

/** Tandai baris "belum dilihat": adminSeenAt belum terisi. */
export function isUnseenRow(app: ApplicationRow): boolean {
  return !app.adminSeenAt;
}

/** Tanggal acuan umur lamaran: perubahan tahap terakhir, fallback dibuat. */
export function stageAgeBasis(app: ApplicationRow): string {
  return app.stageUpdatedAt || app.createdAt;
}

/**
 * Umur dari tanggal lahir — "27 th"; null bila kosong/tidak valid
 * (termasuk tanggal lahir di masa depan atau tidak masuk akal > 130 tahun).
 * Salinan helper tabel agar dipakai bersama kartu & dialog bandingkan.
 */
export function ageOf(birthDate: string | null | undefined): string | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const monthDelta = now.getMonth() - dob.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < dob.getDate())) years -= 1;
  if (years < 0 || years > 130) return null;
  return `${years} th`;
}
