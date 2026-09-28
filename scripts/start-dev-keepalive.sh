#!/usr/bin/env bash
# Start keepalive daemon dev server sebagai background daemon.
# Aman dijalankan berulang: hanya akan memulai jika belum berjalan.
set -u
PIDFILE="/tmp/lumina-dev.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "dev keepalive sudah berjalan (pid $(cat "$PIDFILE"))"
  exit 0
fi

nohup bash /home/z/my-project/scripts/dev-keepalive.sh >/dev/null 2>&1 &
echo $! > "$PIDFILE"
echo "dev keepalive dimulai (pid $(cat "$PIDFILE"))"
