#!/usr/bin/env bash
# Keepalive daemon untuk mini-service telegram-bot (poller, port 3004).
# Pola sama dengan realtime-keepalive.sh: bash loop daemon yang terbukti survive
# di sandbox. Setiap 10 detik cek /health; jika down, jalankan ulang service.
# Tanpa poller hidup, bot Telegram tidak pernah menerima pesan masuk (tidak
# menjawab perintah apa pun), jadi service ini wajib selalu menyala.
set -u
LOG="/home/z/my-project/telegram-bot.log"
SERVICE_DIR="/home/z/my-project/mini-services/telegram-bot"
INTERVAL=10

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

log "[keepalive] dimulai (pid $$)"

while true; do
  if curl -s --max-time 3 http://localhost:3004/health >/dev/null 2>&1; then
    : # service sehat
  else
    log "[keepalive] telegram-bot DOWN, menjalankan ulang..."
    cd "$SERVICE_DIR" || { log "[keepalive] gagal cd $SERVICE_DIR"; sleep "$INTERVAL"; continue; }
    nohup bun run dev >> "$LOG" 2>&1 &
    log "[keepalive] restart dipicu (pid $!)"
  fi
  sleep "$INTERVAL"
done
