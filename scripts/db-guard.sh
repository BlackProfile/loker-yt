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
LOG="$PROJECT_DIR/dev.log"
INTERVAL=60

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [db-guard] $*" >> "$LOG"; }

log "dimulai (pid $$) — memantau db/demo data (mode relatif-backup)"

while true; do
  sleep "$INTERVAL"
  if [ ! -f "$BAK" ]; then
    log "backup tidak ditemukan ($BAK) — guard idle"
    continue
  fi
  decision=$(bun "$PROJECT_DIR/scripts/guard-check.ts" 2>>"$LOG")
  token=$(echo "$decision" | head -1)
  case "$token" in
    RESTORE)
      cp "$BAK" "$DB" || { log "gagal copy backup"; continue; }
      log "restore selesai, restart dev server (keepalive akan menghidupkan ulang)"
      pkill -f "next dev" 2>/dev/null || true
      ;;
    SKIP_STALE_BAK)
      # alasan sudah dicatat guard-check.ts ke dev.log via stderr
      ;;
    *)
      # OK — live sehat
      ;;
  esac
done
