#!/usr/bin/env bash
# ============================================================
# start-all-guards.sh — Lumina Studio "anti-hilang" guard stack
#
# Memulai SELURUH daemon pelindung secara idempoten (aman dipanggil
# berulang, hanya memulai yang belum jalan):
#   1. dev-keepalive        — restart dev server bila port 3000 mati
#   2. db-guard             — restore DB dari backup bila data demo ter-reset
#   3. auto-push            — commit + push tiap perubahan ke GitHub
#   4. realtime-keepalive   — restart socket.io service (:3003)
#   5. telegram-keepalive   — restart telegram poller (:3004)
#
# Dipanggil otomatis oleh `bun run dev` (lihat package.json) sehingga
# setiap sesi/boot sandbox selalu membawa stack pelindung penuh.
# ============================================================
set -u
cd /home/z/my-project || exit 0

is_running() {
  # $1 = pidfile, $2 = pola nama script di /proc/PID/cmdline
  local pidfile="$1" pattern="$2" pid
  [ -f "$pidfile" ] || return 1
  pid="$(cat "$pidfile" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q "$pattern" || return 1
  return 0
}

start_one() {
  # $1 = pidfile, $2 = pola nama, $3 = path script, $4 = label
  local pidfile="$1" pattern="$2" script="$3" label="$4"
  if is_running "$pidfile" "$pattern"; then
    echo "[guards] $label sudah berjalan (pid $(cat "$pidfile"))"
  else
    rm -f "$pidfile"
    nohup bash "$script" >/dev/null 2>&1 &
    echo $! > "$pidfile"
    echo "[guards] $label dimulai (pid $(cat "$pidfile"))"
  fi
}

# Urutan penting: dev-keepalive dulu (agar restore db-guard selalu
# disusul restart dev server otomatis), lalu db-guard (cek pertama
# langsung tanpa sleep — memulihkan wipe saat boot sesegera mungkin).
start_one /tmp/lumina-dev.pid        "dev-keepalive.sh"        /home/z/my-project/scripts/dev-keepalive.sh        "dev-keepalive"
start_one /tmp/lumina-dbguard.pid    "db-guard.sh"             /home/z/my-project/scripts/db-guard.sh             "db-guard"
start_one /tmp/lumina-autopush.pid   "auto-push.sh"            /home/z/my-project/scripts/auto-push.sh            "auto-push"
start_one /tmp/lumina-realtime.pid   "realtime-keepalive.sh"   /home/z/my-project/scripts/realtime-keepalive.sh   "realtime-keepalive"
start_one /tmp/lumina-telegram.pid   "telegram-keepalive.sh"   /home/z/my-project/scripts/telegram-keepalive.sh   "telegram-keepalive"

exit 0
