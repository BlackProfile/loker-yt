import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

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