# NR-4 — full-stack-developer — Pertanyaan kondisional posisi non-remote

## Konteks yang dibaca
- worklog.md (Task ID: NR-1) — fondasi: Position.workMode/city/shiftSystem, Application.domisili/komuterPlan/shiftPref/startDatePref, KOMUTER_PLANS/SHIFT_PREFS + label di types.ts.
- apply-wizard.tsx (3549→3853 baris) — model langkah ganda: mode klasik (0 biodata, 1 pengalaman, 2 berkas, 3 pratinjau) vs mode skema (sectionSteps dinamis + pratinjau terakhir), validasi per langkah (goNext/validateAllAndJump), draft autosave/restore, payload doSubmit (FormData → /api/applications).
- src/app/api/applications/route.ts — parsing multipart/JSON, validasi posisi/kuota/cooldown, db.application.create, jalur sukses (trackingCode/autoReply/assignment) tidak boleh berubah.
- apply-form.tsx — DIPASTIKAN legacy & tidak dirender di mana pun (tidak diimpor); DILEWATI (laporkan ke orkestrator).
- processing.ts — hanya orkestrasi background (AI/ASR/notify); tidak memediasi create → tidak diubah.

## Perubahan
1. `src/components/landing/apply-wizard.tsx`
   - Step model: `onsiteActive` (ONSITE/HYBRID); `attendanceStepIndex` — klasik: 2 (sebelum Berkas → filesStep=3, previewStep=4); skema: sisip setelah bagian biodata (fallback sebelum files, fallback akhir) + re-index stepIndex +1. `stepLabels` disisipkan pada posisi yang sama (klasik: [Data Diri, Pengalaman, Info Kehadiran, Berkas, Pratinjau]).
   - Langkah "Info Kehadiran di Kantor" / "On-site Work Info": domisili (wajib, max 80), komuter Select KOMUTER_PLANS/KOMUTER_PLAN_LABELS (wajib; pertanyaan memakai city posisi, fallback "lokasi kantor kami"), shift Select SHIFT_PREFS/SHIFT_PREF_LABELS (wajib, hanya bila shiftSystem !== "NONE"), startDatePref (opsional, max 60, placeholder "mis. 1 Juli 2026").
   - Bilingual: inline `lang === "en"`; map EN `KOMUTER_PLAN_LABELS_EN`/`SHIFT_PREF_LABELS_EN` di module scope; strings.ts TIDAK disentuh.
   - Validasi `validateAttendance()` dipanggil di goNext (branch paling atas, dua mode), validateAllAndJump (klasik & skema), inline error + aria persis pola biodata; error terhapus otomatis via setField.
   - Field baru masuk FormValues → draft autosave localStorage + restore (VALUE_KEYS) + draft-link email tetap berfungsi.
   - Pengaman ganti posisi ONSITE→REMOTE: step >= 2 digeser -1 (render-time) agar validasi Berkas wajib tidak bisa terlewati.
   - Payload: append domisili/komuterPlan/shiftPref/startDatePref hanya bila onsiteActive (shiftPref hanya bila pertanyaan shift tampil). REMOTE tidak mengirim apa pun.
   - Pratinjau: kartu PreviewSection "Info Kehadiran di Kantor" (klasik & skema) + tombol Ubah ke langkahnya.
2. `src/app/api/applications/route.ts`
   - Import KOMUTER_PLANS/SHIFT_PREFS; sanitizer setelah validasi posisi: `isOnsitePosition` gate — domisili trim+max 80; komuterPlan ∈ KOMUTER_PLANS else null; shiftPref ∈ SHIFT_PREFS else null; startDatePref trim+max 60; REMOTE/posisi tak dikenal → semuanya null (diabaikan).
   - Persist ke `db.application.create` (kolom sudah ada dari NR-1). Respons sukses & activity log tidak berubah.

## Verifikasi
- `bun run lint` → PASS (tanpa warning/error).
- dev.log: `GET / 200` (kompilasi bersih), `POST /api/applications` 200/400 sesuai skenario — tanpa error kompilasi.
- Smoke test DB (data uji dihapus setelahnya):
  - ONSITE Content Strategist → domisili "Bogor" (ter-trim), komuterPlan SIAP_KOMUTER, shiftPref MALAM, startDatePref "1 Juli 2026" (ter-trim). ✓
  - REMOTE Video Editor (field dikirim paksa) → keempat kolom null di DB. ✓
  - Enum invalid "JALAN_KAKI" → null; domisili 120 char → terpotong 80. ✓
  - Rate limit 5/jam per IP aktif saat testing (dibypass via X-Forwarded-For untuk skenario lanjutan).

## Catatan untuk agent berikutnya
- apply-form.tsx TIDAK dipakai (legacy, tanpa import) — jangan menambah fitur di sana; wizard adalah satu-satunya jalur lamaran publik.
- serializeApplication (src/lib/seed.ts, milik NR-1) sudah mengekspos 4 field baru — panel admin bisa langsung menampilkan domisili/komuterPlan/shiftPref/startDatePref dari type Application.
- Nilai Info Kehadiran sengaja TIDAK direset saat posisi berganti (terjaga dari reset draf; tergerbang onsiteActive saat submit + validasi ulang per langkah).
