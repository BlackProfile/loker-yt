# Lumina Studio — Platform Rekrutmen untuk Content Creator

Aplikasi rekrutmen full-stack: **landing page publik** untuk pelamar + **admin dashboard** lengkap untuk tim HR.

## Fitur Utama

- **Landing page publik** — daftar lowongan realtime, detail per-posisi (`/posisi/[slug]`) lengkap dengan persyaratan, ketentuan, benefit, screening questions & form pelamaran per lowongan
- **Admin dashboard** (`/#admin`) — kelola posisi, pelamar (table + kanban), pengaturan situs 12 seksi, user multi-role (Owner/HR/Viewer), kalender wawancara, audit log
- **AI integration** — screening otomatis, cover generator, analisa CV (z-ai-web-dev-sdk)
- **Realtime** — update tanpa refresh via realtime service (socket.io)
- **28+ fitur per-posisi** — kuota, badge, featured, gaji, benefit, rubrik evaluasi, link assignment, QR posisi, dan lainnya
- **Multi-bahasa** (ID/EN), dark mode, responsif, anti-flicker

## Teknologi

| Layer | Teknologi |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript 5 |
| UI | Tailwind CSS 4 + shadcn/ui + Lucide icons |
| Database | Prisma ORM + SQLite |
| Realtime | socket.io (mini-service) |
| Animasi | framer-motion, @dnd-kit, recharts |

## Menjalankan Proyek

```bash
bun install
bun run db:push        # inisialisasi database SQLite
bun run dev            # http://localhost:3000
```

Mini-service realtime (opsional, untuk fitur realtime):

```bash
cd mini-services/realtime-service && bun install && bun run dev
```

Atau jalankan dengan **keepalive daemon** (direkomendasikan — auto-restart bila service mati):

```bash
bash scripts/start-realtime.sh   # aman dijalankan ulang (idempoten)
```

### Akun Demo Admin

Akses melalui landing page: tambahkan `#admin` pada URL.

| Role | Email | Password |
|---|---|---|
| Owner | admin@lumina.id | admin123 |
| HR | hr@lumina.id | admin123 |
| Viewer | viewer@lumina.id | admin123 |

## Auto-Sync GitHub

Repository ini otomatis tersinkronisasi ke GitHub:

```bash
bash scripts/start-auto-push.sh   # mulai watcher (aman dijalankan ulang)
```

- Watcher memeriksa perubahan tiap **60 detik** → otomatis `git commit` + `git push` (maks. 1 menit setelah perubahan)
- Hanya watcher yang melakukan push (single-writer) agar bebas race
- Log aktivitas: `auto-push.log`

## Struktur

```
src/app/          → routes & API (App Router)
src/components/   → landing/ (publik), admin/ (dashboard), ui/ (shadcn)
src/lib/          → db, auth, ai, realtime, types
prisma/           → schema database
mini-services/    → realtime service (socket.io)
scripts/          → auto-push watcher
```
