#!/usr/bin/env bash
# ============================================================
# Keepalive daemon anti-race untuk dev server Next.js (port 3000).
#
# Latar (NR41-HMRFIX-2): versi lama spawn ulang `bun run dev` setelah
# SATU health-check gagal (10 dtk). Kompilasi dingin Turbopack butuh
# 20-90 dtk → instance kedua menyusul dan berbagi .next yang sama →
# grafik modul korup → error HMR "module factory is not available".
#
# Invariant utama versi ini: JANGAN PERNAH spawn selama port 3000
# masih menempel / proses server masih terdeteksi — apa pun alasannya.
#
#   1. Ambang kegagalan berturut-turut (FAIL_THRESHOLD x INTERVAL ~ 60 dtk)
#      sebelum bertindak — kompilasi lambat tidak memicu spawn ganda.
#   2. SEBELUM spawn: slot dianggap BUSY bila (a) proses `next dev` /
#      `next-server` ada ATAU (b) port 3000 masih bisa di-connect
#      (tahan terhadap judul proses transient yang bikin pgrep meleset).
#   3. Pengaman macet: health DOWN >= 5 menit + proses terdeteksi →
#      proses dipaksa dihentikan; spawn baru hanya setelah port bebas.
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

port_busy() {
  # Probe TCP murni bash: berhasil connect = port 3000 terpakai.
  if (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
    exec 3>&- 3<&- 2>/dev/null
    return 0
  fi
  return 1
}

dev_slot_busy() {
  # (a) proses server Next.js dev masih ada? Pola longgar menangkap
  # launcher, node dev, dan judul "next-server".
  pgrep -f "next dev" >/dev/null 2>&1 && return 0
  pgrep -f "next-server" >/dev/null 2>&1 && return 0
  # (b) port masih menempel (proses transient / cmdline tidak terdeteksi)?
  port_busy && return 0
  return 1
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

    # Pengaman macet: health gagal >= 5 menit sementara slot busy.
    if [ "$fails" -ge "$STUCK_THRESHOLD" ] && dev_slot_busy; then
      log "DOWN ${fails}x — slot busy tapi tidak sehat, paksa hentikan proses..."
      force_kill_dev
      sleep 3
      # Jika port masih menempel setelah kill, JANGAN spawn — tunggu siklus
      # berikutnya (mencegah dua server berebut .next).
      if port_busy; then
        log "port 3000 masih menempel setelah kill — tunggu, tidak spawn"
        sleep "$INTERVAL"
        continue
      fi
    fi

    if [ "$fails" -ge "$FAIL_THRESHOLD" ]; then
      if dev_slot_busy; then
        # Server masih ada / port masih terpakai — hampir pasti kompilasi.
        # DULU di sini spawn ganda (sumber korupsi .next). Sekarang: tunggu.
        log "DOWN ${fails}x — slot port 3000 masih busy (kemungkinan kompilasi), TIDAK spawn ganda"
      else
        log "dev server DOWN ${fails}x (port bebas) — menjalankan ulang..."
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
