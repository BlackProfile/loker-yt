# NR-19-b — full-stack-developer

Task: Backup otomatis harian + galeri backup (ide 3), impor lamaran dari file CSV/Excel (ide 8), export Excel XLSX multi-sheet (ide 9).

## File diubah / dibuat

| File | Status | Isi |
|---|---|---|
| `package.json` | ubah | `bun add xlsx` (SheetJS 0.18.5) |
| `src/lib/restore-db.ts` | BARU | `restoreDatabaseFromBuffer(buffer)` + `RestoreValidationError` — logika restore diekstrak dari route restore (tmp file, validasi header SQLite, baca tabel via sqlite bawaan, transaksi DELETE+INSERT kolom irisan) |
| `src/app/api/admin/restore/route.ts` | refactor minimal | Auth/multipart/response identik; inti restore dipanggil dari lib; error validasi → 400 |
| `src/app/api/admin/backups/route.ts` | BARU | OWNER only: GET daftar `{ok, backups:[{file,sizeBytes,createdAt}]}`, GET `?download=`, DELETE `?file=`, POST `{file}` restore-from-auto + ActivityLog `RESTORE_FROM_BACKUP` + NotificationItem |
| `src/app/api/cron/maintenance/route.ts` | tambah job 0 | Backup harian idempoten: `VACUUM INTO 'backups/auto/lumina-YYYY-MM-DD.db'` (nama file divalidasi `^lumina-[A-Za-z0-9._-]+\.db$` sebelum interpolasi), rotasi 7 file terbaru, ActivityLog `DAILY_BACKUP` + NotificationItem "Backup otomatis dibuat"; berjalan SEBELUM guard 1x/jam; body respons + `dailyBackup` |
| `src/app/api/admin/import-applications/route.ts` | ubah | Mode multipart `file` (.csv/.xlsx/.xls maks 5 MB) via XLSX.read + sheet_to_json header:1; header fleksibel (nama/nama lengkap, email, telepon/wa/whatsapp, posisi/lowongan, pengalaman, motivasi/alasan); baris tanpa name+email+positionTitle dilewati & dilaporkan; respons file mode `{ok,created,skipped,parsedRows,skippedRows}`; mode JSON lama tidak berubah |
| `src/app/api/admin/applications/export/route.ts` | ubah | `?format=xlsx`: workbook 2 sheet "Lamaran" (kolom CSV + Status Offer) & "Ringkasan" (per status + per posisi: jumlah lamaran, diterima); CSV default byte-per-byte sama (header/sel diekstrak ke buildHeader/buildCells agar PII identik) |
| `src/components/admin/data-tab.tsx` | ubah | Kartu "Backup Otomatis" (di antara kartu Backup Database & Restore Database): daftar backup + Unduh (a href download) / Pulihkan (AlertDialog merah "Semua data saat ini akan diganti…") / Hapus; blok "Impor dari File (CSV/Excel)" (input accept .csv,.xlsx,.xls + tombol multipart + toast "X baris diimpor, Y dilewati") di kartu impor existing — mode tempel/JSON tetap utuh |
| `src/components/admin/applications-tab.tsx` | ubah (hanya tombol ekspor) | Tombol Export CSV → DropdownMenu: "Unduh CSV" & "Unduh Excel (XLSX)" (anchor download, pola existing) |

Tidak menyentuh file milik agent lain (types.ts, schema.prisma, seed.ts, settings-tab, logs-tab, reports-tab, users-tab, application-detail-dialog, admin-app, home-view, cron/reminders, api/admin/positions/**).

## Catatan teknis penting

1. **Bug pre-existing ditemukan & diperbaiki di lib restore**: dynamic `import(spec)` dengan variabel di-intersepsi bundler Next (dev = Turbopack) → gagal "Cannot find module 'node:sqlite'" (bun:sqlite tak ada di Node). Perbaikan di `openSqlite()`: magic comment `/* webpackIgnore: true */ /* turbopackIgnore: true */` + fallback `createRequire(spec)`. Hasil: restore route existing kini 200 di dev (sebelumnya 500).
2. VACUUM INTO tidak bisa diparameterkan → filename dibangun sendiri dari tanggal lokal (regex ketat) lalu interpolasi; VACUUM INTO menolak menimpa file, dan idempotensi dijamin cek `existsSync` dulu.
3. Backup harian ditaruh sebelum guard 1x/jam agar tetap terbuat walau eksekusi maintenance dilewati guard; kegagalan backup tidak menggagalkan arsip/retensi.
4. File `backups/custom.db.demo-seed.bak` milik db-guard tidak disentuh (hanya menulis di `backups/auto/`).

## Hasil uji (dev :3000, login OWNER admin@lumina.id)

- POST /api/cron/maintenance (x-realtime-secret) → 200 `{ok:true, dailyBackup:{created:true, file:"lumina-2026-10-03.db"}}`; file 344064 B valid SQLite; panggil ulang → `created:false`, tidak duplikat (idempoten); guard 1x/jam tetap jalan (skipped:true).
- GET /api/admin/backups → daftar benar (sort desc); tanpa sesi 401; `?download=` → 200 octet-stream valid SQLite; path traversal `?download=../custom.db.demo-seed.bak` → 400.
- POST /api/admin/restore (route existing, lib baru) → 200 dengan `restored` 25 tabel. POST /api/admin/backups restore-from-auto → 200 + log `RESTORE_FROM_BACKUP` + notifikasi.
- Import CSV multipart (header "Nama Lengkap/Nomor WhatsApp/Posisi/Pengalaman/Alasan") → `{created:2, skipped:[{row:1,"Nama kosong."}], parsedRows:3, skippedRows:1}`; import XLSX (kolom "No" diabaikan, "Alamat Email"/"No. WA"/"Lowongan" dipetakan) → created 1, skipped 2; mode JSON lama → 200; >5 MB → 400; ekstensi .txt → 400.
- Export `?format=xlsx` → 200 MIME benar, file "Microsoft Excel 2007+", sheet Lamaran (15 kolom, 9 baris) + Ringkasan (status total 9; posisi: jumlah + diterima); CSV default identik (14 kolom, BOM, CRLF).
- UI (agent-browser via :81, cookie OWNER): kartu Backup Otomatis tampil + Unduh/Pulihkan/Hapus + dialog merah (bisa dibatalkan, TIDAK dieksekusi dari UI); blok Impor dari File tampil; dropdown Ekspor berisi Unduh CSV & Unduh Excel (XLSX) href benar; console tanpa error.
- `bun run lint` 0 error; `tsc --noEmit` 0 error pada file tugas ini (error tsc lain pra-eksisting di scripts/, telegram-bot, dll).
- Kebersihan data: 4 lamaran uji impor dihapus 3 (satu diambil alih alur anonimisasi agent lain → "Kandidat (dianonimkan)"; dibiarkan). Cookie uji /tmp/nr19b.jar; contoh file uji /tmp/test-import.csv & /tmp/test-import.xlsx.

## Peringatan untuk agent berikutnya

- Ada agent lain (NR-19-a) yang menjalankan E2E paralel saat tugas ini (offer, undangan user, laporan, logs/export). Restore uji saya mengganti isi DB 2x dari file yang diunduh menit yang sama (state tetap konsisten, backup 02:04 memuat data uji mereka) — bila menemukan keanehan timeline, cek ActivityLog sekitar 02:04–02:08.
- Maintenance punya guard 1x/jam + backup harian idempoten; panggilan kedua akan `skipped:true` dengan `dailyBackup.created:false` — itu normal.
