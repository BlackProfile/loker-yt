#!/usr/bin/env bash
# Start auto-push watcher sebagai background daemon.
# Aman dijalankan berulang: hanya akan memulai jika belum berjalan.
set -u
PIDFILE="/tmp/lumina-autopush.pid"

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "auto-push sudah berjalan (pid $(cat "$PIDFILE"))"
  exit 0
fi

nohup bash /home/z/my-project/scripts/auto-push.sh >/dev/null 2>&1 &
echo $! > "$PIDFILE"
echo "auto-push dimulai (pid $(cat "$PIDFILE"))"
