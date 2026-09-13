#!/usr/bin/env bash
# Keepalive daemon untuk dev server Next.js (port 3000).
# Pola sama dengan realtime-keepalive.sh: bash loop daemon yang terbukti
# survive di sandbox (nohup polos bisa mati). Setiap 10 detik cek endpoint
# publik; jika down, jalankan ulang `bun run dev`.
set -u
LOG="/home/z/my-project/dev.log"
PROJECT_DIR="/home/z/my-project"
INTERVAL=10

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [dev-keepalive] $*" >> "$LOG"; }

log "dimulai (pid $$)"

while true; do
  if curl -s --max-time 5 http://localhost:3000/api/public/site >/dev/null 2>&1; then
    : # dev server sehat
  else
    log "dev server DOWN, menjalankan ulang..."
    cd "$PROJECT_DIR" || { log "gagal cd $PROJECT_DIR"; sleep "$INTERVAL"; continue; }
    nohup bun run dev >> "$LOG" 2>&1 &
    log "restart dipicu (pid $!)"
    sleep 15
  fi
  sleep "$INTERVAL"
done
