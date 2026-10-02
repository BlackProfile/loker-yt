#!/usr/bin/env bash
# db-guard: deteksi database demo ter-reset (data lowongan & pelamar demo hilang)
# lalu pulihkan otomatis dari backup + restart dev server.
#
# Latar belakang: db/custom.db pernah ter-reset sendiri ke seed dasar
# (5 posisi / 5 lamaran) padahal seed demo berisi 20 posisi / 36 lamaran.
# Guard ini memantau setiap 60 detik; bila posisi < 10 DAN lamaran < 10
# (indikasi wipe total, bukan penghapusan biasa), restore backup.
#
# Stop guard:  pkill -f db-guard.sh
# Restore manual: cp backups/custom.db.demo-seed.bak db/custom.db && pkill -f "next dev"
set -u
PROJECT_DIR="/home/z/my-project"
DB="$PROJECT_DIR/db/custom.db"
BAK="$PROJECT_DIR/backups/custom.db.demo-seed.bak"
LOG="$PROJECT_DIR/dev.log"
INTERVAL=60

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [db-guard] $*" >> "$LOG"; }

log "dimulai (pid $$) — memantau db/demo data"

count() {
  # Hitung jumlah baris tabel via bun+prisma; output angka, gagal => 0
  bun -e "import {PrismaClient} from '@prisma/client'; const db=new PrismaClient(); process.stdout.write(String(await db.$1.count())); await db.\$disconnect();" 2>/dev/null || echo 0
}

while true; do
  sleep "$INTERVAL"
  if [ ! -f "$BAK" ]; then
    log "backup tidak ditemukan ($BAK) — guard idle"
    continue
  fi
  pos=$(count position)
  apps=$(count application)
  if [ "$pos" -lt 10 ] && [ "$apps" -lt 10 ]; then
    log "TERDETEKSI RESET: posisi=$pos lamaran=$apps — restore dari backup..."
    cp "$BAK" "$DB" || { log "gagal copy backup"; continue; }
    log "restore selesai, restart dev server (keepalive akan menghidupkan ulang)"
    pkill -f "next dev" 2>/dev/null || true
  else
    log "OK: posisi=$pos lamaran=$apps"
  fi
done
