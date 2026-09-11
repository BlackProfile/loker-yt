#!/usr/bin/env bash
# ============================================================
# Auto-Push Watcher - Lumina Studio
# Otomatis commit & push setiap perubahan ke GitHub.
# Dijalankan sebagai background daemon (lihat start-auto-push.sh)
# ============================================================
set -u
cd /home/z/my-project || exit 1

LOCK="/tmp/lumina-autopush.lock"
LOG="/home/z/my-project/auto-push.log"
BRANCH="main"
INTERVAL=60

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

# Rotasi log sederhana (maks ~500 baris)
rotate_log() {
  if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
    tail -n 200 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

log "auto-push watcher dimulai (interval ${INTERVAL}s)"

while true; do
  if mkdir "$LOCK" 2>/dev/null; then
    # 1) Commit jika ada perubahan (termasuk file baru/hapus)
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
      git add -A
      if git commit -m "auto-sync: perubahan aplikasi $(date '+%Y-%m-%d %H:%M:%S')" >/dev/null 2>&1; then
        log "commit dibuat: $(git rev-parse --short HEAD 2>/dev/null)"
      fi
    fi

    # 2) Push hanya jika commit lokal belum ada di remote
    LOCAL=$(git rev-parse HEAD 2>/dev/null || echo "")
    REMOTE=$(git rev-parse "origin/${BRANCH}" 2>/dev/null || echo "")
    if [ -n "$LOCAL" ] && [ "$LOCAL" != "$REMOTE" ]; then
      if git push origin "$BRANCH" >/dev/null 2>>"$LOG"; then
        log "push OK -> ${LOCAL:0:7}"
      else
        log "push GAGAL (cek koneksi/token)"
      fi
    fi

    rotate_log
    rmdir "$LOCK" 2>/dev/null
  fi
  sleep "$INTERVAL"
done
