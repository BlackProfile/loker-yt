#!/usr/bin/env bash
# ============================================================
# Keepalive daemon anti-race untuk dev server Next.js (port 3000).
#
# Latar (NR41-HMRFIX-2): versi lama spawn ulang `bun run dev` setelah
# SATU health-check gagal (10 dtk). Kompilasi dingin Turbopack butuh
# 20-30 dtk → instance kedua menyusul dan berbagi .next yang sama →
# grafik modul korup → error HMR "module factory is not available".
#
# Perbaikan di versi ini:
#   1. Ambang kegagalan berturut-turut (FAIL_THRESHOLD x INTERVAL ~ 60 dtk)
#      sebelum bertindak — kompilasi lambat tidak lagi memicu spawn ganda.
#   2. SEBELUM spawn: cek apakah proses `next dev` masih hidup; jika hidup,
#      JANGAN spawn (cukup tunggu — kemungkinan besar sedang kompilasi).
#   3. Pengaman macet: jika proses hidup tapi health DOWN >= 5 menit
#      (STUCK_THRESHOLD), proses dipaksa dihentikan lalu di-restart —
#      tanpa ini keepalive bisa menunggu proses zombie selamanya.
# ============================================================
set -u
# Log event guard ke file khusus (dev.log ditulis `tee` non-O_APPEND — baris
# append bisa tertimpa). Output server tetap ke dev.log.
LOG="/home/z/my-project/dev-keepalive.log"
SERVER_LOG="/home/z/my-project/dev.log"
PROJECT_DIR="/home/z/my-project"
INTERVAL=10
FAIL_THRESHOLD=6      # 6 x 10 dtk = ~60 dtk down berturut-turut sebelum spawn
STUCK_THRESHOLD=30    # 30 x 10 dtk = ~5 menit down walaupun proses hidup → paksa restart

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [dev-keepalive] $*" >> "$LOG"; }

next_dev_running() {
  # Proses server Next.js dev: node .../node_modules/.bin/next dev
  pgrep -f "node_modules/\.bin/next dev" >/dev/null 2>&1
}

force_kill_dev() {
  pkill -f "node_modules/\.bin/next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
}

log "dimulai (pid $$)"
fails=0

while true; do
  if curl -s --max-time 5 http://localhost:3000/api/public/site >/dev/null 2>&1; then
    fails=0 # dev server sehat
  else
    fails=$((fails + 1))

    # Pengaman macet: proses hidup tapi health terus gagal >= 5 menit.
    if [ "$fails" -ge "$STUCK_THRESHOLD" ] && next_dev_running; then
      log "DOWN ${fails}x — proses next dev hidup tapi tidak sehat, paksa hentikan..."
      force_kill_dev
      sleep 3
    fi

    if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
      if next_dev_running; then
        # Proses server masih ada — hampir pasti sedang kompilasi.
        # DULU di sini spawn ganda (sumber korupsi .next). Sekarang: tunggu saja.
        log "DOWN ${fails}x — proses next dev masih hidup (kemungkinan kompilasi), TIDAK spawn ganda"
      else
        log "dev server DOWN ${fails}x — menjalankan ulang..."
        cd "$PROJECT_DIR" || { log "gagal cd $PROJECT_DIR"; sleep "$INTERVAL"; continue; }
        nohup bun run dev >> "$SERVER_LOG" 2>&1 &
        log "restart dipicu (pid $!)"
        sleep 20 # beri waktu kompilasi sebelum siklus cek berikutnya
        fails=0
      fi
    fi
  fi
  sleep "$INTERVAL"
done
