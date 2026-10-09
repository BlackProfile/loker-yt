// Scorecard berbobot — fungsi murni (tanpa import server/klien).
// Kontrak NR44: Position.interviewCriteriaWeights = JSON {[kriteria]: bobot 0-100};
// null/kosong = bobot merata. Rata tertimbang = sum(nilai*bobot)/sum(bobot)
// hanya atas kriteria yang punya nilai sekaligus bobot.

/** True jika nilai berupa objek kamus biasa (bukan array/null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parsa bobot kriteria dari string JSON (kolom Position.interviewCriteriaWeights).
 * Toleran: JSON rusak / bentuk salah / nilai tak valid diabaikan, bukan melempar error.
 * - kunci = nama kriteria (trim, buang kosong)
 * - nilai = angka di-clamp ke bilangan bulat 0-100
 */
export function parseCriteriaWeights(raw: string | null): Record<string, number> {
  if (!raw || typeof raw !== "string") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isPlainObject(parsed)) return {};
  const weights: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!key) continue;
    const num = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!Number.isFinite(num)) continue;
    weights[key] = Math.min(100, Math.max(0, Math.round(num)));
  }
  return weights;
}

/**
 * Rata tertimbang skor wawancara.
 * - scores = {kriteria: nilai} hasil scorecard (nilai di luar 1-5 tetap dipakai apa adanya).
 * - weights = {kriteria: bobot 0-100} atau null (bobot merata).
 * Aturan:
 * - Tanpa skor -> { value: null, covered: false }.
 * - weights null/kosong -> rata biasa dari semua skor (covered = false).
 * - Ada bobot -> rata tertimbang hanya atas kriteria yang punya nilai DAN bobot > 0,
 *   dibulatkan 1 desimal (covered = true).
 * - Kriteria berskor tapi semuanya tanpa bobot -> fallback rata biasa di antara
 *   kriteria yang punya nilai (covered = false).
 * covered = false berarti hasil adalah fallback rata biasa, bukan rata tertimbang.
 */
export function weightedAverage(
  scores: Record<string, number>,
  weights: Record<string, number> | null,
): { value: number | null; covered: boolean } {
  if (!isPlainObject(scores)) return { value: null, covered: false };
  const validScores: Record<string, number> = {};
  for (const [key, raw] of Object.entries(scores)) {
    const k = typeof key === "string" ? key.trim() : "";
    const num = typeof raw === "number" ? raw : Number(raw);
    if (!k || !Number.isFinite(num)) continue;
    validScores[k] = num;
  }
  const scoredKeys = Object.keys(validScores);
  if (scoredKeys.length === 0) return { value: null, covered: false };

  const safeWeights =
    weights && isPlainObject(weights)
      ? weights
      : {};
  const weightedKeys = scoredKeys.filter((k) => {
    const w = safeWeights[k];
    return typeof w === "number" && Number.isFinite(w) && w > 0;
  });

  // Fallback: rata biasa (tanpa bobot yang relevan).
  if (weightedKeys.length === 0) {
    const total = scoredKeys.reduce((sum, k) => sum + validScores[k], 0);
    return { value: Math.round((total / scoredKeys.length) * 10) / 10, covered: false };
  }

  // Rata tertimbang atas irisan kriteria berskor + berbobot.
  let weightedSum = 0;
  let weightSum = 0;
  for (const k of weightedKeys) {
    const w = safeWeights[k];
    weightedSum += validScores[k] * w;
    weightSum += w;
  }
  if (weightSum <= 0) {
    const total = scoredKeys.reduce((sum, k) => sum + validScores[k], 0);
    return { value: Math.round((total / scoredKeys.length) * 10) / 10, covered: false };
  }
  return { value: Math.round((weightedSum / weightSum) * 10) / 10, covered: true };
}

/**
 * Gabungkan skor dari beberapa sesi wawancara (multi-ronde): rata-rata per
 * kriteria dari semua sesi yang mengisinya, lalu hasilnya dipakai untuk
 * weightedAverage. Tanpa sesi berskor -> objek kosong.
 */
export function averageScoresAcrossSessions(
  scoreMaps: Array<Record<string, number> | null | undefined>,
): Record<string, number> {
  const sums: Record<string, { total: number; count: number }> = {};
  for (const map of scoreMaps) {
    if (!isPlainObject(map)) continue;
    for (const [key, raw] of Object.entries(map)) {
      const k = typeof key === "string" ? key.trim() : "";
      const num = typeof raw === "number" ? raw : Number(raw);
      if (!k || !Number.isFinite(num)) continue;
      const entry = sums[k] ?? { total: 0, count: 0 };
      entry.total += num;
      entry.count += 1;
      sums[k] = entry;
    }
  }
  const merged: Record<string, number> = {};
  for (const [key, { total, count }] of Object.entries(sums)) {
    merged[key] = Math.round((total / count) * 10) / 10;
  }
  return merged;
}
