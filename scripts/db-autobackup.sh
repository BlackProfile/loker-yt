#!/usr/bin/env bash
# ============================================================================
# db-autobackup — snapshot database otomatis (pasangan db-guard v3).
#
# db-guard hanya bisa memulihkan SEBAIK-BAIKNYA backup terakhir. Daemon ini
# memastikan backup selalu segar sehingga wipe platform kehilangan data
# maksimal hanya ~INTERVAL menit:
#
#   1. Tiap INTERVAL menit: snapshot db/custom.db -> backups/auto/lumina-latest.db
#      via "VACUUM INTO" (konsisten walau server sedang menulis), ATOMIK
#      (vacuum ke .tmp lalu mv).
#   2. PROTEKSI ANTI-WAVE: snapshot DILEWATI bila isi live lebih sedikit dari
#      latest pada DUA kutub (posisi & lamaran) atau live 0/0 — wipe tidak
#      pernah ikut ter-backup.
#   3. Rotasi harian: begitu hari berganti, latest disalin menjadi
#      lumina-YYYY-MM-DD.db; simpan 14 hari, sisanya dihapus.
#   4. Hormati backups/GUARD_PAUSE (sama dengan db-guard).
#
# Stop:  pkill -f db-autobackup.sh
# Pause: touch backups/GUARD_PAUSE
# Log:   db-autobackup.log
# Mode:  --once = satu iterasi lalu keluar (pengujian)
# ============================================================================
set -u
PROJECT_DIR="/home/z/my-project"
DB="$PROJECT_DIR/db/custom.db"
OPS="$PROJECT_DIR/scripts/db-ops.ts"
AUTO="$PROJECT_DIR/backups/auto"
LATEST="$AUTO/lumina-latest.db"
PAUSE="$PROJECT_DIR/backups/GUARD_PAUSE"
LOG="$PROJECT_DIR/db-autobackup.log"
INTERVAL=900   # 15 menit — data maksimal hilang segini bila wipe terjadi
KEEP_DAYS=14
ONCE=0
[ "${1:-}" = "--once" ] && ONCE=1

cd "$PROJECT_DIR" || exit 1
mkdir -p "$AUTO"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [db-autobackup] $*" >> "$LOG"; }
today() { date +%Y-%m-%d; }

log "dimulai (pid $$) — interval ${INTERVAL}s, retensi ${KEEP_DAYS} hari"

while true; do
  if [ -f "$PAUSE" ]; then
    log "GUARD_PAUSE aktif — idle"
  elif [ ! -f "$DB" ]; then
    log "db live tidak ada — tidak ada yang di-backup (db-guard yang memulihkan)"
  else
    live_out="$(bun "$OPS" count "$DB" 2>>"$LOG")"
    case "$live_out" in
      ERR*) log "live tak terbaca ($live_out) — snapshot dilewati" ;;
      *)
        read -r lpos lapps <<< "$live_out"
        skip=0
        if [ "$lpos" = "0" ] && [ "$lapps" = "0" ]; then
          log "live 0/0 — kemungkinan wipe; snapshot TIDAK dibuat (anti-wipe)"
          skip=1
        elif [ -f "$LATEST" ]; then
          lout="$(bun "$OPS" count "$LATEST" 2>>"$LOG")"
          case "$lout" in
            ERR*) : ;; # latest rusak -> biarkan tertimpa snapshot baru
            *)
              read -r bpos bapps <<< "$lout"
              if [ "$lpos" -lt "$bpos" ] && [ "$lapps" -lt "$bapps" ]; then
                log "live ($lpos/$lapps) < latest ($bpos/$bapps) pada dua kutub — kemungkinan wipe; snapshot DILEWATI"
                skip=1
              fi
              ;;
          esac
        fi

        if [ "$skip" = "0" ]; then
          tmp="$LATEST.tmp"
          vac="$(bun "$OPS" vacuum "$DB" "$tmp" 2>>"$LOG")"
          case "$vac" in
            OK*)
              chmod 644 "$tmp"
              mv -f "$tmp" "$LATEST"
              log "snapshot: lumina-latest.db ($vac bytes) — live pos=$lpos apps=$lapps"
              ;;
            *) log "VACUUM gagal: $vac" ;;
          esac
        fi

        # Rotasi harian: file lumina-YYYY-MM-DD.db (bukan latest) dibuat 1x/hari.
        daily="$AUTO/lumina-$(today).db"
        if [ "$skip" = "0" ] && [ ! -f "$daily" ]; then
          vdaily="$(bun "$OPS" vacuum "$DB" "$daily.tmp" 2>>"$LOG")"
          case "$vdaily" in
            OK*)
              chmod 644 "$daily.tmp"
              mv -f "$daily.tmp" "$daily"
              log "backup harian: $(basename "$daily") ($vdaily bytes)"
              ;;
            *) log "backup harian gagal: $vdaily" ;;
          esac
        fi

        # Prune: simpan KEEP_DAYS file harian terbaru.
        ls -t "$AUTO"/lumina-2*.db 2>/dev/null | tail -n +$((KEEP_DAYS + 1)) | while IFS= read -r old; do
          rm -f "$old" && log "rotasi: hapus $(basename "$old")"
        done
        ;;
    esac
  fi

  [ "$ONCE" = "1" ] && break
  sleep "$INTERVAL"
done
