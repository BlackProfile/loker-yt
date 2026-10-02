// Riwayat tahap lamaran (NR-15) — helper bersama untuk semua titik perubahan
// Application.status (route admin, route publik, bot Telegram).
// Format tersimpan pada Application.stageHistory (JSON string):
//   [{ status: string, at: string /* ISO */ }, ...] — urut waktu, maks 30 entri.

export type StageHistoryEntry = { status: string; at: string };

/** Batas jumlah entri riwayat yang disimpan per lamaran. */
export const STAGE_HISTORY_MAX = 30;

/** Parse JSON riwayat tahap secara aman — fallback [] bila kosong/rusak. */
export function parseStageHistory(json: string | null | undefined): StageHistoryEntry[] {
  if (!json || !json.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    const out: StageHistoryEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const obj = item as Record<string, unknown>;
      const status = typeof obj.status === "string" ? obj.status.trim() : "";
      const at = typeof obj.at === "string" ? obj.at : "";
      if (!status || !at || Number.isNaN(new Date(at).getTime())) continue;
      out.push({ status, at });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Tambahkan satu perpindahan tahap ke riwayat (JSON string baru untuk di-update).
 * - Bila tahap baru sama dengan entri terakhir, JSON dikembalikan apa adanya
 *   (tidak ada entri ganda).
 * - Bila riwayat masih kosong dan `previousStatus` diberikan, tahap lama dicatat
 *   lebih dulu agar timeline tidak melompat (lamaran lama tanpa riwayat tetap rapi).
 * - Maksimal STAGE_HISTORY_MAX entri (yang terlama dibuang).
 */
export function appendStageHistory(
  currentJson: string,
  newStatus: string,
  previousStatus?: string,
): string {
  const history = parseStageHistory(currentJson);
  if (history.length === 0 && previousStatus && previousStatus.trim()) {
    // Seed tahap awal — pakai createdAt? Tidak tersedia di sini; cukup timestamp kini
    // dengan jarak minimal dari entri berikutnya (urutan tetap benar).
    history.push({ status: previousStatus.trim(), at: new Date().toISOString() });
  }
  const last = history[history.length - 1];
  if (last && last.status === newStatus) {
    return JSON.stringify(history.slice(-STAGE_HISTORY_MAX));
  }
  history.push({ status: newStatus, at: new Date().toISOString() });
  return JSON.stringify(history.slice(-STAGE_HISTORY_MAX));
}
