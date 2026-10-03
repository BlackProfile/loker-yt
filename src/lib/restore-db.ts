// SERVER-ONLY — logika pemulihan (restore) database SQLite dari buffer backup.
// Diekstrak dari src/app/api/admin/restore/route.ts agar bisa dipakai DUA route:
//   1. POST /api/admin/restore (unggah file .db manual)
//   2. POST /api/admin/backups (restore dari galeri backup otomatis backups/auto)
// Alur: simpan buffer ke /tmp -> validasi header SQLite ("SQLite format 3\0")
// -> baca daftar tabel user via bun:sqlite (fallback node:sqlite pada runtime Node)
// -> dalam SATU transaksi Prisma: DELETE FROM tiap tabel lalu INSERT ulang baris
//    dari backup (hanya kolom irisan live DB ∩ backup; kolom baru diabaikan).
// Gagal di tengah jalan => transaksi di-rollback otomatis, tidak ada perubahan disimpan.
import { unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";

const SQLITE_HEADER = "SQLite format 3\0";
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024; // batas wajar file backup
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const EXCLUDED_TABLES = new Set(["_prisma_migrations"]);

/** Error khusus input backup tidak valid (header bukan SQLite) — dipetakan ke HTTP 400. */
export class RestoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreValidationError";
  }
}

/* ----------------------- Driver SQLite bawaan runtime ----------------------- */

// Tipe minimal yang sama-sama dipunyai bun:sqlite (Database) dan node:sqlite
// (DatabaseSync) — cukup untuk membaca daftar tabel, kolom, dan seluruh baris.
type SqliteRow = Record<string, unknown>;
type SqliteDatabase = {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  close(): void;
};

/**
 * Ambil konstruktor database SQLite dari modul (bun:sqlite / node:sqlite).
 * Mengembalikan null bila modul tidak tersedia di runtime aktif.
 */
function sqliteCtorOf(mod: Record<string, unknown>): (new (p: string) => SqliteDatabase) | null {
  const Ctor = (mod.Database ?? mod.DatabaseSync) as
    | (new (p: string) => SqliteDatabase)
    | undefined;
  return typeof Ctor === "function" ? Ctor : null;
}

/**
 * Buka file SQLite read via driver bawaan runtime.
 * Spesifier disusun sebagai string runtime (bukan literal statis) agar bundler
 * tidak mencoba resolve modul bawaan yang kebetulan tidak ada di runtime aktif:
 * - `bun run start` produksi memakai Bun -> bun:sqlite
 * - dev server `next dev` berjalan di Node -> node:sqlite (fallback)
 * Dua strategi per spesifier:
 *   1. dynamic import native (magic comment webpackIgnore/turbopackIgnore agar
 *      bundler membiarkan import dieksekusi runtime — tanpa itu, import variabel
 *      di-intersepsi dan gagal "Cannot find module 'node:sqlite'");
 *   2. require via createRequire (node: builtins tereksternalisasi aman).
 */
async function openSqlite(filePath: string): Promise<SqliteDatabase> {
  const candidates: string[] = ["bun:sqlite", "node:sqlite"];
  let lastError: unknown = null;
  for (const spec of candidates) {
    try {
      const mod = (await import(
        /* webpackIgnore: true */ /* turbopackIgnore: true */ spec
      )) as Record<string, unknown>;
      const Ctor = sqliteCtorOf(mod);
      if (Ctor) return new Ctor(filePath);
      throw new Error("konstruktor tidak ditemukan");
    } catch (error) {
      lastError = error;
    }
    try {
      const req = createRequire(path.join(process.cwd(), "package.json"));
      const mod = req(spec) as Record<string, unknown>;
      const Ctor = sqliteCtorOf(mod);
      if (Ctor) return new Ctor(filePath);
      throw new Error("konstruktor tidak ditemukan");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `Tidak ada driver SQLite bawaan (butuh bun:sqlite atau node:sqlite): ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/* ------------------------------ Helper nilai ------------------------------ */

/** Normalisasi nilai dari driver SQLite menjadi parameter yang diterima Prisma. */
function toPrismaParam(value: unknown): string | number | bigint | Buffer | null {
  if (value === undefined || value === null) return null;
  if (value instanceof Uint8Array) return Buffer.from(value); // BLOB
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : value.toString(); // teks bila di luar aman
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  return String(value);
}

type ForeignKeyDeps = Map<string, string[]>;

/**
 * Urutan DELETE: tabel anak (memegang FK) harus dikosongkan lebih dulu dari
 * induknya agar tidak melanggar foreign key. Khan's algorithm pada relasi
 * "anak sebelum induk". Tabel bersiklus diletakkan terakhir (praktis tidak ada).
 */
function deleteOrderOf(tables: string[], deps: ForeignKeyDeps): string[] {
  const after = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const t of tables) {
    after.set(t, new Set());
    indegree.set(t, 0);
  }
  for (const [child, parents] of deps) {
    for (const parent of parents) {
      if (!indegree.has(parent)) continue; // parent ikut di-restore? kalau tidak, abaikan
      const set = after.get(child)!;
      if (!set.has(parent)) {
        set.add(parent);
        indegree.set(parent, (indegree.get(parent) ?? 0) + 1);
      }
    }
  }
  const queue = tables.filter((t) => (indegree.get(t) ?? 0) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);
    for (const next of after.get(current) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) queue.push(next);
    }
  }
  for (const t of tables) {
    if (!order.includes(t)) order.push(t); // siklus (fallback)
  }
  return order;
}

/* ------------------------------ Fungsi utama ------------------------------ */

/**
 * Pulihkan isi database dari buffer file backup .db.
 * Mengembalikan jumlah baris yang ditulis ulang per tabel.
 * Melempar RestoreValidationError bila buffer bukan database SQLite;
 * error lain dilempar apa adanya (transaksi sudah di-rollback otomatis).
 */
export async function restoreDatabaseFromBuffer(buffer: Buffer): Promise<{
  restored: Record<string, number>;
}> {
  if (buffer.length <= 0) {
    throw new RestoreValidationError("File backup kosong.");
  }
  if (buffer.length > MAX_BACKUP_BYTES) {
    throw new RestoreValidationError("Ukuran file backup melebihi batas 200 MB.");
  }

  // Simpan buffer ke /tmp — file sementara dihapus di akhir.
  const tmpPath = path.join(
    tmpdir(),
    `lumina-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`,
  );
  let backupDb: SqliteDatabase | null = null;

  try {
    await writeFile(tmpPath, buffer);

    // Validasi header SQLite (16 byte pertama).
    if (
      buffer.length < 16 ||
      !buffer.subarray(0, 16).equals(Buffer.from(SQLITE_HEADER, "utf8"))
    ) {
      throw new RestoreValidationError(
        "File bukan database SQLite yang valid (header 'SQLite format 3' tidak ditemukan).",
      );
    }

    backupDb = await openSqlite(tmpPath);

    // Daftar tabel user dari backup (exclude sqlite_* dan _prisma_migrations).
    const tableRows = backupDb
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations'",
      )
      .all() as SqliteRow[];
    const tables = tableRows
      .map((row) => String(row.name ?? ""))
      .filter((name) => name.length > 0 && IDENTIFIER_RE.test(name) && !EXCLUDED_TABLES.has(name));

    if (tables.length === 0) {
      throw new RestoreValidationError("File backup tidak memuat tabel aplikasi apa pun.");
    }

    // Kolom & seluruh baris per tabel dari BACKUP (prepared statement all()).
    const backupColumns = new Map<string, string[]>();
    const backupRows = new Map<string, SqliteRow[]>();
    for (const table of tables) {
      const columnRows = backupDb
        .prepare("SELECT name FROM pragma_table_info(?)")
        .all(table) as SqliteRow[];
      backupColumns.set(table, columnRows.map((row) => String(row.name ?? "")));
      backupRows.set(table, backupDb.prepare(`SELECT * FROM "${table}"`).all() as SqliteRow[]);
    }

    // Transaksi tunggal: DELETE semua baris lalu INSERT ulang dari backup.
    // Bila salah satu gagal — rollback otomatis, DB tetap utuh.
    const restored = await db.$transaction(
      async (tx) => {
        // Kolom tabel di DB saat ini + dependensi foreign key (urutan aman).
        const liveColumns = new Map<string, string[]>();
        const deps: ForeignKeyDeps = new Map();
        for (const table of tables) {
          const columnRows = (await tx.$queryRawUnsafe(
            "SELECT name FROM pragma_table_info(?)",
            table,
          )) as Array<{ name: unknown }>;
          if (!Array.isArray(columnRows) || columnRows.length === 0) continue; // tabel tak ada lagi — lewati
          liveColumns.set(table, columnRows.map((row) => String(row.name)));
          const fkRows = (await tx.$queryRawUnsafe(
            'SELECT "table" AS target FROM pragma_foreign_key_list(?)',
            table,
          )) as Array<{ target: unknown }>;
          deps.set(
            table,
            (Array.isArray(fkRows) ? fkRows : [])
              .map((row) => String(row.target ?? ""))
              .filter((target) => target !== table), // self-reference diabaikan
          );
        }

        const restorable = tables.filter((t) => liveColumns.has(t));
        const deleteOrder = deleteOrderOf(restorable, deps);
        const insertOrder = [...deleteOrder].reverse();

        const counts: Record<string, number> = {};

        // 1) Kosongkan tiap tabel (children dulu agar aman FK).
        for (const table of deleteOrder) {
          await tx.$executeRawUnsafe(`DELETE FROM "${table}"`);
        }

        // 2) Isi ulang dari backup (parents dulu) — hanya kolom irisan.
        for (const table of insertOrder) {
          const live = liveColumns.get(table);
          if (!live) continue;
          const columns = (backupColumns.get(table) ?? []).filter((column) =>
            live.includes(column),
          );
          if (columns.length === 0) continue; // tidak ada kolom yang cocok
          const rows = backupRows.get(table) ?? [];
          const sql = `INSERT INTO "${table}" (${columns
            .map((column) => `"${column}"`)
            .join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
          for (const row of rows) {
            const params = columns.map((column) => toPrismaParam(row[column]));
            await tx.$executeRawUnsafe(sql, ...params);
          }
          counts[table] = rows.length;
        }

        return counts;
      },
      { timeout: 120_000, maxWait: 15_000 },
    );

    return { restored };
  } finally {
    try {
      backupDb?.close();
    } catch {
      // abaikan
    }
    await unlink(tmpPath).catch(() => {
      // abaikan kegagalan hapus file sementara
    });
  }
}
