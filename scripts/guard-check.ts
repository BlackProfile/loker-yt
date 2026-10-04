/**
 * NR-20 — pemeriksa kesehatan DB untuk db-guard.
 * Bandingkan DB live vs backups/custom.db.demo-seed.bak:
 *  - RESTORE bila posisi DAN lamaran live lebih sedikit dari backup
 *    (indikasi wipe platform) DAN skema backup masih kompatibel.
 *  - SKIP_STALE_BAK bila backup kehilangan kolom yang dimiliki live
 *    (skema berubah — restore akan merusak aplikasi).
 *  - OK selain itu (live sama/lebih banyak, atau hanya satu tabel berkurang
 *    = penghapusan biasa, bukan wipe).
 * Output satu baris token di stdout; log detail via stderr.
 */
import { Database } from "bun:sqlite";

const LIVE = "/home/z/my-project/db/custom.db";
const BAK = "/home/z/my-project/backups/custom.db.demo-seed.bak";

function stats(path: string, readonly: boolean) {
  const d = new Database(path, { readonly });
  const pos = (d.query(`SELECT COUNT(*) c FROM Position WHERE deletedAt IS NULL`).get() as any).c;
  const apps = (d.query(`SELECT COUNT(*) c FROM Application`).get() as any).c;
  const cols = (t: string) => d.prepare(`PRAGMA table_info(${t})`).all().map((r: any) => r.name as string);
  const schema = {
    Position: cols("Position"),
    Application: cols("Application"),
    AdminUser: cols("AdminUser"),
  };
  d.close();
  return { pos, apps, schema };
}

try {
  const live = stats(LIVE, true);
  const bak = stats(BAK, true);

  // Skema backup tidak boleh kehilangan kolom yang ada di live
  const missing: string[] = [];
  for (const table of ["Position", "Application", "AdminUser"] as const) {
    for (const c of live.schema[table]) {
      if (!bak.schema[table].includes(c)) missing.push(`${table}.${c}`);
    }
  }

  if (missing.length > 0) {
    console.log("SKIP_STALE_BAK");
    console.error(`[db-guard] backup usang, kolom hilang: ${missing.join(", ")}`);
  } else if (live.pos < bak.pos && live.apps < bak.apps) {
    console.log("RESTORE");
    console.error(`[db-guard] wipe terdeteksi: live pos=${live.pos} apps=${live.apps} < backup pos=${bak.pos} apps=${bak.apps}`);
  } else {
    console.log("OK");
    console.error(`[db-guard] sehat: live pos=${live.pos} apps=${live.apps} | backup pos=${bak.pos} apps=${bak.apps}`);
  }
} catch (e) {
  // Gagal baca -> jangan restore (aman), cukup log
  console.log("OK");
  console.error(`[db-guard] pemeriksaan gagal (tidak restore): ${e}`);
}
