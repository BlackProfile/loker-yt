/**
 * NR-19 — Batas kapasitas per tahap pipeline (WIP limit).
 *
 * Position.stageWipLimits (DB, JSON string) berbentuk {"Tahap": maxKandidat}.
 * Disimpan bersih oleh sanitizeStageWipLimits (position-input) dan dipakai oleh:
 *  - /api/admin/action-items  -> kartu "tahap melebihi kapasitas"
 *  - kanban-board.tsx         -> chip peringatan di kolom tahap
 */

/** Parse Position.stageWipLimits (JSON string) secara aman — fallback null. */
export function parseStageWipLimits(raw: string | null | undefined): Record<string, number> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const n = typeof value === "number" ? value : Number(value);
      if (typeof key === "string" && key.trim() && Number.isFinite(n) && n > 0) {
        out[key.trim()] = Math.floor(n);
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Hitung tahap yang melebihi batas kapasitas.
 * stageCounts: pemetaan {tahap: jumlah kandidat aktif} untuk satu posisi.
 */
export function findWipOverages(
  limits: Record<string, number> | null,
  stageCounts: Record<string, number>,
): { stage: string; count: number; limit: number }[] {
  if (!limits) return [];
  const out: { stage: string; count: number; limit: number }[] = [];
  for (const [stage, limit] of Object.entries(limits)) {
    const count = stageCounts[stage] ?? 0;
    if (count > limit) out.push({ stage, count, limit });
  }
  return out;
}
