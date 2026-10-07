// NR-41 G10 — Sinkronisasi tag terstruktur (SERVER-ONLY).
// "Dual-write": model Tag + ApplicationTag adalah sumber kebenaran baru, sementara
// field legacy Application.tags (JSON string[]) tetap ditulis agar UI/ekspor lama
// yang membaca JSON tetap berjalan. Pemanggil: SETELAH menulis legacy tags.
import { db } from "@/lib/db";

/** Warna default untuk Tag yang dibuat otomatis dari sync (netral, tanpa biru). */
const DEFAULT_TAG_COLOR = "zinc";

/**
 * Replace seluruh ApplicationTag milik satu lamaran agar sama persis dengan `names`.
 * - Tag yang belum ada dibuat otomatis (warna zinc, nama sudah trim).
 * - Link lama yang tidak ada di `names` dihapus.
 * - Legacy Application.tags ditulis ulang = JSON.stringify(names) (write-through).
 * - Tidak pernah melempar error: kegagalan sync hanya dicatat di console —
 *   alur utama (PATCH lamaran, bulk tag, merge) tidak boleh gagal karenanya.
 */
export async function syncApplicationTags(
  applicationId: string,
  names: string[],
  addedBy?: string,
): Promise<void> {
  // Normalisasi: string bersih, unik (case-sensitive konsisten dengan legacy),
  // batas aman 30 tag x 60 karakter.
  const clean: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.trim().slice(0, 60);
    if (!name || clean.includes(name)) continue;
    clean.push(name);
    if (clean.length >= 30) break;
  }

  try {
    const legacyJson = JSON.stringify(clean);

    // 1) Pastikan semua Tag ada (cache lookup nama -> id).
    const wanted = new Map<string, string>(); // lower(name) -> id
    if (clean.length > 0) {
      const existingTags = await db.tag.findMany({
        where: { OR: clean.map((name) => ({ name })) },
        select: { id: true, name: true },
      });
      for (const tag of existingTags) wanted.set(tag.name.toLowerCase(), tag.id);
      for (const name of clean) {
        if (wanted.has(name.toLowerCase())) continue;
        const created = await db.tag.create({ data: { name, color: DEFAULT_TAG_COLOR } });
        wanted.set(created.name.toLowerCase(), created.id);
      }
    }

    // 2) Replace link: baca yang ada, hapus yang kelebihan, buat yang kurang.
    const currentLinks = await db.applicationTag.findMany({
      where: { applicationId },
      select: { tagId: true },
    });
    const currentIds = new Set(currentLinks.map((link) => link.tagId));
    const wantedIds = new Set(wanted.values());

    const toDelete = [...currentIds].filter((tagId) => !wantedIds.has(tagId));
    if (toDelete.length > 0) {
      await db.applicationTag.deleteMany({
        where: { applicationId, tagId: { in: toDelete } },
      });
    }
    const toAdd = [...wantedIds].filter((tagId) => !currentIds.has(tagId));
    if (toAdd.length > 0) {
      await db.applicationTag.createMany({
        data: toAdd.map((tagId) => ({
          applicationId,
          tagId,
          addedBy: addedBy?.trim() || null,
        })),
      });
    }

    // 3) Write-through legacy agar UI lama tetap konsisten.
    const currentJson = await db.application
      .findUnique({ where: { id: applicationId }, select: { tags: true } })
      .then((row) => row?.tags ?? null);
    if (currentJson !== legacyJson) {
      await db.application.update({
        where: { id: applicationId },
        data: { tags: legacyJson },
      });
    }
  } catch (error) {
    console.error("[tags-sync] syncApplicationTags gagal:", error);
  }
}
