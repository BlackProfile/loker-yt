# NR-5 — Interview Ops Agent (Z.ai Code)

Task: Slot on-site pintar (id 10) + check-in kehadiran kandidat (id 11) untuk posisi non-remote.

## Status: SELESAI

## Files changed
- `src/components/admin/interview-tab.tsx` — SlotManagerPanel pintar (default mode ONSITE utk posisi ONSITE/HYBRID, autofill alamat kantor, hint alamat + "Lihat peta", hitung kuota harian "{x} dari {y} slot tersisa pada {tanggal}", blokir submit klien dengan toast kuota) + daftar sesi: tombol "Tandai Hadir" (UserCheck) & "Tidak Hadir" (UserX) utk sesi ONSITE SCHEDULED/CONFIRMED, badge emerald "Hadir · {jam}", helper handleCheckIn, updateInterviewInList di-merge agar konteks baris tidak hilang.
- `src/components/admin/interview-session-dialog.tsx` — pratinjau undangan ONSITE menambah "\nDatang ke: {address}" & "\nPeta: {mapsUrl}" (idempoten: dilewati bila template sudah memuat); efek autofill alamat kantor saat mode ONSITE & alamat kosong; tombol "Tandai Hadir" + badge "Hadir · {jam}" di panel info/aksi status.
- `src/components/admin/format.ts` — ACTION_LABELS.CHECKIN = "Tandai Hadir".
- `src/app/api/admin/slots/route.ts` — POST: server-side kuota (count slot ONSITE posisi+kalender hari vs position.dailySlotQuota) -> 400 "Kuota slot on-site posisi ini maksimal {n} per hari untuk {tanggal}."
- `src/app/api/admin/interviews/[id]/route.ts` — PATCH: aksi { checkIn: true } -> validasi mode ONSITE & status SCHEDULED/CONFIRMED, set checkedInAt=now, ActivityLog CHECKIN (actor admin, "Kandidat ditandai hadir di kantor"), realtime emit, respons serializeInterview.
- `src/app/api/cron/reminders/route.ts` — include position.address/mapsUrl/customDocs; sesi ONSITE menyuntik "Datang ke {address}", "Peta: {mapsUrl}", "Bawa dokumen: {customDocs join ', '}" (skip bila kosong) di kedua cabang reminder (H-1 hari & 1 jam); ONLINE tak berubah.

## Flow summary
- Slot create: UI default+quota (klien) -> POST /api/admin/slots (server re-check kuota) -> realtime refresh.
- Invite: Position.interviewInviteTemplate diisi fillTemplateManual di interview-session-dialog; ONSITE ditambah alamat+peta sebelum ditampilkan/disalin; ONLINE apa adanya.
- Reminder: api/cron/reminders (x-realtime-secret) -> detail notifikasi ONSITE berisi alamat/peta/dokumen; sumber address = interview.address ?? position.address, dokumen dari position.customDocs (JSON string[] di-parse helper parseStringArray).
- Check-in: tombol UI -> PATCH {checkIn:true} -> validasi -> checkedInAt + log CHECKIN -> UI badge emerald "Hadir · {jam}" + toast -> daftar/dialog di-refresh via onSaved/updateInterviewInList.

## Verifikasi
- bun run lint: 0 error 0 warning. tsc --noEmit: bersih utk area admin/api.
- dev.log: tanpa error kompilasi (semua GET 200).
- Browser (gateway :81, admin): default mode/alamat/kuota hint tampil; "6 dari 6" -> buat slot -> "5 dari 6"; kuota sementara 1 -> blokir klien (toast) + blokir server (curl 400, slot ONLINE kontrol lolos); check-in API 400 utk ONLINE & NO_SHOW, 200 utk ONSITE SCHEDULED (+ ActivityLog CHECKIN); cron -> notifikasi "Datang ke .../Peta: .../Bawa dokumen: KTP, SKCK" utk ONSITE, ONLINE tetap; UI badge & tombol tampil sesuai kondisi.
- Data uji & posisi sementara (kuota/customDocs/template) sudah dikembalikan/dihapus; helper scripts dihapus.

## Catatan lintas agen
- TIDAK menyentuh: prisma schema, src/lib/types.ts, seed.ts, defaults.ts, landing/*, analytics-tab, application-detail-dialog, applications tab, posisi form (NR-2).
- Data uji NR-6 (UJI NR6 ...) tidak diubah/dihapus. updateInterviewInList berubah jadi merge ({...i,...updated}) — berlaku juga utk alur reschedule di tab Wawancara (perbaikan kecil, konteks baris kini terjaga).
- interview-session-dialog juga dipakai application-detail-dialog/pipeline-tab: perubahan bersifat aditif (baris undangan ONSITE, tombol check-in ONSITE, badge) — aman utk konsumen lain.
