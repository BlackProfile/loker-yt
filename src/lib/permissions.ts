// SERVER-ONLY — NR46: matriks izin per role (Paket A "Matriks Izin Hidup").
// Satu sumber kebenaran untuk 8 aksi kunci × 3 role. Nilai bawaan mencerminkan
// perilaku rute saat ini; OWNER boleh mempersempit (TIDAK PERNAH memperluas)
// lewat Setting "permission_matrix" — hanya role yang DICABUT tersimpan.
//
// PRINSIP AMAN: can() hanya boleh MENGENCANGKAN akses. OWNER selalu lolos untuk
// semua aksi (proteksi lockout), dan matriks tidak dapat memberi role akses baru.
import { db } from "@/lib/db";
import type { PermissionActionDef, PermissionActionKey, PermissionMatrixView, Role } from "@/lib/types";

type MatrixDefaults = Record<PermissionActionKey, Role[]>;

/** Matriks bawaan = perilaku rute saat ini (sebelum NR46). */
export const DEFAULT_MATRIX: MatrixDefaults = {
  kelola_posisi: ["OWNER", "HR"],
  kelola_lamaran: ["OWNER", "HR"],
  kirim_email: ["OWNER", "HR"],
  ekspor_data: ["OWNER", "HR"],
  lihat_laporan: ["OWNER", "HR", "VIEWER"],
  kelola_pengguna: ["OWNER"],
  pengaturan_sistem: ["OWNER"],
  kesehatan_server: ["OWNER", "HR"],
};

export const ACTION_DEFS: { key: PermissionActionKey; label: string; description: string }[] = [
  { key: "kelola_posisi", label: "Kelola Posisi", description: "Buat, ubah, duplikat, dan tutup lowongan." },
  { key: "kelola_lamaran", label: "Kelola Lamaran", description: "Ubah status, tolak, dan proses lamaran kandidat." },
  { key: "kirim_email", label: "Kirim Email Kandidat", description: "Kirim email manual ke kandidat dari panel." },
  { key: "ekspor_data", label: "Ekspor Data", description: "Unduh CSV/ekspor data lamaran dan laporan." },
  { key: "lihat_laporan", label: "Lihat Laporan", description: "Akses laporan, analitik, dan funnel rekrutmen." },
  { key: "kelola_pengguna", label: "Kelola Pengguna", description: "Tambah, ubah role, dan hapus akun admin." },
  { key: "pengaturan_sistem", label: "Pengaturan Sistem", description: "Ubah pengaturan situs, integrasi, dan sistem." },
  { key: "kesehatan_server", label: "Kesehatan Server", description: "Aksi panel kesehatan server (cache, mode hemat, demo)." },
];

const SETTING_KEY = "permission_matrix";
const CACHE_MS = 60_000;
let cache: { overrides: Partial<Record<PermissionActionKey, Role[]>>; at: number } | null = null;

async function readOverrides(): Promise<Partial<Record<PermissionActionKey, Role[]>>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.overrides;
  let overrides: Partial<Record<PermissionActionKey, Role[]>> = {};
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (row) {
      const parsed: unknown = JSON.parse(row.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const raw = parsed as Record<string, unknown>;
        const clean: Partial<Record<PermissionActionKey, Role[]>> = {};
        for (const def of ACTION_DEFS) {
          const val = raw[def.key];
          if (Array.isArray(val)) {
            const roles = val.filter((r): r is Role =>
              r === "OWNER" || r === "HR" || r === "VIEWER"
            );
            // OWNER selalu dipertahankan — matriks hanya boleh mengencangkan non-OWNER.
            clean[def.key] = Array.from(new Set(["OWNER", ...roles] as Role[]));
          }
        }
        overrides = clean;
      }
    }
  } catch {
    overrides = {};
  }
  cache = { overrides, at: now };
  return overrides;
}

function invalidateCache(): void {
  cache = null;
}

/** Matriks efektif untuk tampilan UI (termasuk penanda perubahan dari bawaan). */
export async function getPermissionMatrix(): Promise<PermissionMatrixView> {
  const overrides = await readOverrides();
  let updatedAt: string | null = null;
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY }, select: { updatedAt: true } });
    updatedAt = row ? row.updatedAt.toISOString() : null;
  } catch {
    // diam
  }
  const actions: PermissionActionDef[] = ACTION_DEFS.map((def) => {
    const defaultRoles = [...DEFAULT_MATRIX[def.key]];
    const roles = overrides[def.key] ?? defaultRoles;
    return { ...def, roles, defaultRoles };
  });
  const hasOverrides = Object.keys(overrides).length > 0;
  return { actions, hasOverrides, updatedAt };
}

/** Cek kapabilitas — TIDAK PERNAH melempar; gagal baca = pakai matriks bawaan. */
export async function can(role: Role, action: PermissionActionKey): Promise<boolean> {
  try {
    if (role === "OWNER") return true; // OWNER selalu lolos (anti-lockout)
    const overrides = await readOverrides();
    const roles = overrides[action] ?? DEFAULT_MATRIX[action];
    return roles.includes(role);
  } catch {
    return DEFAULT_MATRIX[action].includes(role);
  }
}

/** Simpan penyempitan matriks (OWNER). `overrides` hanya berisi aksi yang DIUBAH. */
export async function writePermissionOverrides(
  overrides: Partial<Record<PermissionActionKey, Role[]>>,
): Promise<PermissionMatrixView> {
  const clean: Record<string, string[]> = {};
  for (const def of ACTION_DEFS) {
    const val = overrides[def.key];
    if (!Array.isArray(val)) continue;
    const roles = Array.from(
      new Set(
        val.filter((r): r is Role => r === "OWNER" || r === "HR" || r === "VIEWER"),
      ),
    );
    // Simpan hanya bila berbeda dari bawaan (setting tetap ramping).
    if (JSON.stringify([...roles].sort()) !== JSON.stringify([...DEFAULT_MATRIX[def.key]].sort())) {
      clean[def.key] = Array.from(new Set(["OWNER", ...roles] as Role[]));
    }
  }
  const value = JSON.stringify(clean);
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
  invalidateCache();
  return getPermissionMatrix();
}

export function invalidatePermissionCache(): void {
  invalidateCache();
}
