#!/usr/bin/env bash
# Start keepalive daemon mini-service telegram-bot sebagai background daemon.
# Aman dijalankan berulang: hanya akan memulai jika belum berjalan.
set -u
PIDFILE="/tmp/lumina-telegram.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "telegram keepalive sudah berjalan (pid $(cat "$PIDFILE"))"
  exit 0
fi

nohup bash /home/z/my-project/scripts/telegram-keepalive.sh >/dev/null 2>&1 &
echo $! > "$PIDFILE"
echo "telegram keepalive dimulai (pid $(cat "$PIDFILE"))"
