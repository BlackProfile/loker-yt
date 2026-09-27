#!/usr/bin/env bash
# Keepalive daemon untuk realtime-service (socket.io mini-service, port 3003).
# Pola sama dengan auto-push.sh: bash loop daemon yang terbukti survive di sandbox.
# Setiap 10 detik cek /health; jika down, jalankan ulang service.
set -u
LOG="/home/z/my-project/realtime.log"
SERVICE_DIR="/home/z/my-project/mini-services/realtime-service"
INTERVAL=10

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "[keepalive] dimulai (pid $$)"

while true; do
  if curl -s --max-time 3 http://localhost:3003/health >/dev/null 2>&1; then
    : # service sehat
  else
    log "[keepalive] realtime DOWN, menjalankan ulang..."
    cd "$SERVICE_DIR" || { log "[keepalive] gagal cd $SERVICE_DIR"; sleep "$INTERVAL"; continue; }
    nohup bun run dev >> "$LOG" 2>&1 &
    log "[keepalive] restart dipicu (pid $!)"
  fi
  sleep "$INTERVAL"
done
