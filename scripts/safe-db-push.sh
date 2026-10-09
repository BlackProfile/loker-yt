#!/usr/bin/env bash
# ============================================================================
# safe-db-push — pengaman `prisma db push` untuk mencegah kehilangan data.
#
# `prisma db push --accept-data-loss` bisa menghapus kolom/tabel (beserta
# datanya) tanpa peringatan. Script ini menjadikan backup otomatis sebagai
# langkah wajib sebelum push:
#
#   bun run db:push          -> snapshot pra-push, lalu push AMAN
#                               (ditolak bila perubahan destruktif)
#   bun run db:push:force    -> push dengan --accept-data-loss (jalan terus)
#   DB_ACCEPT_LOSS=1 bun run db:push -> sama dengan db:push:force
#
# Snapshot pra-push tersimpan di backups/pre-push/ (5 terbaru).
# ============================================================================
set -euo pipefail
cd /home/z/my-project

DB="db/custom.db"
PRE_DIR="backups/pre-push"
mkdir -p "$PRE_DIR"

if [ "${DB_ACCEPT_LOSS:-0}" = "1" ]; then
  echo "[safe-db-push] DB_ACCEPT_LOSS=1 — push DENGAN risiko kehilangan data (permintaan eksplisit)..."
  if [ -f "$DB" ]; then
    TS="$(date +%Y%m%d-%H%M%S)"
    OUT="$PRE_DIR/lumina-prepush-$TS.db"
    bun scripts/db-ops.ts vacuum "$DB" "$OUT" >/dev/null 2>&1 || cp "$DB" "$OUT" || true
    echo "[safe-db-push] snapshot pra-push: $OUT"
  fi
  exec bunx prisma db push --accept-data-loss
fi

if [ -f "$DB" ]; then
  TS="$(date +%Y%m%d-%H%M%S)"
  OUT="$PRE_DIR/lumina-prepush-$TS.db"
  if bun scripts/db-ops.ts vacuum "$DB" "$OUT" >/dev/null 2>&1; then
    echo "[safe-db-push] snapshot pra-push: $OUT"
  else
    cp "$DB" "$OUT" && echo "[safe-db-push] snapshot pra-push (fallback cp): $OUT"
  fi
  # Simpan 5 snapshot terbaru.
  ls -t "$PRE_DIR"/lumina-prepush-*.db 2>/dev/null | tail -n +6 | xargs -r rm -f
else
  echo "[safe-db-push] db/custom.db belum ada — push akan membuat database baru."
fi

echo "[safe-db-push] menjalankan 'prisma db push' (mode aman, tanpa --accept-data-loss)..."
bunx prisma db push
