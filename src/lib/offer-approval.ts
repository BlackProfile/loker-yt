// NR44 — Setting "offer_approval": alur persetujuan offer dua lapis (SERVER-ONLY).
// Kontrak JSON: {"enabled": boolean}. Default (Setting tidak ada / JSON rusak) = false
// (jalur kirim lama langsung, kompatibel dengan perilaku sebelumnya).
import { db } from "@/lib/db";

export const OFFER_APPROVAL_SETTING_KEY = "offer_approval";

/** Baca Setting "offer_approval" — toleran terhadap JSON rusak (default mati). */
export async function readOfferApprovalEnabled(): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key: OFFER_APPROVAL_SETTING_KEY } });
    if (!row) return false;
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).enabled === true;
  } catch {
    return false;
  }
}

/** Simpan Setting "offer_approval" dan kembalikan nilai efektifnya. */
export async function writeOfferApprovalEnabled(enabled: boolean): Promise<void> {
  await db.setting.upsert({
    where: { key: OFFER_APPROVAL_SETTING_KEY },
    update: { value: JSON.stringify({ enabled }) },
    create: { key: OFFER_APPROVAL_SETTING_KEY, value: JSON.stringify({ enabled }) },
  });
}
