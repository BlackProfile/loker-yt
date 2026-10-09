/**
 * db-ops — helper SQLite untuk db-guard & db-autobackup (dijalankan via bun).
 * Catatan: error tsc "Cannot find module 'bun:sqlite'" pada file ini normal —
 * bun-types sengaja TIDAK direferensikan di sini karena referensi global-nya
 * merusak pengetikan File/Buffer di src/ (sudah pernah dicoba & dibatalkan).
 *
 * Sub-perintah:
 *   count <file>
 *     Cetak "pos apps" satu baris (pos = Position deletedAt IS NULL,
 *     apps = total Application). Bila file rusak/tak terbaca -> "ERR <alasan>".
 *
 *   check <file> [--against <live>]
 *     Validasi kandidat backup:
 *       1. file ada & header 16 byte = "SQLite format 3\0"
 *       2. tabel wajib ada: Position, Application, AdminUser
 *       3. bila --against <live>: kolom tabel wajib pada backup harus mencakup
 *          SEMUA kolom tabel yang sama di live (backup tidak usang skema).
 *          Live tak terbaca/missing -> langkah 3 dilewati (hanya cek 1 & 2).
 *     Cetak "OK" (exit 0) atau "BAD <alasan>" (exit 1).
 *
 *   vacuum <sumber> <tujuan>
 *     Snapshot konsisten via "VACUUM INTO" (readonly connection aman dipakai
 *     saat dev server berjalan). Cetak "OK <bytes>" atau "ERR <alasan>".
 *
 * Semua keluaran satu baris ke stdout; detail ke stderr (tidak mengganggu parsing bash).
 */
import { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";

const SQLITE_HEADER = "SQLite format 3\0";
const REQUIRED_TABLES = ["Position", "Application", "AdminUser"] as const;

function fail(msg: string): never {
  console.log(`ERR ${msg}`);
  process.exit(1);
}

function openReadOnly(path: string): Database {
  return new Database(path, { readonly: true });
}

function headerOk(path: string): boolean {
  try {
    const fd = readFileSync(path);
    if (fd.length < 16) return false;
    return fd.subarray(0, 16).toString("utf8") === SQLITE_HEADER;
  } catch {
    return false;
  }
}

function countPair(path: string): { pos: number; apps: number } {
  const d = openReadOnly(path);
  try {
    const pos = (d.query(`SELECT COUNT(*) c FROM Position WHERE deletedAt IS NULL`).get() as { c: number }).c;
    const apps = (d.query(`SELECT COUNT(*) c FROM Application`).get() as { c: number }).c;
    return { pos, apps };
  } finally {
    d.close();
  }
}

function tableColumns(d: Database, table: string): string[] {
  const rows = d.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

function tableExists(d: Database, table: string): boolean {
  const row = d
    .query(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
    .get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

/* --------------------------------- count --------------------------------- */
function cmdCount(file: string): void {
  if (!headerOk(file)) fail(`bukan SQLite valid: ${file}`);
  try {
    const { pos, apps } = countPair(file);
    console.log(`${pos} ${apps}`);
  } catch (e) {
    fail(`gagal baca: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* --------------------------------- check --------------------------------- */
function cmdCheck(file: string, against: string | null): void {
  try {
    statSync(file);
  } catch {
    console.log(`BAD file tidak ada: ${file}`);
    process.exit(1);
  }
  if (!headerOk(file)) {
    console.log(`BAD bukan database SQLite (header tidak cocok): ${file}`);
    process.exit(1);
  }

  let bak: Database;
  try {
    bak = openReadOnly(file);
  } catch (e) {
    console.log(`BAD gagal buka: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  try {
    for (const table of REQUIRED_TABLES) {
      if (!tableExists(bak, table)) {
        console.log(`BAD tabel wajib hilang di backup: ${table}`);
        process.exit(1);
      }
    }

    if (against && headerOk(against)) {
      let live: Database | null = null;
      try {
        live = openReadOnly(against);
      } catch {
        live = null; // live bermasalah -> lewati perbandingan skema
      }
      if (live) {
        try {
          for (const table of REQUIRED_TABLES) {
            if (!tableExists(live, table)) continue; // live tak punya tabel -> abaikan
            const liveCols = tableColumns(live, table);
            const bakCols = new Set(tableColumns(bak, table));
            const missing = liveCols.filter((c) => !bakCols.has(c));
            if (missing.length > 0) {
              console.log(`BAD backup usang — ${table} kehilangan kolom: ${missing.join(", ")}`);
              process.exit(1);
            }
          }
        } finally {
          live.close();
        }
      }
    }

    console.log("OK");
    process.exit(0);
  } finally {
    bak.close();
  }
}

/* -------------------------------- vacuum --------------------------------- */
function cmdVacuum(source: string, target: string): void {
  if (!headerOk(source)) fail(`sumber bukan SQLite valid: ${source}`);
  let d: Database;
  try {
    d = openReadOnly(source);
  } catch (e) {
    fail(`gagal buka sumber: ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    d.exec(`VACUUM INTO '${target}'`);
    const bytes = statSync(target).size;
    console.log(`OK ${bytes}`);
  } catch (e) {
    fail(`VACUUM INTO gagal: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    try {
      d.close();
    } catch {
      /* abaikan */
    }
  }
}

/* ---------------------------------- main ---------------------------------- */
const [, , cmd, ...rest] = process.argv;

if (cmd === "count" && rest[0]) {
  cmdCount(rest[0]);
} else if (cmd === "check" && rest[0]) {
  const againstIdx = rest.indexOf("--against");
  const against = againstIdx >= 0 ? (rest[againstIdx + 1] ?? null) : null;
  cmdCheck(rest[0], against);
} else if (cmd === "vacuum" && rest[0] && rest[1]) {
  cmdVacuum(rest[0], rest[1]);
} else {
  console.error("pakai: db-ops.ts count <file> | check <file> [--against <live>] | vacuum <sumber> <tujuan>");
  process.exit(2);
}
