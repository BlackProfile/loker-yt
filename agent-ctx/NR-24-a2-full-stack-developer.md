# NR-24-a2 — 11 Route API Baru "Fitur per Pelamar" NR-24

Agent: full-stack-developer
Tanggal: 2026-10-03
Status: SELESAI — lint 0 error di seluruh file baru, tsc 0 error di file baru, 69/69 uji E2E curl lulus, data uji dibersihkan penuh (5 lamaran demo utuh).

## Ringkasan

Membuat 11 file route API baru (murni file baru — types.ts, schema, dan file milik agen lain tidak disentuh) untuk batch "fitur per pelamar" NR-24, di atas fondasi NR-24-a1 (model ApplicationCall/ApplicationAssessment/ApplicationInternalDoc + field mergedIntoId/docExpiries/dll + kontrak tipe CallLog/Assessment/InternalDoc/InboxItem/ApplicationHistoryItem/DoNotHireEntry).

## File dibuat

1. `src/app/api/admin/applications/[id]/calls/route.ts` — GET (desc, semua role) + POST (OWNER|HR) {result DIANGGAT|TIDAK_DIANGGAT|SALAH_SAMBUNGAN, summary ≤500} → ActivityLog CALL_LOG + emitRealtime.
2. `src/app/api/admin/applications/[id]/assessments/route.ts` — GET (asc) + POST {title ≤120 wajib, link ≤500 URL-ish, note ≤500, dueAt ISO} → status SENT → log ASSESSMENT_SENT.
3. `src/app/api/admin/assessments/[id]/route.ts` — PATCH {status?, score 0..100|null?, feedback ≤500|null?}; SUBMITTED/LATE mengisi submittedAt=now hanya bila kosong; log ASSESSMENT_UPDATE.
4. `src/app/api/admin/applications/[id]/internal-docs/route.ts` — GET desc + POST multipart (file ≤10MB, name default file.name ≤120) — saveUpload meniru route lamaran publik (uploads/ + FileAsset); log INTERNAL_DOC.
5. `src/app/api/admin/internal-docs/[id]/route.ts` — DELETE (OWNER|HR); FileAsset ikut terhapus via onDelete: Cascade; log INTERNAL_DOC_DELETED pada application terkait.
6. `src/app/api/admin/applications/[id]/inbox/route.ts` — GET gabung EmailOutbox (EMAIL, body ≤600) + ApplicationQuestion (QUESTION, answered) + ApplicationCall (CALL, label hasil Indonesia) → items urut at DESC + unanswered.
7. `src/app/api/admin/applications/[id]/history/route.ts` — GET lamaran lain email sama (lowercase, filter JS) + deletedAt null, maks 10 → ApplicationHistoryItem[].
8. `src/app/api/admin/applications/[id]/undo-reject/route.ts` — POST {reason ≤300}; guards status/mergedIntoId/MENARIK_DIRI/deletedAt; targetStatus = entri stageHistory terakhir ≠ REJECTED (fallback NEW); rejection fields null; email + webhook stage_changed + log UNDO_REJECT.
9. `src/app/api/admin/applications/[id]/merge/route.ts` — POST {sourceId}; transaksi memindahkan 8 relasi anak (comment, applicationQuestion, activityLog, applicationCall, applicationAssessment, applicationInternalDoc, checkIn, interview); union tags (maks 12), salin cvFile/introFile bila target kosong, gabung extraDocs/botFiles (maks 12) + docExpiries; source → REJECTED/DUPLICATE + mergedIntoId + isDuplicate; log MERGE (target) & MERGED (source) dibuat setelah pemindahan agar tidak ikut pindah.
10. `src/app/api/admin/donothire/route.ts` — GET/PUT (OWNER|HR) Setting "doNotHire" map {key:{reason,by,at}}; key dinormalisasi (email → lowercase, telepon → digit-only); DELETE OWNER-only ?key=&confirm=YA (tanpa confirm → 400, tak ada → 404).
11. `src/app/api/admin/tags/route.ts` — GET union Setting "tagList" + semua tags lamaran (urut abjad); PUT (OWNER|HR) {tags maks 30, item trim ≤30, dedupe}. (Endpoint yang diminta orchestrator oleh entri NR-24-c untuk kartu Daftar Tag.)

Semua route: `export const dynamic = "force-dynamic"`, params `{ params: Promise<{ id: string }> }` di-await (Next 16), getSession() @/lib/server-auth, db @/lib/db, serializeApplication/parseTags/parseDocExpiries @/lib/seed, appendStageHistory @/lib/stage-history, emitRealtime(REALTIME_EVENTS.applications) setelah mutasi, emitWebhook/sendCandidateStatusEmail untuk perubahan tahap. Konvensi error: 401 "Silakan login terlebih dahulu." / 403 "Anda tidak memiliki akses untuk aksi ini." / 404 "Lamaran tidak ditemukan" (varian "Tugas uji/Dokumen/Entri ... tidak ditemukan") / 400 pesan Indonesia spesifik.

## Bug ditemukan & diperbaiki

- merge route: sisa `await req.json()` setelah parameter diganti `_req` → ReferenceError → 500 (terlihat di dev.log & hasil uji pertama). Diperbaiki → semua uji merge lulus.

## Hasil uji (69/69 PASS — .zscripts/nr24a2-test.sh, login admin@lumina.id + viewer@lumina.id)

- Auth: 401 tanpa cookie (pesan benar); 403 VIEWER pada semua mutasi; donothire DELETE oleh HR → 403 (OWNER-only); 404 lamaran/dokumen/entri tak ada.
- calls: POST DIANGGAT 201 (actor "Pemilik Studio") → GET berisi; result tidak valid 400.
- assessments: POST 201 status SENT; PATCH SUBMITTED+score 80 → submittedAt terisi; PATCH LATE → submittedAt pertama dijaga; score 150 → 400; title kosong → 400.
- internal-docs: multipart 201 (name "Hasil MCU Uji", uploadedBy benar) → GET 1 → DELETE {ok} → GET kosong → DELETE ulang 404; tanpa file → 400.
- inbox: QUESTION (answered:false) + CALL digabung urut DESC; unanswered=1.
- history: berisi lamaran uji email sama (id cocok), 200.
- merge: diri sendiri 400; merge lamaran uji → Dewi 200: tags union (sosial media, komunitas, uji-nr24 — tanpa duplikat), komentar pindah (target 0→2, source 2→0), cvFileId tersalin, extraDocs 1; source REJECTED/DUPLICATE/mergedIntoId=Dewi (via GET list).
- undo-reject: hasil merge (mergedIntoId) → 400 "Lamaran sudah digabung."; ACCEPTED/NEW → 400 "Lamaran tidak sedang ditolak."; tanpa alasan → 400; tolak Rizky via PATCH lalu undo → 200, status NEW + rejection fields null; log STATUS_CHANGE/UNDO_REJECT tercatat, EmailOutbox REJECT ter-antri (pipeline email bekerja).
- donothire: "Test@Example.COM" → key "test@example.com"; "+62 812-0000-0024" → "6281200000024"; kunci kosong 400; DELETE tanpa confirm 400; confirm=YA menghapus; entri tak ada 404; urut at desc.
- tags: PUT dedupe → 2; GET memuat kedua tag urut abjad + union tags lamaran.

## Cleanup (terverifikasi)

- .zscripts/nr24a2-cleanup.ts membaca snapshot (nr24a2-snapshot.json dari setup): lamaran uji "Uji NR24A2" hard-delete; Dewi/Rizky/Anisa dipulihkan per-field (status/rejection/tags/cvFile/extraDocs/botFiles/docExpiries/stageHistory/stageUpdatedAt); komentar/pertanyaan/panggilan/asesmen/dokumen/log/email/survei uji (createdAt ≥ testStart) dihapus; FileAsset + file fisik uploads dihapus; Setting doNotHire & tagList dipulihkan (semula tidak ada → dihapus).
- Verifikasi akhir: 5 lamaran demo tetap 5, probe identik pra-uji (status/tags/hitungan anak, termasuk 7 log demo Bagas), 0 sisa data uji.

## Catatan untuk orchestrator

- Lint penuh repo saat laporan: 2 error `react-hooks/set-state-in-effect` di src/components/admin/application-detail-dialog.tsx — milik agen NR-24-b yang aktif mengedit file tsb saat sesi ini (konsumsi endpoint inbox baru). Di luar cakupan saya (dilarang menyentuh); 11 file route saya 0 error (eslint scoped exit 0).
- NR-24-c menyebut kartu Daftar Tag (settings-tab) sudah memanggil GET/PUT /api/admin/tags dgn kontrak {tags:string[]} — route no. 11 kini tersedia, kartu berfungsi penuh.
- viewer@lumina.id sempat LOCKOUT 429 (5 PASSWORD_SALAH oleh sesi lain pukul 15:16, bukan dari uji saya) — uji VIEWER 403 diulang setelah jendela lockout lewat, semua lulus.
