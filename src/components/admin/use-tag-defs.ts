"use client";

// Hook bersama NR-24 (fitur 3 — Tag Bebas): memuat definisi tag tim dari
// /api/admin/tag-defs dan menyediakan pemetaan nama -> kelas warna Tailwind.
// Dipakai applications-table (chip warna), application-detail-dialog
// (pemilih tag cepat), dan settings-tab (pengelolaan daftar tag).

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPut } from "./api";
import { TAG_COLOR_CLASSES, type TagDef } from "@/lib/types";

export function useTagDefs() {
  const [tagDefs, setTagDefs] = useState<TagDef[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (silent = false) => {
    try {
      const data = await apiGet<TagDef[]>("/api/admin/tag-defs");
      setTagDefs(Array.isArray(data) ? data : []);
    } catch {
      // Daftar tag bersifat pelengkap — biarkan kosong saat gagal.
    } finally {
      if (!silent) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Kelas warna untuk satu nama tag (fallback zinc bila tidak terdaftar). */
  const colorClassOf = useCallback(
    (name: string): string => {
      const def = tagDefs.find((d) => d.name.toLowerCase() === name.toLowerCase());
      return TAG_COLOR_CLASSES[def?.color ?? "zinc"] ?? TAG_COLOR_CLASSES.zinc;
    },
    [tagDefs]
  );

  /** Simpan seluruh daftar tag (PUT). Mengembalikan daftar final bila sukses. */
  const save = useCallback(async (next: TagDef[]): Promise<TagDef[]> => {
    const saved = await apiPut<TagDef[]>("/api/admin/tag-defs", next);
    setTagDefs(Array.isArray(saved) ? saved : []);
    return Array.isArray(saved) ? saved : [];
  }, []);

  return { tagDefs, loaded, reload: load, colorClassOf, save };
}
