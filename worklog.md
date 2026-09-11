# Worklog — Proyek Halaman Rekrutmen Konten Kreator

Proyek: Halaman rekrutmen publik + panel admin (Next.js 16, TS, Tailwind v4, shadcn/ui, Prisma/SQLite).

---
Task ID: 1
Agent: orchestrator (Z.ai Code)
Task: Eksplorasi proyek & verifikasi dev server

Work Log:
- Verifikasi dev server berjalan di port 3000 (HTTP 200).
- Memeriksa package.json, prisma/schema.prisma, globals.css, layout.tsx, dan daftar komponen shadcn/ui.
- Konfirmasi dependensi: framer-motion, sonner, lucide-react, zod tersedia; seluruh komponen ui ada (accordion, tabs, dialog, select, switch, table, alert-dialog, sheet, dll).

Stage Summary:
- Stack: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui (New York) + Prisma/SQLite (db/custom.db).
- Desain: tema terang, aksen rose-600 + amber, netral zinc, hero gelap (zinc-950). DILARANG pakai warna biru/indigo.
- Kontrak data & API di src/lib/types.ts (SUMBER TUNGGAL tipe).
- Password admin default: admin123 (disimpan hash SHA-256 di Setting key "admin_password").
- Pembagian kerja: 3-a backend API (subagent), 3-b landing publik (subagent), 3-c panel admin (subagent), integrasi page.tsx oleh orchestrator.

---
Task ID: 2
Agent: orchestrator (Z.ai Code)
Task: Skema Prisma, kontrak tipe, tema, layout

Work Log:
- Mengganti prisma/schema.prisma dengan model: Setting (key-value JSON), Position (lowongan), Application (lamaran).
- Menjalankan `bun run db:push` — sukses, Prisma Client di-generate (v6.19.2).
- Menulis src/lib/types.ts: SiteContent, Position, Application, PublicContentResponse, AdminOverviewResponse, STATUS_LABELS, BENEFIT_ICONS, POSITION_TYPES.
- globals.css: primary -> rose-600 (oklch 0.586 0.242 17.952), ring rose, util `.nice-scrollbar`, `.text-gradient`, `.dot-pulse`, `.bg-grid-pattern`, html smooth scroll.
- layout.tsx: lang="id", metadata rekrutmen "Lumina Studio", Toaster sonner (position top-center, richColors, closeButton).

Stage Summary:
- Database siap dengan 3 model; Prisma Client ter-generate.
- Util CSS siap dipakai subagent frontend (nice-scrollbar, text-gradient, dot-pulse, bg-grid-pattern).
- File yang DIPEGANG orchestrator (jangan diubah subagent): prisma/schema.prisma, src/app/page.tsx, src/app/layout.tsx, src/app/globals.css, src/lib/types.ts.

---
Task ID: 3-c
Agent: full-stack-developer
Task: Panel admin rekrutmen

Work Log:
- Membaca worklog.md dan src/lib/types.ts sebagai kontrak tipe; semua tipe diimport dari @/lib/types (tanpa duplikasi).
- Membuat folder src/components/admin/ berisi 10 file (lihat Stage Summary).
- Helper fetch terpusat (api.ts): apiGet/apiPost/apiPatch/apiPut/apiDelete + buildQuery; semua error dilempar sebagai Error berbahasa Indonesia dengan fallback "Terjadi kesalahan. Coba lagi."
- Gate sesi: AdminApp cek GET /api/admin/session saat mount (loading spinner "Memeriksa sesi..."), fallback ke LoginCard jika !authenticated, login via POST /api/admin/login (toggle lihat password, error 401 inline, alert password default admin123), logout via POST /api/admin/logout.
- Header sticky (bg-background/80 backdrop-blur border-b): logo gradient rose-600→amber-500 + LayoutDashboard, "Panel Admin" + siteName dari GET /api/admin/settings, tombol "Lihat Halaman Publik" (onExit) dan "Keluar".
- Dashboard: 6 kartu statistik (grid-cols-2 md:3 lg:6, border-t-2 + ikon berwarna), bar distribusi status (segmen % + legend dot), daftar 5 lamaran terbaru (avatar inisial rose, StatusBadge, tombol Detail membuka dialog detail bersama), tombol segarkan.
- Pelamar: filter q (Enter/blur), Select status & posisi, tombol reset muncul saat filter aktif; tabel shadcn untuk md+, card list untuk mobile; dialog detail (max-w-2xl, max-h-[70vh] nice-scrollbar) berisi info kontak (mailto, wa.me tanpa +), link portofolio/sosmed (target _blank rel noopener), pengalaman & motivasi (whitespace-pre-line), Textarea catatan admin, Select ubah status, footer Hapus (AlertDialog) + Simpan Perubahan (PATCH). Hapus baris juga pakai AlertDialog. Toast: "Perubahan disimpan", "Lamaran dihapus".
- Posisi: daftar card (GripVertical, judul+departemen, Badge type+lokasi, Switch aktif dengan PATCH optimistik + toast "Posisi diaktifkan/dinonaktifkan", edit, hapus AlertDialog); dialog tambah/edit (validasi inline title/department/description wajib, jenis dari POSITION_TYPES, lokasi default "Remote", persyaratan satu per baris di-split on save dan di-join "\n" saat edit, Switch aktifkan posisi).
- Pengaturan: load GET /api/admin/settings → deep-copy ke form; Card Identitas & Hero (semua field + hint heroHighlight & deadline), Card Kontak & Footer (hint format WhatsApp), editor Benefit (Select ikon BENEFIT_ICONS + preview ikon lucide fallback Sparkles, naik/turun/hapus, "Tambah Benefit" default Sparkles/"Benefit Baru"), editor FAQ (naik/turun/hapus, "Tambah FAQ"), bar simpan sticky bottom-4 (PUT { site }, toast "Pengaturan disimpan"), Card Keamanan (3 password field dengan toggle Eye, validasi client min 6 & konfirmasi sama, PUT { currentPassword, newPassword } terpisah dari site, toast "Password berhasil diganti").
- StatusBadge komponen kecil dengan warna per status sesuai spesifikasi (amber/zinc/orange/emerald/rose).
- bun run lint: bersih (0 error, 0 warning). tsc --noEmit: tidak ada error pada file milik task ini (error tsc hanya di folder examples/ & skills/ yang pre-existing, tidak disentuh).
- Tidak menyentuh file di luar src/components/admin/. Tidak menjalankan dev server/build/prisma.

Stage Summary:
- File dibuat (semua di src/components/admin/, semuanya "use client"):
  - admin-app.tsx → export function AdminApp({ onExit }: { onExit: () => void }) — self-contained: gate sesi, login, header, Tabs (dashboard/applications/positions/settings), transisi framer-motion FadeIn.
  - api.ts → apiFetch, apiGet, apiPost, apiPatch, apiPut, apiDelete, jsonInit, buildQuery (helper fetch JSON + error { error: string }).
  - format.ts → formatDate, formatDateTime (Intl id-ID), initialsOf, waHref, normalizeUrl.
  - status-badge.tsx → StatusBadge({ status }) + STATUS_BAR_COLORS, STATUS_DOT_COLORS.
  - login-card.tsx → LoginCard({ onSuccess }).
  - dashboard-tab.tsx → DashboardTab() (overview + dialog detail sendiri).
  - applications-tab.tsx → ApplicationsTab() (filter, tabel/card, dialog detail bersama, hapus).
  - positions-tab.tsx → PositionsTab() (CRUD posisi).
  - settings-tab.tsx → SettingsTab() (site content, benefit, FAQ, keamanan).
  - application-detail-dialog.tsx → ApplicationDetailDialog({ application, onOpenChange, onSaved, onDeleted }).
- Integrator cukup: import { AdminApp } from "@/components/admin/admin-app" dan render <AdminApp onExit={() => ...} /> dari page.tsx.
- Catatan: semua endpoint dikonsumsi sesuai kontrak (sudah terverifikasi hidup di dev.log: PATCH/DELETE /api/admin/applications/... berespon 200/400/404); tidak ada API baru dibuat; toast memakai sonner; tanpa emoji; tanpa warna biru/indigo.

---
Task ID: 3-b
Agent: frontend-styling-expert
Task: Halaman landing rekrutmen publik

Work Log:
- Membaca worklog.md (desain: tema terang, aksen rose-600/amber, hero & CTA gelap zinc-950) dan kontrak tipe di src/lib/types.ts.
- Membaca API komponen ui yang dipakai: button, badge, card, input, textarea, label, select, accordion, sheet (tanpa membuat komponen ui baru, tanpa CLI shadcn).
- Membuat folder src/components/landing/ berisi 3 file 'use client':
  - benefit-icon.tsx: pemetaan string benefit.icon -> komponen lucide, dibatasi & divalidasi terhadap BENEFIT_ICONS dari @/lib/types, fallback Sparkles.
  - apply-form.tsx: form lamaran terkontrol (nama, email, WhatsApp, posisi via Select, portofolio, sosmed, pengalaman, alasan) + validasi inline (wajib isi, regex email, phone min 8 digit, pengalaman & alasan min 10 karakter), submit POST /api/applications (sukses 201 -> toast.success + panel sukses "Lamaran Terkirim!" + tombol "Kirim Lamaran Lain" reset; gagal -> toast.error pesan server/default, tetap di form), loading Loader2 + "Mengirim...".
  - landing-page.tsx: komponen utama LandingPage sesuai kontrak props (content, positions, stats, onOpenAdmin) + subkomponen internal (Container, FadeIn, BrandMark, Navbar+Sheet mobile, Hero, PositionCard, Sections posisi/tentang/benefit/cara-lamar/form/FAQ/CTA akhir, Footer).
- Memverifikasi `bun run lint` (0 error/warning) dan `bunx tsc --noEmit` (0 error di src/ proyek; error yang muncul hanya di folder sandbox examples/ & skills/ di luar proyek). Dev server tetap 200, tidak ada file di luar src/components/landing/ yang disentuh.

Stage Summary:
- File baru (HANYA di src/components/landing/):
  - landing-page.tsx -> export function LandingPage({ content, positions, stats, onOpenAdmin }) — 'use client'; import tipe `import type { SiteContent, Position } from "@/lib/types"`.
  - apply-form.tsx -> export function ApplyForm({ positions, positionId, onPositionIdChange }) — menangani submit sendiri via fetch POST /api/applications, body: { name, email, phone, positionId|null, portfolioUrl|null, socialLinks|null, experience, motivation }.
  - benefit-icon.tsx -> export function BenefitIcon({ name, className }) — fallback Sparkles.
- Integrator hanya perlu: fetch /api/public/content -> render <LandingPage content={site} positions={positions} stats={stats} onOpenAdmin={...} />; onOpenAdmin dipanggil dari tombol Lock "Admin" di footer.
- Interaksi "Lamar Posisi Ini": setState selectedPositionId di LandingPage (preselect di Select formulir) + scrollIntoView #lamar.
- Anchor id wajib tersedia: #posisi, #benefit, #cara-lamar, #faq, #lamar (semua scroll-mt-24); root <div className="flex min-h-screen flex-col">, footer mt-auto.
- Gaya sesuai desain: hero & CTA akhir bg-zinc-950 + glow radial rose + .bg-grid-pattern, .text-gradient di heroHighlight (dilewati bila kosong), .dot-pulse pada badge hero; netral zinc + aksen rose/amber, tanpa biru/indigo, tanpa emoji; target sentuh form/nav min-h-11; animasi framer-motion fade-up whileInView (once, margin -80px) — input form tidak dianimasikan; a11y: label-htmlFor terhubung, aria-invalid/describedby error inline, nav aria-label, ikon dekoratif aria-hidden.
- Catatan: bila positions kosong, Select disabled dengan placeholder "Belum ada posisi tersedia" dan validasi positionId dilewati; faqs/benefits kosong punya fallback teks; deadline kosong tidak dirender.

---
Task ID: 3-a
Agent: full-stack-developer
Task: Backend API rekrutmen

Work Log:
- Membaca worklog.md + src/lib/types.ts sebagai kontrak, lalu membuat src/lib/defaults.ts: DEFAULT_ADMIN_PASSWORD ("admin123"), DEFAULT_SITE (SiteContent lengkap Lumina Studio), DEFAULT_POSITIONS (5 posisi, requirements sebagai string[]).
- Membuat src/lib/server-auth.ts (server-only): cookie "admin_session" berisi `${expiresAtMs}.${HMAC-SHA256(expiresAtMs, ADMIN_SECRET ?? "lumina-studio-secret-key")}`; fungsi createSessionToken (expired 7 hari), verifySessionToken (timing-safe), getSessionTokenFromRequest (await cookies()), requireAdmin, hashPassword/verifyPassword (SHA-256 hex via node:crypto).
- Membuat src/lib/seed.ts: ensureSeeded() idempoten dengan cache promise module-level (reset jika gagal agar bisa retry); seed Setting "site", Setting "admin_password" (hash), 5 Position (requirements di-JSON.stringify), 5 Application contoh (positionId di-resolve by title; createdAt disebar 12 jam-8 hari ke belakang agar daftar "terbaru" realistis). File ini juga menampung helper serialisasi server yang dipakai lintas route: serializePosition (parse requirements), serializeApplication (menambah positionTitle, status dikunci ke ApplicationStatus), parseSiteContent/sanitizeSiteContent/sanitizeBenefits/sanitizeFaqs (fallback ke DEFAULT_SITE untuk field hilang/tak valid).
- Membuat 11 route API (semua `export const dynamic = "force-dynamic"`, NextResponse.json, try/catch, pesan error bahasa Indonesia, params sebagai Promise pada route dinamis):
  - GET /api/public/content → ensureSeeded, site+positions(isActive, order asc→createdAt asc)+stats {openRoles, totalApplications}.
  - POST /api/applications → validasi nama≥3, email regex, telepon≥8 digit, positionId harus Position aktif ("Posisi tidak ditemukan atau sudah ditutup"), pengalaman & motivasi≥10; 201 {ok:true,id}.
  - POST /api/admin/login → cek vs Setting "admin_password"; sukses set cookie httpOnly path "/" sameSite lax maxAge 604800; gagal 401 "Password salah". (ensureSeeded dipanggil agar login jalan di DB kosong.)
  - POST /api/admin/logout → hapus cookie (maxAge 0).
  - GET /api/admin/session → { authenticated }.
  - GET /api/admin/overview → 401 jika bukan admin; stats per status via groupBy + 5 lamaran terbaru.
  - GET /api/admin/applications → filter opsional status (divalidasi), positionId, q (LIKE name/email); urut terbaru.
  - PATCH /api/admin/applications/[id] → update status (valid) dan/atau adminNotes (string|null, string kosong→null); 404 jika tidak ada.
  - DELETE /api/admin/applications/[id] → 404 jika tidak ada, else {ok:true}.
  - GET /api/admin/positions (semua termasuk nonaktif), POST (validasi title≥3, department wajib, description≥10, type∈POSITION_TYPES default "Remote", location default "Remote", requirements array difilter kosong, order default max+1, isActive default true) → 201.
  - PATCH/DELETE /api/admin/positions/[id] → validasi partial sama; 404 jika tidak ada; delete aman (onDelete SetNull).
  - GET /api/admin/settings → { site } tanpa password; PUT → simpan site (validasi siteName non-kosong, benefits & faqs harus array bila dikirim; merge/sanitize dengan nilai lama) dan/atau ganti password (currentPassword harus cocok "Password saat ini salah", newPassword min 6 "Password baru minimal 6 karakter"); return {ok:true, site terbaru}.
- Uji menyeluruh via curl: seed sukses; submit lamaran valid (201) + semua cabang validasi (400); login salah (401)/benar (200+cookie); semua endpoint admin 401 tanpa cookie; filter & CRUD applications/positions; ubah password lalu login password lama 401; data uji dihapus dan password/tagline dikembalikan ke default. `bun run lint` bersih (0 error/warning), dev.log tanpa error.

Stage Summary:
- 14 file backend selesai: lib/defaults.ts, lib/server-auth.ts, lib/seed.ts + 11 route handler. Lint bersih, semua endpoint teruji 200/201/400/401/404 sesuai desain.
- KONTRAK UNTUK FRONTEND (3-b & 3-c): base URL relatif "/api/..."; GET /api/public/content mengembalikan PublicContentResponse; Application selalu memuat positionTitle; Position.requirements berupa string[]; auth admin = POST /api/admin/login {password:"admin123"} → cookie httpOnly otomatis disimpan browser, cek via GET /api/admin/session, logout via POST /api/admin/logout; endpoint admin lain 401 {error:"Tidak diizinkan. Silakan login terlebih dahulu."} saat belum login — tangani dengan redirect ke form login.
- Catatan: src/lib/seed.ts SERVER-ONLY (jangan diimpor dari komponen klien); SETelan PUT password, cookie lama tetap valid sampai expired (verify hanya cek tanda tangan+expiry); admin_password disimpan sebagai hash SHA-256, ADMIN_SECRET bisa dioverride via env.

---
Task ID: 4, 5, 6
Agent: orchestrator (Z.ai Code)
Task: Integrasi page.tsx, lint, dan verifikasi end-to-end dengan Agent Browser

Work Log:
- Menulis src/app/page.tsx: LandingView (fetch /api/public/content + skeleton + error state dengan retry) dan view switching landing <-> admin via hash #admin + tombol Admin di footer.
- Lint seluruh proyek: bersih, 0 error/warning.
- Verifikasi Agent Browser (semua LULUS):
  - Landing: navbar sticky, hero gelap + badge dot-pulse + text-gradient, deadline, 5 kartu posisi, section Tentang + statistik real-time, 6 benefit, 4 langkah, formulir, FAQ accordion, CTA akhir, footer mt-auto + tombol Admin.
  - Submit lamaran: POST /api/applications -> 201, toast sukses, panel "Lamaran Terkirim!" dengan nama pelamar.
  - Admin: tombol footer Admin -> #admin -> login gate; password salah -> "Password salah"; admin123 -> dashboard.
  - Dashboard: 6 kartu statistik akurat (total 6 = 5 seed + 1 uji), bar distribusi status, lamaran terbaru.
  - Pelamar: tabel + filter, dialog detail lengkap, ubah status Baru->Ditinjau + catatan tersimpan (PATCH), tabel ter-refresh.
  - Posisi: switch nonaktif Content Strategist -> langsung hilang dari /api/public/content; diaktifkan kembali.
  - Pengaturan: edit Judul Hero + Kata Highlight -> simpan -> langsung tampil di landing (sync terverifikasi); judul dikembalikan ke default.
  - FAQ accordion, tombol "Lamar Posisi Ini" (preselect Video Editor + scroll ke form).
  - Mobile 390px: hamburger Sheet + navigasi anchor, admin grid 2 kolom, form responsif.
  - Logout: toast "Anda telah keluar" + kembali ke login gate.
  - Console bersih tanpa error; satu warning React (Select uncontrolled->controlled pada form) bersifat kosmetik dan tidak memengaruhi fungsi.

Stage Summary:
- Aplikasi rekrutmen konten kreator SELESAI dan terverifikasi end-to-end di browser (desktop + mobile).
- Cara akses admin: tombol "Admin" di footer halaman publik, atau tambahkan #admin pada URL. Password default: admin123 (hash SHA-256 di DB).
- Artefak: src/app/page.tsx (integrasi), tema rose/amber di globals.css, layout metadata Indonesia + Toaster sonner.
