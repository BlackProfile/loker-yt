# NR-24-a1 — Fondasi Backend Batch "Fitur per Pelamar" NR-24

Agent: full-stack-developer
Tanggal: 2026-10-03
Status: SELESAI — lint 0 error, db:push sukses, 27/27 uji E2E curl lulus, data uji dibersihkan penuh.

## Ringkasan

Fondasi (batch 1) untuk 15 fitur per-pelamar: schema Prisma (6 kolom baru + 3 model baru), kontrak tipe tunggal, serialisasi & filter daftar lamaran, PATCH lamaran (field baru + audit log), submit publik (expectedSalary + peringatan Do-not-Hire), action-items (followupDue/holdReviewDue), cron followupBell, dan dukungan showExpectedSalary di sanitizer posisi.

## File diubah

1. `prisma/schema.prisma`
   - Application += expectedSalary Int?, starredBy String @default("[]"), holdReason String?, holdReviewAt DateTime?, docExpiries String?, mergedIntoId String?
   - Position += showExpectedSalary Boolean @default(true)
   - Model BARU: ApplicationCall, ApplicationAssessment, ApplicationInternalDoc (semuanya onDelete: Cascade + @@index([applicationId])); Application += relasi calls/assessments/internalDocs; FileAsset += internalDocs @relation("internalDoc")
2. `src/lib/types.ts` — Application += 6 field; Position += showExpectedSalary; type baru CallLog/Assessment/InternalDoc/InboxItem/ApplicationHistoryItem/DoNotHireEntry; RejectionReason += "DUPLICATE" (union + REJECTION_REASONS + REJECTION_REASON_LABELS "Lamaran ganda"); ActionItemsResponse += followupDue[] & holdReviewDue[] (bentuk PERSIS sesuai spec NR-24-a1).
3. `src/lib/seed.ts` — parseDocExpiries() (JSON aman → {}); serializeApplication serialisasi 6 field baru (starredBy via parseTags, docExpiries via parseDocExpiries, tanggal ISO/null); serializePosition += showExpectedSalary (record.showExpectedSalary !== false); parseApplicationFilters(searchParams, userId?) — starred=1 (contains `"userId"`, diabaikan tanpa userId), followup=1 (NOT snoozeUntil null, digabung aman dgn hasInterview via NOT{OR:[...]}), hold=1 (holdReason {not:null}), sort=followup (orderBy snoozeUntil asc, createdAt desc).
4. `src/app/api/admin/applications/route.ts` + `src/app/api/admin/applications/export/route.ts` — parseApplicationFilters kini menerima session.id.
5. `src/app/api/admin/applications/[id]/route.ts` (PATCH) — field baru: expectedSalary (int 0..1e9/null), starred (toggle session.id pada starredBy), holdReason (trim ≤300, ""→null), holdReviewAt (ISO valid/null), docExpiries (merge {fileId:"YYYY-MM-DD"|null|false}, kunci ≤64, format salah→400, kosong→null). ActivityLog: SALARY_EXPECTATION/STAR/UNSTAR/HOLD_SET/HOLD_CLEAR/HOLD_REVIEW/HOLD_REVIEW_CLEARED/DOC_EXPIRY. emitRealtime tetap. VIEWER tetap 403.
6. `src/app/api/applications/route.ts` (POST publik) — expectedSalary opsional (string→int 0..1e9, diabaikan bila tidak valid) disimpan di create; SETELAH create: cek Setting "doNotHire" (JSON map; kunci = email lowercase ATAU telepon digit-only) → NotificationItem "Peringatan Do-not-Hire" (category APPLICATION) + ActivityLog DNH_WARNING (actor "Sistem"); fire-and-forget penuh (try/catch), tidak pernah menggagalkan submit.
7. `src/app/api/admin/action-items/route.ts` — followupDue (deletedAt null, snoozeUntil != null ≤ now+3d, asc, 20) & holdReviewDue (holdReviewAt != null ≤ now+3d, asc, 20) dalam Promise.all yang sama.
8. `src/app/api/cron/reminders/route.ts` — job 25 "followupBell": snoozeUntil ≤ now & deletedAt null → NotificationItem "Tindak lanjut jatuh tempo" + ActivityLog FOLLOWUP_REMIND; dedupe via ActivityLog FOLLOWUP_REMIND createdAt ≥ snoozeUntil; respons += followupBell; emitRealtime bila > 0.
9. `src/lib/position-input.ts` — PositionFields += showExpectedSalary; daftar booleans; positionFieldsToDb MAPPING TERSEDIA (pelajaran NR-22 diterapkan — PATCH ikut tersimpan).
10. `src/app/api/admin/positions/route.ts` (create: ?? true), `src/app/api/admin/positions/[id]/duplicate/route.ts` (ikut disalin), `src/lib/defaults.ts` (DefaultPositionSeed += showExpectedSalary?), seed create posisi (?? true).
11. Skrip uji `.zscripts/`: nr24a1-setup.ts (Setting doNotHire), nr24a1-test.sh (27 cek), nr24a1-snooze.ts, nr24a1-del-probe.ts, nr24a1-sweep.ts, nr24a1-verify-clean.ts, cleanup-nr24a1.ts.

## Hasil db:push

`bun run db:push` → "Your database is now in sync with your Prisma schema. Done in 48ms" + Prisma Client v6.19.2 tergenerate. Non-destruktif (tambah kolom/tabel saja).

## Hasil uji (ringkas — 27/27 PASS)

- POST /api/applications expectedSalary 3500000 → 201, DB terisi, serialized 3500000; lamaran uji dihapus.
- PATCH starred:true → 200 & starredBy berisi id admin; log STAR "Ditandai penting oleh Pemilik Studio".
- PATCH holdReason "slot penuh" + holdReviewAt 2026-03-01 → 200; log HOLD_SET + HOLD_REVIEW.
- PATCH docExpiries {"nr24testfile":"2026-05-10"} → 200; format salah → 400.
- PATCH expectedSalary 3500000 → 200, null → null, 999999999999 → 400; log SALARY_EXPECTATION.
- GET ?hold=1 hanya lamaran HOLD; ?starred=1 hanya bintang admin ini; ?followup=1 & ?sort=followup → 200.
- GET /api/admin/action-items → followupDue & holdReviewDue ada; holdReviewDue memuat lamaran HOLD uji.
- POST /api/cron/reminders → 200 + field followupBell; uji E2E: snooze lewat → 2x cron → log FOLLOWUP_REMIND tepat +1 (dedupe bekerja).
- Uji DNH: Setting doNotHire {email, telepon} → submit dgn email KAPITAL + telepon berformat "+62 812-9990-0011" → 201 + log DNH_WARNING "Pelamar terdaftar Do-not-Hire (uji nr24)" + NotificationItem.
- GET /api/public/content → semua 9 posisi showExpectedSalary: true.

## Catatan penting untuk agent berikutnya

- **Insiden dev server**: setelah `prisma generate` (db:push), dev server lama (boot 13:58) memegang Prisma client STALE → create Application 500 "Unknown argument positionId". Menghapus cache TIDAK cukup dan malah merusak state (Turbopack "Persisting failed"); dev server HARUS di-restart (sudah dilakukan, kini sehat & log bersih). Pelajaran: setelah db:push/generate, minta orchestrator/dev-restart sebelum uji HTTP.
- Konvensi kunci Setting "doNotHire": map {key: {reason, by, at}} dengan key = email lowercase ATAU nomor telepon digit-only (contoh "nr24a1@test.lumina", "6281299900011") — normalisasi sisi cek: email.toLowerCase(), phone.replace(/\D/g,"").
- holdReason & holdReviewAt INDEPENDEN (melepas HOLD tidak otomatis menghapus jadwal review) — sesuai spec.
- Data akhir bersih: 5 lamaran demo, 9 posisi, 0 sisa log uji (DNH/FOLLOWUP_REMIND=0), Setting doNotHire dihapus.
