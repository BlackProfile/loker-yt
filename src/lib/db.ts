import { PrismaClient } from '@prisma/client'

// NR70 — version pembangun schema: bila berubah (mis. model baru ditambahkan
// & `db:push` membangun ulang client), instance PrismaClient global di-restart
// agar runtime memakai schema terbaru. Tanpa ini, instance lama (tanpa model
// baru) tetap dipakai lintas hot-reload Next.js dev server.
const SCHEMA_BUILD_VERSION = 'nr70-referral-1'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion?: string
}

// Versi berubah -> tutup instance lama & buat ulang agar client runtime
// mengenali skema (mis. unique constraint baru) yang dihasilkan terbaru.
if (
  globalForPrisma.prisma &&
  globalForPrisma.prismaSchemaVersion !== SCHEMA_BUILD_VERSION
) {
  try {
    void globalForPrisma.prisma.$disconnect()
  } catch {
    // abaikan: operasi fire-and-forget
  }
  globalForPrisma.prisma = undefined
}
globalForPrisma.prismaSchemaVersion = SCHEMA_BUILD_VERSION

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// NR58 (C7) — tuning SQLite agar lalu lintas tinggi tidak membuat pembacaan
// mengantre di belakang penulisan (pola "server berat tapi tidak terasa"):
// - journal_mode=WAL  : pembaca (landing publik, panel admin) tidak terkunci
//   oleh penulis (submit lamaran, update status) dan sebaliknya.
// - synchronous=NORMAL: aman bersama WAL, menurunkan latensi tulis.
// - busy_timeout=5000 : operasi menunggu maks 5 dtk alih-alih gagal instan
//   dengan "database is locked" saat ada lonjakan.
// - wal_checkpoint TRUNCATE sekali di awal: menjaga file -wal tetap ramping
//   sehingga backup salinan (VACUUM INTO / cp) tetap konsisten.
// Dijalankan SEKALI per proses, fire-and-forget: kegagalan pragma (mis. FS
// tidak mendukung WAL) TIDAK boleh menggagalkan aplikasi.
const globalForPrismaPragma = globalThis as unknown as {
  __luminaPragmaInit?: Promise<void>
}

async function initSqlitePragmas(): Promise<void> {
  try {
    await db.$executeRawUnsafe('PRAGMA journal_mode=WAL;')
    await db.$executeRawUnsafe('PRAGMA synchronous=NORMAL;')
    await db.$executeRawUnsafe('PRAGMA busy_timeout=5000;')
    await db.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);')
  } catch {
    // diam — bekerja dengan mode journal bawaan bila pragma gagal
  }
}

if (!globalForPrismaPragma.__luminaPragmaInit) {
  globalForPrismaPragma.__luminaPragmaInit = initSqlitePragmas()
}