#!/usr/bin/env bash
# ============================================================================
# db-guard v3 — deteksi & pemulihan OTOMATIS database ter-reset (platform wipe).
#
# Latar belakang: platform sandbox sesekali mengosongkan db/custom.db (pernah
# terjadi 2026-10-09 03:02). v2 lama MATI SUNYI karena fungsi count() tidak
# pernah terdefinisi — log selalu "OK: posisi= lamaran=" dan restore tak
# pernah jalan. v3 menulis ulang seluruh logika:
#
#   1. Hitungan live via scripts/db-ops.ts (bun:sqlite) — selalu ada angka.
#   2. Wipe terdeteksi bila:
#        a) HARD: posisi=0 DAN lamaran=0 (database dikosongkan platform), atau
#        b) RELATIF: posisi DAN lamaran live lebih sedikit dari kandidat
#           backup valid terbaru (pola NR-20; penghapusan sah satu tabel
#           tidak memicu restore).
#   3. Kandidat restore diurutkan TERBARU dulu (mtime):
#        backups/auto/lumina-latest.db  (snapshot rolling db-autobackup)
#        backups/auto/lumina-YYYY-MM-DD.db (harian terbaru)
#        backups/custom.db              (backup akhir sesi kerja)
#        backups/custom.db.*.bak        (snapshot bernama)
#      Setiap kandidat divalidasi db-ops.ts check (header SQLite + tabel
#      wajib + skema tidak usang); kandidat pertama yang lolos dipakai.
#   4. Restore ATOMIK (cp ke .tmp lalu mv) supaya server yang berjalan tidak
#      menulis ke file yang sedang ditimpa, lalu dev server di-restart
#      (dev-keepalive menghidupkan ulang; ada fallback bila keepalive mati).
#   5. Jeda: buat file backups/GUARD_PAUSE (mis. saat bersih-bersih data
#      besar atau migrasi berisiko) — guard dan db-autobackup jadi idle.
#
# Mode khusus:
#   --once       satu iterasi lalu keluar (untuk pengujian)
#   --dry-run    hitung & log keputusan SAJA — tidak restore, tidak kill server
#   LUMINA_DB_PATH=/path  timpa path db live (untuk simulasi wipe)
#
# Stop guard:   pkill -f db-guard.sh
# Pause guard:  touch backups/GUARD_PAUSE   (lanjut lagi: rm backups/GUARD_PAUSE)
# Restore manual: pilih kandidat di log/db-guard.log, lalu:
#   cp <kandidat> db/custom.db && pkill -f "next dev"
# ============================================================================
set -u
PROJECT_DIR="/home/z/my-project"
DB="${LUMINA_DB_PATH:-$PROJECT_DIR/db/custom.db}"
OPS="$PROJECT_DIR/scripts/db-ops.ts"
LOG="$PROJECT_DIR/db-guard.log"
SERVER_LOG="$PROJECT_DIR/dev.log"
PAUSE="$PROJECT_DIR/backups/GUARD_PAUSE"
INTERVAL=60
DRY_RUN=0
ONCE=0
for arg in "$@"; do
  case "$arg" in
    --once) ONCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

cd "$PROJECT_DIR" || exit 1
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [db-guard] $*" >> "$LOG"; }

# Kandidat backup terbaru dulu (mtime), unik.
candidates() {
  ls -t \
    "$PROJECT_DIR"/backups/auto/lumina-latest.db \
    "$PROJECT_DIR"/backups/auto/lumina-2*.db \
    "$PROJECT_DIR"/backups/custom.db \
    "$PROJECT_DIR"/backups/custom.db.*.bak \
    2>/dev/null | awk '!seen[$0]++'
}

# restore <kandidat> <live_pos> <live_apps> — tulis ulang DB lalu restart server.
restore() {
  local cand="$1" lpos="$2" lapps="$3"
  if [ "$DRY_RUN" = "1" ]; then
    log "DRY-RUN: WIPE TERDETEKSI (pos=$lpos apps=$lapps) — akan restore dari $cand"
    return 0
  fi
  log "WIPE TERDETEKSI (pos=$lpos apps=$lapps) — restore dari $cand"
  cp "$cand" "$DB.tmp" || { log "gagal copy kandidat ke $DB.tmp"; return 1; }
  mv -f "$DB.tmp" "$DB" || { log "gagal mv $DB.tmp -> $DB"; return 1; }
  log "restore selesai ($(stat -c%s "$DB" 2>/dev/null || echo '?') bytes) — restart dev server"
  pkill -f "next dev" 2>/dev/null || true
  # Fallback: bila dev-keepalive juga mati, guard hidupkan dev server sendiri.
  sleep 20
  if ! curl -s --max-time 5 http://localhost:3000/api/public/site >/dev/null 2>&1; then
    nohup bun run dev >> "$SERVER_LOG" 2>&1 &
    log "fallback: dev server dijalankan ulang oleh db-guard (pid $!)"
  fi
}

log "dimulai (pid $$) — db-guard v3 (dry_run=$DRY_RUN once=$ONCE, db=$DB)"

while true; do
  if [ -f "$PAUSE" ]; then
    log "GUARD_PAUSE aktif — idle"
  else
    live_out="$(bun "$OPS" count "$DB" 2>>"$LOG")"
    case "$live_out" in
      ERR*) lpos=-1; lapps=-1; log "db live tak terbaca ($live_out) — dianggap wipe keras" ;;
      *) read -r lpos lapps <<< "$live_out" ;;
    esac

    if [ "$lpos" = "0" ] && [ "$lapps" = "0" ]; then
      hard_wipe=1; log "kondisi HARD WIPE: posisi=0 lamaran=0"
    else
      hard_wipe=0
    fi

    restored=0
    while IFS= read -r cand; do
      [ -n "$cand" ] || continue
      chk="$(bun "$OPS" check "$cand" --against "$DB" 2>>"$LOG")"
      case "$chk" in
        OK*) : ;;
        *) log "kandidat $cand ditolak ($chk)"; continue ;;
      esac
      cout="$(bun "$OPS" count "$cand" 2>>"$LOG")"
      case "$cout" in
        ERR*) log "kandidat $cand gagal dihitung ($cout)"; continue ;;
      esac
      read -r cpos capps <<< "$cout"

      if [ "$hard_wipe" = "1" ] || { [ "$cpos" -gt "$lpos" ] && [ "$capps" -gt "$lapps" ]; }; then
        restore "$cand" "$lpos" "$lapps" && restored=1
        break
      fi
    done < <(candidates)

    if [ "$restored" = "0" ]; then
      log "OK: pos=$lpos apps=$lapps (tidak ada indikasi wipe)"
    fi
  fi

  [ "$ONCE" = "1" ] && break
  sleep "$INTERVAL"
done
