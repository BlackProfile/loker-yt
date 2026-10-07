// NR-41 G9 — Profil kandidat terpusat (SERVER-ONLY).
// Satu orang (email unik, dinormalisasi lowercase-trim) = satu row Candidate;
// seluruh Application milik orang tersebut tertaut via Application.candidateId.
// Dipanggil dari: route submit lamaran publik + skrip migrasi scripts/nr41-migrate.cjs.
import { db } from "@/lib/db";

/** Normalisasi email: trim + lowercase. Return string kosong bila input kosong. */
export function normalizeEmail(email: string): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Pastikan ada Candidate untuk email tertentu — cari dulu, bila belum ada buat baru.
 * - name/phone dipakai dari argumen bila terisi;
 *   selain itu diambil dari lamaran terakhir dengan email sama (untuk backfill).
 * - Tidak pernah melempar error ke alur utama: return null bila email kosong/invalid
 *   ATAU terjadi kegagalan database (submit publik tidak boleh gagal karenanya).
 */
export async function ensureCandidate(
  email: string,
  name?: string,
  phone?: string,
): Promise<string | null> {
  const normalized = normalizeEmail(email);
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;

  try {
    const existing = await db.candidate.findUnique({
      where: { email: normalized },
      select: { id: true },
    });
    if (existing) return existing.id;

    // Backfill profil dari lamaran terakhir dengan email sama (bila argumen kosong).
    let fallbackName = (name ?? "").trim();
    let fallbackPhone = (phone ?? "").trim();
    if (!fallbackName || !fallbackPhone) {
      const latest = await db.application.findFirst({
        where: { email: normalized },
        orderBy: { createdAt: "desc" },
        select: { name: true, phone: true },
      });
      if (latest) {
        if (!fallbackName) fallbackName = latest.name.trim();
        if (!fallbackPhone) fallbackPhone = latest.phone.trim();
      }
    }

    const created = await db.candidate.create({
      data: {
        email: normalized,
        name: fallbackName || normalized,
        phone: fallbackPhone || null,
      },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    // Race antar request: bila create gagal karena email sudah diambil, coba baca lagi.
    console.error("[candidates] ensureCandidate gagal:", error);
    try {
      const retry = await db.candidate.findUnique({
        where: { email: normalized },
        select: { id: true },
      });
      if (retry) return retry.id;
    } catch {
      // diam — return null di bawah
    }
    return null;
  }
}
