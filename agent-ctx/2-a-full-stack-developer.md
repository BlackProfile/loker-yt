# Work Record — Task 2-a

Agent: full-stack-developer
Task: Kartu "Bot Telegram" di tab Pengaturan panel admin (frontend konsumen API /api/admin/telegram/bot yang sudah selesai di backend oleh agent lain).

## Ringkasan

Menambahkan SATU komponen baru `TelegramBotCard` ke `src/components/admin/settings-tab.tsx` (satu-satunya file yang diubah) dan 1 baris render `<TelegramBotCard />` yang ditempatkan TEPAT SETELAH kartu "Integrasi & Otomasi" dan SEBELUM `<EmailOutboxCard />`.

## Detail implementasi

- Kartu mandiri (self-contained): state lokal sendiri (hasToken, legacyChatId, allowedChats, writeEnabled, alerts, pair + flag loading per aksi), dimuat via `GET /api/admin/telegram/bot` saat mount. TIDAK menyentuh state `site` dan TIDAK lewat tombol "Simpan" utama; setiap aksi POST langsung ke API.
- Helper yang dipakai: `apiGet`/`apiPost` dari `./api` (401 → login via `reportError`, 403 → toast akses, 400 → toast pesan server — konsisten dengan kartu lain).
- Isi kartu (semua panel inline, tanpa dialog/modal, tanpa emoji, tanpa biru/indigo):
  1. Header: judul "Bot Telegram" + ikon Send rose + deskripsi "Bot dua arah untuk admin: perintah ringkasan, aksi kandidat, dan digest pagi langsung dari Telegram."
  2. Baris status: Badge emerald "Token terpasang" / Badge amber "Token belum diisi" + hint mengisi token di kartu Integrasi & Otomasi; teks "Belum ada chat terdaftar — buat kode pemasangan di bawah." bila allowedChats kosong.
  3. Tombol "Uji Bot" (outline, ikon Send, spinner): POST action "test" → per chat toast "Chat {chatId}: ok"/"gagal"/"nonaktif"; sukses total → toast "Pesan uji terkirim"; error API → toast pesan server.
  4. Panel Pemasangan Chat (rounded-lg border p-3): tanpa kode → tombol "Buat Kode Pemasangan" (create-pair); dengan kode → kode besar font-mono text-2xl tracking-widest rose-600/dark:rose-400, kedaluwarsa "dd MMM yyyy HH.mm" via toLocaleString("id-ID"), instruksi bernomor /mulai KODE, tombol outline kecil "Batalkan kode" (cancel-pair). Auto-poll GET tiap 5 detik selama kode aktif; bila pair hilang dari response → reload status + toast "Chat baru terhubung ke bot." + berhenti polling; berhenti juga otomatis setelah masa berlaku (maks 15 menit) tanpa toast palsu.
  5. Daftar chat terdaftar: baris font-mono text-sm, tombol ikon X kecil (aria-label "Hapus chat {id}") → POST remove-chat, daftar diperbarui dari response + toast konfirmasi; legacyChatId diberi label "(dari kolom Chat ID lama)" dan tanpa tombol hapus.
  6. Switch "Izinkan aksi tulis via bot" dengan deskripsi lengkap; POST set-write optimistik + revert on error + toast.
  7. Lima Switch alert dari TELEGRAM_ALERT_KEYS + TELEGRAM_ALERT_LABELS di bawah judul kecil "Alert yang dikirim ke Telegram"; POST set-alert optimistik + revert on error + toast.
  8. Footnote: "Tombol "Tinjau" pada pesan bot membuka {origin}/?kandidat=KODE. ..." — origin dari window (useEffect), fallback "..." sebelum mount.
- Aksesibilitas: semua Switch punya id + Label htmlFor + aria-label; tombol ikon X punya aria-label; skeleton saat loading awal; blok "Coba Lagi" saat gagal muat.
- Role gating: GET untuk semua admin; aksi POST (OWNER-only di backend) dinonaktifkan untuk non-OWNER + catatan kecil, mengikuti pola CandidateEmailsCard/RetentionCard.
- Import tambahan pada file yang sama: `X` dari lucide-react; `TELEGRAM_ALERT_KEYS`, `TELEGRAM_ALERT_LABELS`, `type TelegramAlertKey` dari "@/lib/types". Perilaku komponen lain TIDAK diubah.

## Verifikasi

- `bun run lint` → exit 0 (0 error).
- `bunx tsc --noEmit 2>&1 | grep settings-tab` → kosong (tidak ada error TypeScript di file ini).
- `GET /` → 200, dev.log "✓ Compiled" tanpa error terkait perubahan.
- Git status: dari sesi ini hanya `src/components/admin/settings-tab.tsx` yang berubah (file lain di status git adalah pekerjaan agent backend Telegram sebelumnya, tidak disentuh).
- Tidak ada restart dev server, build, db:push, atau git push.
