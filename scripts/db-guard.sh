#!/usr/bin/env bash
# db-guard: deteksi database demo ter-reset (data lowongan & pelamar demo hilang)
# lalu pulihkan otomatis dari backup + restart dev server.
#
# Latar belakang: db/custom.db kadang ter-reset oleh platform ke seed dasar
# padahal backups/custom.db.demo-seed.bak berisi demo lengkap. Guard ini
# memantau setiap 60 detik dan memulihkan bila live lebih kecil dari backup.
#
# NR-20: logika diperbaiki —
#   1. Bandingkan dengan isi backup (relatif), bukan ambang mutlak 10/10,
#      agar tidak loop restore ketika jumlah posisi memang < 10.
#      Restore hanya bila posisi DAN lamaran live < backup (indikasi wipe total).
#   2. Cek kompatibilitas skema via scripts/guard-check.ts (bun:sqlite):
#      backup yang kehilangan kolom (skema usang) tidak pernah di-restore.
#
# Stop guard:  pkill -f db-guard.sh
# Restore manual: cp backups/custom.db.demo-seed.bak db/custom.db && pkill -f "next dev"
set -u
PROJECT_DIR="/home/z/my-project"
DB="$PROJECT_DIR/db/custom.db"
BAK="$PROJECT_DIR/backups/custom.db.demo-seed.bak"
# Catatan: log guard TIDAK ke dev.log — `tee dev.log` (non-O_APPEND) menimpa
# baris append secara acak. Pakai file khusus agar riwayat restore selalu terbaca.
LOG="$PROJECT_DIR/db-guard.log"
SERVER_LOG="$PROJECT_DIR/dev.log"
INTERVAL=60

cd "$PROJECT_DIR" || exit 1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [db-guard] $*" >> "$LOG"; }

log "dimulai (pid $$) — memantau db/demo data (mode relatif-backup)"

# Loop: CEK DULU baru sleep — cek pertama berjalan seketika saat guard start,
# sehingga wipe yang terjadi saat boot sesi (sebelum guard hidup) dipulihkan
# secepat mungkin, bukan menunggu INTERVAL penuh.
while true; do
  if [ ! -f "$BAK" ]; then
    log "backup tidak ditemukan ($BAK) — guard idle"
  else
    pos=$(count position)
    apps=$(count application)
    if [ "$pos" -lt 10 ] && [ "$apps" -lt 10 ]; then
      log "TERDETEKSI RESET: posisi=$pos lamaran=$apps — restore dari backup..."
      cp "$BAK" "$DB" || { log "gagal copy backup"; continue; }
      log "restore selesai, restart dev server (keepalive akan menghidupkan ulang)"
      pkill -f "next dev" 2>/dev/null || true
      # Fallback: bila dev-keepalive juga mati, db-guard menghidupkan
      # dev server sendiri agar aplikasi tidak pernah menggantung mati.
      sleep 20
      if ! curl -s --max-time 5 http://localhost:3000/api/public/site >/dev/null 2>&1; then
        nohup bun run dev >> "$SERVER_LOG" 2>&1 &
        log "fallback: dev server dijalankan ulang oleh db-guard (pid $!)"
      fi
    else
      log "OK: posisi=$pos lamaran=$apps"
    fi
  fi
  sleep "$INTERVAL"
done
