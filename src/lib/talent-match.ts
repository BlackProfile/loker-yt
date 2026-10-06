// Re-engagement talent pool (NR-40, butir 12) — helper SERVER-ONLY murni.
// Tidak mengimpor db: murni fungsi pencocokan atas baris lamaran lama yang
// dimuat oleh route (GET /api/admin/talent-pool untuk daftar kandidat,
// POST untuk penyaringan ulang sebelum mengirim undangan).
//
// Kandidat = lamaran lama dengan (status REJECTED ATAU holdAt != null ATAU
// talentPool true), belum terhapus (deletedAt null), belum diarsip
// (archivedAt null), bukan do-not-hire. Kandidat lintas posisi diperbolehkan;
// kandidat dari posisi target sendiri pun boleh (dipagari cooldown
// reapplyCooldownDays milik posisi lamanya — 0 = bebas).

export const TALENT_POOL_MATCH_LIMIT = 20; // maksimum kandidat dikembalikan / diundang sekali kirim
export const TALENT_INVITE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // idempoten ringan: 7 hari antar undangan
const DAY_MS = 86_400_000;

/** Baris kandidat lama yang dibutuhkan pencocokan (subset Application + posisi lamanya). */
export type TalentCandidateRow = {
  id: string;
  name: string;
  email: string;
  status: string;
  positionId: string | null;
  position: { id: string; title: string; department: string; reapplyCooldownDays: number } | null;
  rating: number;
  tags: string; // JSON string[]
  aiScore: number | null;
  rejectedAt: Date | null;
  holdAt: Date | null;
  talentPool: boolean;
  doNotHire: boolean;
  deletedAt: Date | null;
  archivedAt: Date | null;
  stageUpdatedAt: Date | null;
  createdAt: Date;
};

/** Posisi target re-engagement. */
export type TalentTargetPosition = {
  id: string;
  title: string;
  slug: string | null;
  department: string;
};

/** Satu kandidat hasil pencocokan (DTO untuk UI + respons API). */
export type TalentMatchResult = {
  applicationId: string;
  name: string;
  email: string;
  positionTitle: string | null; // posisi lama kandidat
  status: string;
  rejectedAt: string | null;
  holdAt: string | null;
  talentPool: boolean;
  aiScore: number | null;
  rating: number;
  tags: string[];
  score: number; // 0-100
  reasons: string[]; // alasan kecocokan (bahasa Indonesia, transparan)
  lastStageAt: string; // terakhir kali tahap berubah (fallback: waktu lamaran)
};

/** Parse JSON tag lamaran — aman terhadap data rusak. */
export function parseTalentTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

/**
 * Kandidat memenuhi syarat dasar talent pool: REJECTED / ditahan / ditandai
 * talent pool, aktif (tidak terhapus/arsip), bukan do-not-hire, dan punya
 * email valid. Posisi lama boleh sama dengan posisi target maupun beda
 * (kandidat lintas posisi diperbolehkan — kontrak butir 12).
 */
export function isTalentCandidateEligible(row: TalentCandidateRow): boolean {
  if (row.deletedAt || row.archivedAt || row.doNotHire) return false;
  const inPool = row.status === "REJECTED" || row.holdAt != null || row.talentPool === true;
  if (!inPool) return false;
  return !!row.email && row.email.includes("@"); // lamaran impor tanpa email tidak bisa diundang
}

/**
 * True bila kandidat masih dalam masa jeda lamar ulang: rejectedAt + cooldown
 * posisi lamanya > now. Cooldown 0 / posisi lama hilang = bebas.
 */
export function isCandidateInCooldown(row: TalentCandidateRow, now: Date): boolean {
  if (!row.rejectedAt) return false;
  const cooldownDays = row.position?.reapplyCooldownDays ?? 0;
  if (!Number.isFinite(cooldownDays) || cooldownDays <= 0) return false;
  return row.rejectedAt.getTime() + cooldownDays * DAY_MS > now.getTime();
}

/**
 * Hitung skor kecocokan (0-100) + alasan transparan untuk satu kandidat.
 * - Posisi sama +45
 * - Departemen sama +20
 * - Tag sama +6 per tag (maks 18) — dibandingkan dengan tag umum posisi target
 * - Skor AI tinggi +min(aiScore/100*20, 20) bila ada
 * - Rating admin +3 per bintang (maks 15)
 */
export function scoreTalentCandidate(
  row: TalentCandidateRow,
  target: TalentTargetPosition,
  targetTags: string[],
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const samePosition = !!row.positionId && row.positionId === target.id;
  if (samePosition) {
    score += 45;
    reasons.push("Posisi sama");
  }

  const sameDepartment = !!row.position && row.position.department === target.department;
  if (sameDepartment) {
    score += 20;
    reasons.push("Departemen sama");
  }

  // Tag sama (case-insensitive) antara tag kandidat dan tag umum posisi target.
  if (targetTags.length > 0) {
    const normalizedTarget = new Set(targetTags.map((tag) => tag.toLowerCase()));
    const candidateTags = parseTalentTags(row.tags);
    const shared = candidateTags.filter((tag) => normalizedTarget.has(tag.toLowerCase()));
    if (shared.length > 0) {
      score += Math.min(shared.length * 6, 18);
      reasons.push(`${shared.length} tag sama`);
    }
  }

  if (typeof row.aiScore === "number" && row.aiScore > 0) {
    const aiPoints = Math.min((row.aiScore / 100) * 20, 20);
    score += aiPoints;
    reasons.push(`Skor AI ${Math.round(row.aiScore)}`);
  }

  if (row.rating > 0) {
    score += Math.min(row.rating * 3, 15);
    reasons.push(`Rating ${row.rating}`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/**
 * Pencocokan utama: saring kandidat layak (syarat dasar + cooldown), beri skor,
 * urutkan skor tertinggi dulu, ambil maks `limit` (default 20).
 */
export function findTalentMatches(params: {
  target: TalentTargetPosition;
  candidates: TalentCandidateRow[];
  /** Tag umum posisi target (kumpulan tag lamaran aktif di posisi tersebut). */
  targetTags?: string[];
  now?: Date;
  limit?: number;
}): TalentMatchResult[] {
  const now = params.now ?? new Date();
  const limit = params.limit ?? TALENT_POOL_MATCH_LIMIT;
  const targetTags = (params.targetTags ?? []).map((tag) => tag.trim()).filter(Boolean);

  const matches: TalentMatchResult[] = [];
  for (const row of params.candidates) {
    if (!isTalentCandidateEligible(row)) continue;
    if (isCandidateInCooldown(row, now)) continue;
    const { score, reasons } = scoreTalentCandidate(row, params.target, targetTags);
    matches.push({
      applicationId: row.id,
      name: row.name,
      email: row.email,
      positionTitle: row.position?.title ?? null,
      status: row.status,
      rejectedAt: row.rejectedAt ? row.rejectedAt.toISOString() : null,
      holdAt: row.holdAt ? row.holdAt.toISOString() : null,
      talentPool: row.talentPool === true,
      aiScore: typeof row.aiScore === "number" ? row.aiScore : null,
      rating: row.rating,
      tags: parseTalentTags(row.tags),
      score,
      reasons,
      lastStageAt: (row.stageUpdatedAt ?? row.createdAt).toISOString(),
    });
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aAi = a.aiScore ?? -1;
    const bAi = b.aiScore ?? -1;
    if (bAi !== aAi) return bAi - aAi;
    return b.lastStageAt.localeCompare(a.lastStageAt);
  });
  return matches.slice(0, limit);
}
