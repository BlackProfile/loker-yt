# NR-6 — Info kehadiran pelamar non-remote di panel admin

Task ID: NR-6
Agent: NR-6 agent (Z.ai Code)
Status: SELESAI — lint bersih, dev.log bersih, diverifikasi via API + agent-browser (sesi terisolasi).

## Scope yang dikerjakan
Surface data kehadiran pelamar (domisili/komuterPlan/shiftPref/startDatePref + Interview.checkedInAt/mode) untuk posisi non-remote di panel admin: daftar kandidat, dialog detail, dan tab Analitik + API analitiknya.

## File diubah (7)
1. `src/components/admin/status-badge.tsx` — komponen bersama **DomisiliChip** (MapPin + "Domisili: {kota}"; fallback label komuter bila domisili kosong; amber bila PERLU_RELOKASI, emerald bila SIAP_KOMUTER, zinc selain itu; title tooltip rencana komuter; return null bila tidak ada data).
2. `src/components/admin/applications-table.tsx` — chip di sel "Pelamar" baris desktop (di bawah email/telepon) + kartu mobile.
3. `src/components/admin/kanban-board.tsx` — chip di baris badge kartu kanban.
4. `src/components/admin/applications-tab.tsx` — filter baru (client-side, AND dengan filter existing):
   - Select "Filter rencana komuter": Semua Komuter / Siap komuter / Perlu relokasi / Belum bisa (label pendek sesuai brief).
   - Input "Filter domisili pelamar" (live, case-insensitive contains, placeholder "Filter domisili...", ikon MapPin).
   - Grid filter lg:grid-cols-7 → lg:grid-cols-5 (9 item, baris 5+4); kedua filter masuk hasActiveFilter + resetFilters.
   - Empty state kini dipicu `displayedApplications.length === 0` (mencakup hasil filter client yang kosong) memakai kartu empty existing.
5. `src/components/admin/application-detail-dialog.tsx` — blok **Info Kehadiran** (gaya blok Sumber Pelamar; SourceRow) setelah Sumber Pelamar, sebelum Wawancara: Domisili (MapPin), Rencana komuter (Users, label KOMUTER_PLAN_LABELS), Shift diinginkan (Clock, label SHIFT_PREF_LABELS, hanya bila shiftPref), Bisa mulai (CalendarPlus, startDatePref). Render hanya bila ≥1 field terisi — dialog era remote tak berubah.
6. `src/app/api/admin/analytics/route.ts` — select +positionId/domisili (Application), +mode/checkedInAt (Interview), query baru Position(id, workMode, city). Agregasi server-side baru:
   - `onsiteAttendance`: interview mode ONSITE & status != CANCELLED → total, attended (checkedInAt != null), noShow (status NO_SHOW), noShowRate (0 bila total 0).
   - `applicantOrigins`: lamaran posisi ONSITE/HYBRID dengan domisili → top 5 kota (agregasi case-insensitive, label ejaan pertama) + isPositionCity + outOfCityRate (% domisili != position.city; null bila tanpa data).
   - Respons backward-compatible (field additive; tipe body = AnalyticsResponse & {...}).
7. `src/components/admin/analytics-tab.tsx` — tipe lokal `AnalyticsResponseExtended` (defensif); 2 kartu baru (grid lg:grid-cols-2, setelah Beban Pewawancara):
   - "Kehadiran Wawancara On-site": 4 tile (Total Sesi / Hadir (check-in) emerald / Tidak Hadir rose bila >0 / Tingkat No-show rose-emerald) + bar proporsi hadir; empty state teks muted.
   - "Asal Pelamar (On-site/Hybrid)": top 5 kota + bar amber + penanda italic halus "kota posisi" + "X% dari luar kota posisi"; empty state "Belum ada data domisili pelamar."

## Verifikasi
- `bun run lint`: 0 error (2x). dev.log tanpa error kompilasi; tidak restart/build.
- API (dataset uji terkontrol: 6 lamaran + 5 wawancara): onsiteAttendance {total:3, attended:1, noShow:1, noShowRate:33} (CANCELLED & ONLINE dikecualikan); applicantOrigins {total:6, outOfCityRate:50, Jakarta×3 isPositionCity=true, Bandung×2, Surabaya×1}. Data uji dihapus setelahnya.
- Browser (admin, tab Pelamar/Analitik): chip warna benar di tabel/kartu/kanban; filter komuter + domisili ("BANDUNG" huruf besar tetap cocok) tergabung AND; empty state + Reset Filter benar; blok Info Kehadiran tampil untuk kandidat on-site/hybrid dan tidak untuk kandidat era remote; kartu analitik menampilkan angka sesuai DB; console bersih.

## Catatan lintas agen
- Selama verifikasi ada data uji NR-5 berjalan paralel (kandidat "UJI NR5 Kandidat" + wawancara ONSITE tambahan); angka kartu mengikuti DB terkini — bukan bug. Data uji NR-5 tidak disentuh.
- Tidak menyentuh file terlarang: interview-tab.tsx, interview/slot APIs, cron, landing/*, prisma schema, types.ts, seed.ts, defaults.ts, position-input.ts.
