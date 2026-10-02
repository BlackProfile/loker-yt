// Seed kondisi khusus posisi untuk demo reaksi aplikasi:
// 1. PENUH ANGGOTA — isi kuota pelamar dengan lamaran dummy realistis hingga
//    maxApplicants tercapai (aplikasi akan auto-close posisi + catat ActivityLog).
// 2. LEWAT BATAS WAKTU — closesAt dimundurkan ke masa lalu (auto-close + log).
// 3. HAMPIR DITUTUP — closesAt maju ke beberapa jam/1-2 hari lagi (chip
//    "Segera Ditutup" + countdown hidup di halaman karier).
// Idempoten: aman dijalankan ulang (kuota di-top-up hanya bila belum penuh,
// closesAt masa lalu tidak disentuh lagi, closesAt soon tidak digeser).
import { db } from "../src/lib/db";

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 60 * 60 * 1000);
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}
function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `LM-${s}`;
}

async function getPositionByTitle(title: string) {
  const position = await db.position.findFirst({
    where: { title, deletedAt: null },
    select: { id: true, title: true, maxApplicants: true, workMode: true, city: true },
  });
  if (!position) throw new Error(`Posisi tidak ditemukan: ${title}`);
  return position;
}

async function nonRejectedCount(positionId: string): Promise<number> {
  return db.application.count({
    where: { positionId, status: { not: "REJECTED" } },
  });
}

// ---------- Data dummy lamaran realistis ----------
type Dummy = { name: string; email: string; phone: string; experience: string; motivation: string; status?: string; domisili?: string; komuterPlan?: string; shiftPref?: string };

const socialMediaOfficerApps: Dummy[] = [
  { name: "Putri Ayu Ramadhani", email: "putri.ayu@gmail.com", phone: "+628123456701", experience: "2 tahun mengelola Instagram & TikTok brand F&B lokal, rata-rata engagement naik 40%.", motivation: "Saya gemar membuat konten yang relatable dan ingin tumbuh bersama tim kreatif Lumina Studio.", status: "REVIEWED", domisili: "Jakarta Selatan", komuterPlan: "SIAP_KOMUTER", shiftPref: "PAGI" },
  { name: "Raka Aditya Wijaya", email: "raka.wijaya@gmail.com", phone: "+628123456702", experience: "Social media officer di agency digital, handle 6 akun klien sekaligus.", motivation: "Ingin fokus menggarap satu brand secara mendalam dan belajar strategi konten jangka panjang.", domisili: "Bekasi", komuterPlan: "SIAP_KOMUTER", shiftPref: "PAGI" },
  { name: "Nadia Salsabila", email: "nadia.salsabila@outlook.com", phone: "+628123456703", experience: "Freelance social media untuk UMKM, fokus konten Reels dan copywriting caption.", motivation: "Lumina Studio punya gaya konten yang kocak dan segar — saya ingin ikut menyumbang ide.", domisili: "Depok", komuterPlan: "SIAP_KOMUTER", shiftPref: "SIANG" },
  { name: "Dimas Prayoga", email: "dimas.prayoga@gmail.com", phone: "+628123456704", experience: "Admin media sosial komunitas gaming 50 ribu member selama 1,5 tahun.", motivation: "Kombinasi konten hiburan dan komunitas adalah bidang yang paling saya kuasai.", domisili: "Jakarta Timur", komuterPlan: "SIAP_KOMUTER", shiftPref: "APA_SAJA" },
  { name: "Bella Kirana Maheswari", email: "bella.kirana@gmail.com", phone: "+628123456705", experience: "Konten kreator paruh waktu, 80 ribu followers TikTok niche lifestyle.", motivation: "Saya paham selera audiens muda dan ingin menerapkannya di level studio profesional.", status: "INTERVIEW", domisili: "Tangerang Selatan", komuterPlan: "SIAP_KOMUTER", shiftPref: "PAGI" },
  { name: "Farhan Maulana", email: "farhan.maulana@gmail.com", phone: "+628123456706", experience: "Magang di divisi marketing startup edutech, kelola kalender konten mingguan.", motivation: "Siap belajar dari tim berpengalaman dan berkontribusi sejak hari pertama.", domisili: "Jakarta Barat", komuterPlan: "SIAP_KOMUTER", shiftPref: "SIANG" },
  { name: "Sinta Novelia", email: "sinta.novelia@gmail.com", phone: "+628123456707", experience: "1 tahun sebagai social media specialist di brand fashion online.", motivation: "Misi Lumina membuat hiburan yang aman untuk keluarga sejalan dengan nilai saya.", domisili: "Bogor", komuterPlan: "PERLU_RELOKASI", shiftPref: "PAGI" },
  { name: "Aldi Setiawan", email: "aldi.setiawan@gmail.com", phone: "+628123456708", experience: "Mengelola YouTube community tab & Twitter/X untuk channel gaming teman.", motivation: "Saya ingin berkarier di industri konten digital dan Lumina adalah tempat terbaiknya.", domisili: "Jakarta Utara", komuterPlan: "SIAP_KOMUTER", shiftPref: "APA_SAJA" },
  { name: "Mega Puspita Sari", email: "mega.puspita@gmail.com", phone: "+628123456709", experience: "Copywriter sekaligus admin IG untuk kafe lokal, kebiasaan riset tren harian.", motivation: "Kecintaan saya pada tren media sosial cocok dengan kebutuhan posisi ini.", domisili: "Jakarta Selatan", komuterPlan: "SIAP_KOMUTER", shiftPref: "SIANG" },
  { name: "Yoga Prasetya Nugraha", email: "yoga.prasetya@gmail.com", phone: "+628123456710", experience: "Social media volunteer di organisasi mahasiswa, naikkan followers 3x lipat.", motivation: "Saya cepat belajar, disiplin, dan siap mulai karier profesional di Lumina Studio.", domisili: "Cibubur", komuterPlan: "SIAP_KOMUTER", shiftPref: "PAGI" },
];

const webDeveloperApps: Dummy[] = [
  { name: "Andika Putra Herman", email: "andika.putra@gmail.com", phone: "+628129876501", experience: "3 tahun frontend developer, terbiasa Next.js, TypeScript, dan Tailwind CSS.", motivation: "Saya ingin mengerjakan produk nyata dengan traffic tinggi dan tim yang seru.", status: "REVIEWED" },
  { name: "Laila Fitriani", email: "laila.fitriani@gmail.com", phone: "+628129876502", experience: "Bootcamp lulusan fullstack JavaScript, portofolio 5 proyek Next.js + Prisma.", motivation: "Ingin beralih dari proyek pribadi ke produk studio yang benar-benar dipakai publik." },
  { name: "Reza Fahlevi", email: "reza.fahlevi@gmail.com", phone: "+628129876503", experience: "2 tahun membangun situs company profile dan dashboard internal dengan React.", motivation: "Konten keluarga Lumina menarik bagi saya secara pribadi sebagai penonton setia.", status: "INTERVIEW" },
  { name: "Gilang Ramadhan Saputra", email: "gilang.rs@gmail.com", phone: "+628129876504", experience: "Freelance web dev 2 tahun, fokus performa Core Web Vitals dan SEO teknikal.", motivation: "Saya suka tantangan optimasi dan ingin berkolaborasi dengan tim kreatif." },
  { name: "Aulia Nur Fadhilah", email: "aulia.fadhilah@gmail.com", phone: "+628129876505", experience: "Junior developer di software house, CRUD, REST API, dan integrasi pembayaran.", motivation: "Karier saya berkembang cepat di lingkungan yang kolaboratif seperti Lumina Studio." },
  { name: "Bagus Hermawan", email: "bagus.hermawan@gmail.com", phone: "+628129876506", experience: "Membuat bot Telegram dan mini app dengan TypeScript sebagai proyek sampingan.", motivation: "Pengalaman saya dengan bot dan otomasi relevan untuk fitur interaktif Lumina." },
  { name: "Citra Amelia Lestari", email: "citra.amelia@gmail.com", phone: "+628129876507", experience: "Fresh graduate informatika, skripsi berupa platform streaming video dengan Next.js.", motivation: "Saya penonton berat konten Lumina dan ingin berkontribusi di sisi teknologinya." },
  { name: "Hendra Kusuma Wardana", email: "hendra.kusuma@gmail.com", phone: "+628129876508", experience: "4 tahun fullstack developer, terakhir membangun marketplace UMKM berbasis Next.js.", motivation: "Saya mencari tim yang membangun produk dengan cepat dan serius soal kualitas." },
  { name: "Tania Oktaviani", email: "tania.oktaviani@gmail.com", phone: "+628129876509", experience: "1 tahun frontend engineer, akrab dengan Zustand, TanStack Query, dan shadcn/ui.", motivation: "Stack yang dipakai Lumina persis dengan yang saya kuasai — bisa langsung produktif." },
  { name: "Irfan Dwi Cahyono", email: "irfan.cahyono@gmail.com", phone: "+628129876510", experience: "Magang backend Node.js 6 bulan lalu freelance sampai sekarang.", motivation: "Ingin bekerja remote penuh di studio kreatif dan tumbuh menjadi engineer yang andal." },
];

const performanceAdsApps: Dummy[] = [
  { name: "Vino Ardiansyah", email: "vino.ardiansyah@gmail.com", phone: "+628137777601", experience: "3 tahun media buyer, mengelola budget ads Rp 200 juta/bulan untuk e-commerce.", motivation: "Saya gemar menguji kreatif dan angka — kombinasi yang dibutuhkan Lumina Studio.", status: "REVIEWED" },
  { name: "Ratna Dewi Kumalasari", email: "ratna.dewi@gmail.com", phone: "+628137777602", experience: "Performance marketer di agensi, fokus Meta Ads & TikTok Ads untuk brand lokal.", motivation: "Ingin mendalami industri hiburan keluarga yang pertumbuhannya sangat cepat." },
  { name: "Baginda Situmorang", email: "baginda.situmorang@gmail.com", phone: "+628137777603", experience: "2 tahun menjalankan Google Ads untuk edutech, CPA turun 35% dalam 6 bulan.", motivation: "Tantangan scaling channel baru adalah hal yang paling saya cari di karier saya." },
  { name: "Kirana Maheswari Ayu", email: "kirana.maheswari@gmail.com", phone: "+628137777604", experience: "Digital marketing specialist, handle campaign YouTube dan marketplace ads.", motivation: "Saya percaya konten Lucu Intens sejati butuh strategi distribusi yang terukur." },
  { name: "Galih Purnomo Aji", email: "galih.purnomo@gmail.com", phone: "+628137777605", experience: "Freelance ads specialist untuk 10+ UMKM, spesialis TikTok Ads dan retargeting.", motivation: "Bekerja dengan tim produksi konten in-house akan mempercepat iterasi iklan saya." },
  { name: "Anindya Paramitha", email: "anindya.paramitha@gmail.com", phone: "+628137777606", experience: "1,5 tahun performance ads di startup D2C, akrab dengan A/B testing dan funnel.", motivation: "Saya ingin tumbuh bersama studio yang menganggap data sebagai bahan baku kreativitas." },
  { name: "Bimo Aryo Setiadi", email: "bimo.aryo@gmail.com", phone: "+628137777607", experience: "Media buying untuk channel YouTube terbesar di kota saya sebelum bergabung agency.", motivation: "Pengalaman saya di niche hiburan cocok langsung dengan target audiens Lumina." },
  { name: "Sekar Ayu Anggraini", email: "sekar.ayu@gmail.com", phone: "+628137777608", experience: "Growth associate, mengelola budget ads mingguan dan laporan ROAS untuk manajemen.", motivation: "Saya teliti soal angka dan tertarik pada konten yang aman ditonton keluarga." },
  { name: "Panji Wicaksono", email: "panji.wicaksono@gmail.com", phone: "+628137777609", experience: "2 tahun di performance agency, handle portofolio klien fashion dan hiburan.", motivation: "Lumina Studio adalah tempat di mana kreativitas dan performa bertemu — saya mau ikut." },
  { name: "Melati Rahmawati Putri", email: "melati.rahmawati@gmail.com", phone: "+628137777610", experience: "Magang digital marketing 8 bulan, lalu membantu kampanye pemilu sebagai media buyer.", motivation: "Saya cepat beradaptasi dengan target dan siap berkontribusi sejak minggu pertama." },
  { name: "Arif Budi Santoso", email: "arif.santoso@gmail.com", phone: "+628137777611", experience: "E-commerce specialist beralih ke ads, terbiasa membaca dashboard Meta & TikTok harian.", motivation: "Saya ingin membangun mesin pertumbuhan yang terukur untuk channel-channel Lumina." },
  { name: "Dinda Ayu Lestari", email: "dinda.lestari@gmail.com", phone: "+628137777612", experience: "1 tahun social media specialist yang sering dipercaya pegang boosting budget.", motivation: "Melihat hasil kampanye naik adalah kepuasan tersendiri — dan itu pekerjaan saya." },
];

async function topUpQuota(title: string, dummies: Dummy[]): Promise<number> {
  const position = await getPositionByTitle(title);
  if (position.maxApplicants == null) throw new Error(`${title} tidak punya kuota`);
  const current = await nonRejectedCount(position.id);
  const needed = Math.max(0, position.maxApplicants - current);
  if (needed === 0) {
    console.log(`  ✓ ${title}: kuota sudah penuh (${current}/${position.maxApplicants}) — dilewati`);
    return 0;
  }
  const batch = dummies.slice(0, needed);
  for (const d of batch) {
    await db.application.create({
      data: {
        name: d.name,
        email: d.email,
        phone: d.phone,
        experience: d.experience,
        motivation: d.motivation,
        status: d.status ?? "NEW",
        positionId: position.id,
        trackingCode: randomCode(),
        consentAt: new Date(),
        source: "Halaman Karier (demo seed)",
        domisili: d.domisili ?? null,
        komuterPlan: d.komuterPlan ?? null,
        shiftPref: d.shiftPref ?? null,
      },
    });
  }
  console.log(`  ✓ ${title}: +${batch.length} lamaran dummy → ${current + batch.length}/${position.maxApplicants} (penuh)`);
  return batch.length;
}

async function main() {
  console.log("== Seed kondisi khusus posisi (penuh / lewat batas waktu / hampir ditutup) ==\n");

  // 1) PENUH ANGGOTA — top-up lamaran sampai kuota tercapai.
  console.log("[1] Posisi kuota penuh:");
  let added = 0;
  added += await topUpQuota("Social Media Officer", socialMediaOfficerApps);
  added += await topUpQuota("Web Developer (Next.js)", webDeveloperApps);
  added += await topUpQuota("Performance Ads Specialist", performanceAdsApps);
  console.log(`    total lamaran dummy dibuat: ${added}\n`);

  // 2) LEWAT BATAS WAKTU — closesAt ke masa lalu (aplikasi akan auto-close).
  console.log("[2] Posisi lewat batas waktu:");
  const expiredTargets: Array<{ title: string; days: number }> = [
    { title: "Ilustrator Karakter", days: 3 },
    { title: "Copywriter Iklan", days: 5 },
    { title: "Podcast Editor", days: 2 },
  ];
  for (const target of expiredTargets) {
    const position = await getPositionByTitle(target.title);
    const past = daysAgo(target.days);
    if (position.closesAt && position.closesAt.getTime() <= Date.now()) {
      console.log(`  ✓ ${target.title}: closesAt sudah lewat — dilewati`);
      continue;
    }
    await db.position.update({ where: { id: position.id }, data: { closesAt: past } });
    console.log(`  ✓ ${target.title}: closesAt diundur ${target.days} hari ke belakang (sudah lewat)`);
  }
  console.log("");

  // 3) HAMPIR DITUTUP — closesAt beberapa jam / 1-2 hari lagi ("Segera Ditutup").
  console.log("[3] Posisi hampir ditutup (sisa waktu sedikit):");
  const soonTargets: Array<{ title: string; desc: string; at: Date }> = [
    { title: "Thumbnail Designer", desc: "+7 jam", at: hoursFromNow(7) },
    { title: "Host TikTok Live", desc: "+10 jam", at: hoursFromNow(10) },
    { title: "Community Manager", desc: "+2 hari", at: daysFromNow(2) },
  ];
  for (const target of soonTargets) {
    const position = await getPositionByTitle(target.title);
    if (position.closesAt && position.closesAt.getTime() > Date.now() && position.closesAt.getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000) {
      console.log(`  ✓ ${target.title}: closesAt sudah < 3 hari — dilewati`);
      continue;
    }
    await db.position.update({ where: { id: position.id }, data: { closesAt: target.at } });
    console.log(`  ✓ ${target.title}: closesAt di-set ${target.desc}`);
  }

  console.log("\nSelesai. Posisi penuh & lewat batas waktu akan otomatis ditutup (AUTO_CLOSE)");
  console.log("saat GET /api/public/content dipanggil; posisi hampir ditutup tampil dengan");
  console.log('chip "Segera Ditutup" + countdown hidup.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
