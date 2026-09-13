#!/usr/bin/env bash
# Start keepalive daemon realtime-service sebagai background daemon.
# Aman dijalankan berulang: hanya akan memulai jika belum berjalan.
set -u
PIDFILE="/tmp/lumina-realtime.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "realtime keepalive sudah berjalan (pid $(cat "$PIDFILE"))"
  exit 0
fi

nohup bash /home/z/my-project/scripts/realtime-keepalive.sh >/dev/null 2>&1 &
echo $! > "$PIDFILE"
echo "realtime keepalive dimulai (pid $(cat "$PIDFILE"))"
