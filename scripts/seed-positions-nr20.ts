// NR-20/21 — Seed 3 posisi operasional on-site baru (Supir Armada Operasional,
// Pembantu Operasional Studio, PRT) lengkap dengan template pesan, screening,
// rubric/checklist, round plan, dua bahasa, dan 2 lamaran demo per posisi.
// Pola & konstanta disalin dari scripts/seed-20-positions.ts.
// Idempoten: posisi dengan slug yang sama dilewati (lamaran demo hanya dibuat
// saat posisi benar-benar baru, jadi aman dijalankan ulang).
import { db } from "../src/lib/db";

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let n = 2;
  while (await db.position.findUnique({ where: { slug } })) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

const days = (n: number) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

const applyTpl =
  "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman Cek Status. Tim kami meninjau lamaran 1-3 hari kerja — pantau terus yaa!";
const acceptTpl =
  "Selamat {nama}! Kamu lolos seleksi untuk posisi {posisi} di Lumina Studio. Tim HR akan menghubungimu via WhatsApp untuk langkah onboarding. Sampai jumpa di tim!";
const rejectTpl =
  "Hai {nama}, terima kasih sudah melamar posisi {posisi}. Setelah meninjau lamaranmu, tim kami memutuskan untuk tidak melanjutkan ke tahap berikutnya. Jangan padamkan semangatmu — kamu dipersilakan melamar lagi di batch berikutnya!";
const inviteTpl =
  "Hai {nama}, kamu diundang ke wawancara untuk posisi {posisi}.\nWaktu: {tanggal}, {jam} WIB\nMode: {mode}\nTempat/Link: {link}\nMohon konfirmasi kehadiranmu dengan membalas pesan ini.";
const offerTpl =
  "Selamat {nama}! Kami ingin menawarkanmu posisi {posisi} dengan kompensasi {gaji}/bulan mulai {tanggal}. Penawaran berlaku hingga {deadline}. Detail lengkap akan dikirim via email.";
const welcomeTpl =
  "Selamat bergabung di Lumina Studio, {nama}! Kamu resmi memulai posisi {posisi} pada {tanggal}. Tim onboarding akan mengirimkan panduan hari pertamamu.";

// Template pesan per posisi (apply/accept/reject disesuaikan; invite/offer/
// welcome tetap memakai konstanta generik di atas).
type MsgTpl = { apply: string; accept: string; reject: string };
const MSG_TPL: Record<string, MsgTpl> = {
  "Supir Armada Operasional": {
    apply:
      "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman Cek Status. Pastikan SIM A kamu siap diverifikasi — tim kami meninjau lamaran 1-3 hari kerja!",
    accept:
      "Selamat {nama}! Kamu lolos seleksi posisi {posisi} di Lumina Studio. Tim HR akan menghubungimu via WhatsApp untuk verifikasi dokumen SIM dan jadwal tes mengemudi. Sampai jumpa di kantor Cikini!",
    reject:
      "Hai {nama}, terima kasih sudah melamar posisi {posisi}. Setelah meninjau lamaranmu, tim kami memutuskan untuk tidak melanjutkan ke tahap berikutnya. Tetap semangat — kamu dipersilakan melamar lagi di batch berikutnya!",
  },
  "Pembantu Operasional Studio": {
    apply:
      "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman Cek Status. Tim kami meninjau lamaran 1-3 hari kerja — sampai jumpa di studio!",
    accept:
      "Selamat {nama}! Kamu lolos seleksi posisi {posisi} di Lumina Studio. Tim HR akan menghubungimu via WhatsApp untuk onboarding dan tur studio. Siapkan tenaga dan semangatmu!",
    reject:
      "Hai {nama}, terima kasih sudah melamar posisi {posisi}. Kali ini tim kami memutuskan untuk tidak melanjutkan lamaranmu. Jangan padamkan semangatmu — kamu dipersilakan melamar lagi di batch berikutnya!",
  },
  "PRT (Pembantu Rumah Tangga)": {
    apply:
      "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman Cek Status. Tim keluarga kami meninjau lamaran 1-3 hari kerja dengan saksama.",
    accept:
      "Selamat {nama}! Keluarga kami senang menyambut kamu untuk posisi {posisi}. Tim kami akan menghubungimu via WhatsApp untuk mengatur hari pertama dan kebutuhan dokumen.",
    reject:
      "Hai {nama}, terima kasih sudah melamar posisi {posisi}. Setelah dipertimbangkan dengan saksama, kami memutuskan untuk tidak melanjutkan ke tahap berikutnya. Semoga sukses — silakan melamar lagi bila ada kesempatan berikutnya!",
  },
};

const JKT_ADDR = "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat";
const JKT_MAPS = "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat";

const FAC_FULL = [
  "Parkir motor & mobil",
  "Makan siang gratis",
  "Uang transport",
  "Ruang kolaborasi & studio mini",
];

type Seed = {
  title: string;
  titleEn: string;
  department: string;
  type: string;
  location: string;
  workMode: "REMOTE" | "ONSITE" | "HYBRID";
  city?: string;
  address?: string;
  mapsUrl?: string;
  workHours?: string;
  shiftSystem?: "NONE" | "FIXED" | "ROTATING";
  facilities?: string[];
  dailySlotQuota?: number;
  description: string;
  descriptionEn: string;
  requirements: string[];
  requirementsEn: string[];
  salaryText: string;
  salaryMin?: number;
  salaryMax?: number;
  benefits: string[];
  examples?: string[];
  urgent?: boolean;
  featured?: boolean;
  closesInDays: number;
  screeningQuestions: { id: string; label: string; required: boolean }[];
  requireCv?: boolean;
  requireIntro?: boolean;
  requirePortfolio?: boolean;
  customDocs?: string[];
  maxApplicants?: number;
  aiCriteria: string;
  assignment?: { title: string; url?: string; note: string };
  rubricCriteria: string[];
  checklistTemplate: string[];
  noteTemplates: string[];
  interviewMode?: "ONLINE" | "ONSITE";
  interviewDuration?: number;
  interviewCriteria: string[];
  onboardingDocs: string[];
  reapplyCooldownDays?: number;
  roundPlan: { round: number; name: string; mode: "ONLINE" | "ONSITE"; platform: string; durationMin: number }[];
};

const SEEDS: Seed[] = [
  {
    title: "Supir Armada Operasional",
    titleEn: "Fleet Driver",
    department: "Operasional",
    type: "Full-time",
    location: "Studio Cikini",
    workMode: "ONSITE",
    city: "Jakarta Pusat",
    address: JKT_ADDR,
    mapsUrl: JKT_MAPS,
    workHours: "Senin-Sabtu, shift bergilir (07.00-15.00 / 15.00-23.00 WIB)",
    shiftSystem: "ROTATING",
    facilities: FAC_FULL,
    description:
      "Mengantar tim dan peralatan produksi ke lokasi syuting, menjemput talent, mengantar paket aset, serta merawat armada studio agar selalu siap pakai. Kamu adalah penjamin kelancaran mobilitas Lumina di lapangan.",
    descriptionEn:
      "Drive the team and production equipment to shooting locations, pick up talent, deliver asset packages, and keep the studio fleet ready at all times. You are the guardian of Lumina's on-the-ground mobility.",
    requirements: [
      "Memiliki SIM A yang masih aktif",
      "Pengalaman menyetir untuk kebutuhan operasional, kurir, atau keluarga minimal 2 tahun",
      "Hafal jalur Jabodetabek dan terbiasa navigasi peta",
      "Rajin, tepat waktu, dan tidak merokok di dalam kendaraan",
      "Mampu merawat kendaraan harian (cek ban, oli, dan kebersihan)",
    ],
    requirementsEn: [
      "Hold an active SIM A (Indonesian driving license class A)",
      "At least 2 years of driving experience for operations, courier, or family needs",
      "Familiar with Jabodetabek routes and daily map navigation",
      "Diligent, punctual, and does not smoke inside the vehicle",
      "Able to perform daily vehicle care (tires, oil, cleanliness)",
    ],
    salaryText: "Rp 4.500.000 - Rp 5.500.000 / bulan",
    salaryMin: 4500000,
    salaryMax: 5500000,
    benefits: [
      "Gaji tetap bulanan plus uang lembur saat syuting panjang",
      "Seragam dan bensin kendaraan operasional ditanggung studio",
      "Makan siang gratis saat bekerja di kantor",
      "Asuransi kecelakaan kerja",
    ],
    urgent: false,
    featured: false,
    closesInDays: 45,
    maxApplicants: 60,
    screeningQuestions: [
      { id: "sq_sim_a", label: "Apakah Anda memiliki SIM A yang masih aktif?", required: true },
      { id: "sq_pengalaman_supir", label: "Berapa tahun pengalaman menyetir Anda secara profesional?", required: true },
      { id: "sq_shift", label: "Apakah Anda bersedia shift bergilir termasuk weekend?", required: true },
      { id: "sq_domisili", label: "Di mana domisili Anda saat ini?", required: true },
    ],
    requireCv: true,
    requirePortfolio: false,
    requireIntro: false,
    customDocs: ["SIM A (scan)", "Surat Kesehatan", "SKCK"],
    aiCriteria:
      "Utamakan kandidat dengan SIM A aktif dan pengalaman menyetir profesional yang jelas. Nilai kesesuaian domisili dengan area Jakarta Pusat, kejelasan jawaban screening, dan kesediaan mengikuti shift bergilir termasuk weekend.",
    rubricCriteria: ["Kedisiplinan & kerapian", "Pengetahuan jalur", "Kondisi SIM & dokumen", "Komunikasi & sopan santun"],
    checklistTemplate: [
      "SIM A aktif terverifikasi",
      "Surat kesehatan diterima",
      "Cek referensi pengalaman menyetir",
      "Jadwalkan tes mengemudi",
    ],
    noteTemplates: [
      "Dokumen SIM belum lengkap — hubungi pelamar.",
      "Sudah dijadwalkan tes mengemudi lapangan.",
      "Catatan tes mengemudi: ",
    ],
    interviewMode: "ONSITE",
    interviewDuration: 30,
    interviewCriteria: ["Ketepatan waktu", "Pengetahuan jalur & navigasi", "Kerapian & penampilan", "Sikap & komunikasi"],
    onboardingDocs: ["FC SIM A", "FC KTP", "SKCK", "Surat Kesehatan", "Rekening bank"],
    roundPlan: [
      { round: 1, name: "Wawancara HR", mode: "ONSITE", platform: "- (Kantor Cikini)", durationMin: 30 },
      { round: 2, name: "Tes Mengemudi Lapangan", mode: "ONSITE", platform: "- (Rute Cikini-Menteng)", durationMin: 45 },
    ],
  },
  {
    title: "Pembantu Operasional Studio",
    titleEn: "Studio Operations Assistant",
    department: "Operasional",
    type: "Full-time",
    location: "Studio Cikini",
    workMode: "ONSITE",
    city: "Jakarta Pusat",
    address: JKT_ADDR,
    mapsUrl: JKT_MAPS,
    workHours: "Senin-Jumat, 09.00-18.00 WIB (fleksibel saat syuting)",
    shiftSystem: "FIXED",
    facilities: FAC_FULL,
    description:
      "Membantu kelancaran operasional harian studio: menyiapkan dan merapikan set, membantu setup perlengkapan produksi, mengelola gudang properti, dan mendukung tim konten saat syuting berlangsung.",
    descriptionEn:
      "Support daily studio operations: prepare and tidy sets, assist with production equipment setup, manage the props warehouse, and back up the content team during shoots.",
    requirements: [
      "Minimal lulusan SMA/SMK",
      "Siap kerja fisik: mengangkat perlengkapan, setup lighting, dan merapikan set",
      "Teliti dan disiplin",
      "Pengalaman di studio, gudang, atau event menjadi nilai plus",
      "Bersedia lembur saat ada jadwal syuting",
    ],
    requirementsEn: [
      "Minimum high school (SMA/SMK) graduate",
      "Ready for physical work: lifting equipment, lighting setup, and set tidying",
      "Meticulous and disciplined",
      "Experience in a studio, warehouse, or events is a plus",
      "Willing to work overtime during shooting schedules",
    ],
    salaryText: "Rp 3.500.000 - Rp 4.500.000 / bulan",
    salaryMin: 3500000,
    salaryMax: 4500000,
    benefits: [
      "Gaji tetap bulanan plus uang lembur syuting",
      "Makan siang gratis dan uang transport",
      "Asuransi kecelakaan kerja",
      "Pelatihan perlengkapan produksi dari tim senior",
    ],
    urgent: false,
    featured: false,
    closesInDays: 45,
    maxApplicants: 40,
    screeningQuestions: [
      { id: "sq_fisik", label: "Apakah Anda siap bekerja dengan aktivitas fisik (mengangkat, memasang perlengkapan)?", required: true },
      { id: "sq_pengalaman_ops", label: "Ceritakan pengalaman kerja fisik/operasional Anda (studio, gudang, event, dll.)", required: true },
      { id: "sq_lembur", label: "Apakah Anda bersedia lembur saat ada jadwal syuting?", required: true },
    ],
    requireCv: true,
    requirePortfolio: false,
    requireIntro: false,
    customDocs: ["Surat Kesehatan", "SKCK"],
    aiCriteria:
      "Utamakan kandidat yang menjelaskan pengalaman kerja fisik secara konkret, bersedia lembur saat syuting, dan menunjukkan sikap teliti serta disiplin dalam jawabannya.",
    rubricCriteria: ["Kerapian & kedisiplinan", "Pemahaman tugas operasional", "Stamina & kesiapan fisik", "Kerja tim"],
    checklistTemplate: [
      "Cek pengalaman operasional",
      "Konfirmasi kesiapan shift/lembur",
      "Verifikasi referensi",
      "Jadwalkan wawancara on-site",
    ],
    noteTemplates: [
      "Catatan wawancara operasional: ",
      "Hasil verifikasi referensi: ",
      "Konfirmasi kesiapan lembur sudah dicatat.",
    ],
    interviewMode: "ONSITE",
    interviewDuration: 30,
    interviewCriteria: ["Kerapian & kedisiplinan", "Pemahaman tugas operasional", "Kesiapan fisik", "Komunikasi"],
    onboardingDocs: ["FC KTP", "SKCK", "Surat Kesehatan", "Rekening bank"],
    roundPlan: [
      { round: 1, name: "Wawancara & Tur Studio", mode: "ONSITE", platform: "- (Kantor Cikini)", durationMin: 45 },
    ],
  },
  {
    title: "PRT (Pembantu Rumah Tangga)",
    titleEn: "Household Assistant",
    department: "Operasional",
    type: "Full-time",
    location: "Residen Pemilik",
    workMode: "ONSITE",
    city: "Jakarta Selatan",
    address: "Jl. Kemang Timur No. 12, Mampang Prapatan, Jakarta Selatan",
    mapsUrl: "https://maps.google.com/?q=Jl.+Kemang+Timur+No.+12,+Jakarta+Selatan",
    workHours: "Senin-Sabtu, 08.00-17.00 WIB",
    shiftSystem: "NONE",
    facilities: ["Makan saat hari kerja", "Kamar tinggal bila live-in", "Uang transport"],
    description:
      "Menjaga kebersihan dan kerapian rumah tinggal pemilik studio, membantu kebutuhan dapur dan laundry harian, serta sesekali menyiapkan konsumsi rapat tim di rumah. Lingkungan kerja hangat dan seperti keluarga.",
    descriptionEn:
      "Keep the studio owner's residence clean and tidy, help with daily kitchen and laundry needs, and occasionally prepare refreshments for team meetings at home. A warm, family-like work environment.",
    requirements: [
      "Pengalaman bekerja sebagai PRT minimal 1 tahun",
      "Bisa memasak menu harian sederhana",
      "Jujur, bersih, dan tepat waktu",
      "Sehat jasmani",
      "Nyaman bekerja di rumah pribadi keluarga pemilik studio",
    ],
    requirementsEn: [
      "At least 1 year of experience as a household assistant",
      "Able to cook simple daily meals",
      "Honest, clean, and punctual",
      "Physically healthy",
      "Comfortable working at the studio owner's private residence",
    ],
    salaryText: "Rp 3.000.000 - Rp 4.000.000 / bulan",
    salaryMin: 3000000,
    salaryMax: 4000000,
    benefits: [
      "Gaji tetap bulanan dibayar tepat waktu",
      "Makan saat hari kerja",
      "Libur mingguan dan cuti tahunan",
      "Suasana kerja keluarga yang hangat",
    ],
    urgent: false,
    featured: false,
    closesInDays: 45,
    maxApplicants: 30,
    screeningQuestions: [
      { id: "sq_pengalaman_prt", label: "Berapa lama pengalaman Anda bekerja sebagai PRT?", required: true },
      { id: "sq_masak", label: "Menu apa saja yang biasa Anda masak?", required: true },
      { id: "sq_livein", label: "Apakah Anda bersedia bekerja sistem tinggal (live-in) atau pulang harian?", required: true },
    ],
    requireCv: false,
    requirePortfolio: false,
    requireIntro: false,
    customDocs: ["Surat Kesehatan", "SKCK", "Surat Pengalaman Kerja"],
    aiCriteria:
      "Utamakan kandidat dengan pengalaman PRT yang bisa dikonfirmasi, menu masakan harian yang spesifik, dan jawaban yang menunjukkan kejujuran serta kerapian. Kesiapan live-in atau pulang harian dicatat untuk admin.",
    rubricCriteria: ["Kejujuran & keterpercayaan", "Keterampilan memasak", "Kebersihan & kerapian", "Komunikasi"],
    checklistTemplate: [
      "Cek pengalaman & referensi PRT",
      "Tanya kesiapan live-in",
      "Verifikasi surat kesehatan",
      "Jadwalkan coba kerja 3 hari",
    ],
    noteTemplates: [
      "Catatan wawancara & coba kerja: ",
      "Hasil cek referensi PRT: ",
      "Surat pengalaman kerja masih ditunggu — hubungi pelamar.",
    ],
    interviewMode: "ONSITE",
    interviewDuration: 30,
    interviewCriteria: ["Kejujuran", "Keterampilan memasak", "Kebersihan & kerapian", "Komunikasi"],
    onboardingDocs: ["FC KTP", "SKCK", "Surat Kesehatan", "Rekening bank"],
    roundPlan: [
      { round: 1, name: "Wawancara & Coba Kerja", mode: "ONSITE", platform: "- (Residen Pemilik)", durationMin: 60 },
    ],
  },
];

// ---------- Lamaran demo (2 per posisi, hanya dibuat saat posisi baru) ----------
type DemoApp = {
  name: string;
  email: string;
  phone: string;
  experience: string;
  motivation: string;
  answers: Record<string, string>;
};

const DEMO_APPS: Record<string, DemoApp[]> = {
  "Supir Armada Operasional": [
    {
      name: "Budi Santoso",
      email: "budi.santoso@example.com",
      phone: "081234567801",
      experience:
        "Saya sudah 4 tahun bekerja sebagai supir operasional di perusahaan distribusi kecil di Jakarta. Sehari-hari saya mengantar tim dan barang ke seluruh area Jabodetabek dan terbiasa menjaga jadwal serta kondisi kendaraan.",
      motivation:
        "Saya ingin pindah ke lingkungan kerja yang lebih dekat dengan dunia kreatif dan tim yang hangat. Saya rajin, tepat waktu, dan senang merawat kendaraan agar selalu prima.",
      answers: {
        sq_sim_a: "Ya, aktif",
        sq_pengalaman_supir: "4 tahun",
        sq_shift: "Ya, bersedia termasuk weekend",
        sq_domisili: "Jakarta Pusat",
      },
    },
    {
      name: "Agus Setiawan",
      email: "agus.setiawan@example.com",
      phone: "081234567802",
      experience:
        "Dua tahun terakhir saya menjadi kurir armada untuk e-commerce dengan rute harian Jakarta-Bogor-Depok. Sebelumnya saya membantu usaha keluarga sebagai sopir antar-jemput.",
      motivation:
        "Saya hafal jalur alternatif Jabodetabek dan terbiasa berangkat pagi. Bergabung dengan studio seperti Lumina terasa menarik karena jadwalnya jelas dan timnya ramah.",
      answers: {
        sq_sim_a: "Ya, SIM A aktif",
        sq_pengalaman_supir: "3 tahun",
        sq_shift: "Bersedia, lebih suka shift pagi",
        sq_domisili: "Bekasi Timur",
      },
    },
  ],
  "Pembantu Operasional Studio": [
    {
      name: "Rudi Hartono",
      email: "rudi.hartono@example.com",
      phone: "081234567803",
      experience:
        "Saya bekerja 2 tahun di gudang logistik dengan tanggung jawab penataan barang dan siap kirim. Di akhir pekan saya sering membantu setup panggung kecil untuk event komunitas.",
      motivation:
        "Saya kuat secara fisik dan senang bekerja dengan cara yang terstruktur. Saya ingin belajar perlengkapan produksi studio dan tumbuh bersama tim Lumina.",
      answers: {
        sq_fisik: "Ya, siap",
        sq_pengalaman_ops: "2 tahun di gudang logistik dan terbiasa membantu setup event",
        sq_lembur: "Ya, bersedia lembur saat syuting",
      },
    },
    {
      name: "Joko Prasetyo",
      email: "joko.prasetyo@example.com",
      phone: "081234567804",
      experience:
        "Setahun terakhir saya menjadi crew event organizer: memasang rig lighting, menata backstage, dan merapikan set sebelum serta sesudah acara. Saya terbiasa bekerja cepat mengikuti checklist.",
      motivation:
        "Dunia produksi konten menarik bagi saya dan saya ingin fokus di satu tim. Saya disiplin, teliti, dan tidak ragu mengangkat perlengkapan berat bila dibutuhkan.",
      answers: {
        sq_fisik: "Ya, terbiasa angkat rig dan perlengkapan",
        sq_pengalaman_ops: "1 tahun sebagai crew event organizer (setup lighting dan backstage)",
        sq_lembur: "Bersedia, termasuk weekend saat ada syuting",
      },
    },
  ],
  "PRT (Pembantu Rumah Tangga)": [
    {
      name: "Sri Wahyuni",
      email: "sri.wahyuni@example.com",
      phone: "081234567805",
      experience:
        "Saya bekerja 2 tahun sebagai PRT di keluarga di Kemang: membereskan rumah, mencuci, dan menyiapkan masakan harian. Majikan saya pindah tugas ke luar negeri sehingga saya mencari pekerjaan baru.",
      motivation:
        "Saya jujur, bersih, dan menyukai rumah yang rapi. Saya bisa memasak menu harian sederhana dan siap bekerja sistem pulang harian dengan tepat waktu.",
      answers: {
        sq_pengalaman_prt: "2 tahun",
        sq_masak: "Sayur asem, ayam goreng, sop, nasi goreng, dan tumisan sayur",
        sq_livein: "Pulang harian",
      },
    },
    {
      name: "Sumiati",
      email: "sumiati@example.com",
      phone: "081234567806",
      experience:
        "Selama setahun saya membantu keluarga di Tebet untuk kebersihan rumah dan laundry, termasuk menyiapkan konsumsi saat ada acara keluarga. Saya juga terbiasa merawat tanaman hias.",
      motivation:
        "Saya ingin bekerja di rumah yang tenang dan menghargai pekerjaan rumah tangga. Saya sehat, tepat waktu, dan bersedia tinggal (live-in) bila diperlukan pada hari-hari sibuk.",
      answers: {
        sq_pengalaman_prt: "1 tahun",
        sq_masak: "Masakan Sunda sederhana: lalapan, oseng, sup ayam, dan gorengan",
        sq_livein: "Bisa live-in atau pulang harian",
      },
    },
  ],
};

async function randomTrackingCode(): Promise<string> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (;;) {
    let s = "";
    for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    const code = `LM-${s}`;
    const clash = await db.application.findUnique({ where: { trackingCode: code } });
    if (!clash) return code;
  }
}

async function main() {
  console.log("== NR-20/21 — Seed 3 posisi operasional on-site + lamaran demo ==\n");

  const maxAgg = await db.position.aggregate({ _max: { order: true } });
  let nextOrder = (maxAgg._max.order ?? 0) + 1;

  let created = 0;
  let skipped = 0;
  let appsCreated = 0;

  for (const seed of SEEDS) {
    const baseSlug = slugify(seed.title);
    const existing = await db.position.findUnique({ where: { slug: baseSlug } });
    if (existing) {
      skipped++;
      console.log(`= ${seed.title}: slug "${baseSlug}" sudah ada — dilewati`);
      continue;
    }
    const slug = await uniqueSlug(seed.title);
    const tpl = MSG_TPL[seed.title] ?? { apply: applyTpl, accept: acceptTpl, reject: rejectTpl };
    const position = await db.position.create({
      data: {
        title: seed.title,
        slug,
        department: seed.department,
        type: seed.type,
        location: seed.location,
        workMode: seed.workMode,
        city: seed.city ?? null,
        address: seed.address ?? null,
        mapsUrl: seed.mapsUrl ?? null,
        workHours: seed.workHours ?? null,
        shiftSystem: seed.shiftSystem ?? "NONE",
        facilities: JSON.stringify(seed.facilities ?? []),
        dailySlotQuota: seed.dailySlotQuota ?? null,
        description: seed.description,
        requirements: JSON.stringify(seed.requirements),
        isActive: true,
        closesAt: days(seed.closesInDays),
        order: nextOrder++,
        salaryText: seed.salaryText,
        salaryVisible: true,
        salaryMin: seed.salaryMin ?? null,
        salaryMax: seed.salaryMax ?? null,
        benefits: JSON.stringify(seed.benefits),
        examples: JSON.stringify(seed.examples ?? []),
        urgent: seed.urgent ?? false,
        featured: seed.featured ?? false,
        screeningQuestions: JSON.stringify(seed.screeningQuestions),
        requireCv: seed.requireCv ?? false,
        requireIntro: seed.requireIntro ?? false,
        requirePortfolio: seed.requirePortfolio ?? false,
        customDocs: JSON.stringify(seed.customDocs ?? []),
        maxApplicants: seed.maxApplicants ?? null,
        applyOpen: true,
        aiCriteria: seed.aiCriteria,
        applyTemplate: tpl.apply,
        acceptTemplate: tpl.accept,
        rejectTemplate: tpl.reject,
        assignmentTitle: seed.assignment?.title ?? null,
        assignmentUrl: seed.assignment?.url ?? null,
        assignmentNote: seed.assignment?.note ?? null,
        rubricCriteria: JSON.stringify(seed.rubricCriteria),
        checklistTemplate: JSON.stringify(seed.checklistTemplate),
        noteTemplates: JSON.stringify(seed.noteTemplates),
        interviewMode: seed.interviewMode ?? "ONLINE",
        interviewPlatform: "GOOGLE_MEET",
        interviewDuration: seed.interviewDuration ?? 45,
        interviewCriteria: JSON.stringify(seed.interviewCriteria),
        interviewInviteTemplate: inviteTpl,
        offerTemplate: offerTpl,
        welcomeTemplate: welcomeTpl,
        probationMonths: 3,
        onboardingDocs: JSON.stringify(seed.onboardingDocs),
        reapplyCooldownDays: seed.reapplyCooldownDays ?? 0,
        autoCloseOnHired: true,
        titleEn: seed.titleEn,
        descriptionEn: seed.descriptionEn,
        requirementsEn: JSON.stringify(seed.requirementsEn),
        roundPlan: JSON.stringify(seed.roundPlan),
      },
    });
    created++;
    console.log(`+ ${seed.title} (${seed.workMode}, ${seed.type}, slug: ${slug}, order: ${position.order})`);

    // Lamaran demo — hanya untuk posisi yang baru dibuat (jaga idempotensi).
    for (const d of DEMO_APPS[seed.title] ?? []) {
      const app = await db.application.create({
        data: {
          name: d.name,
          email: d.email,
          phone: d.phone,
          positionId: position.id,
          experience: d.experience,
          motivation: d.motivation,
          status: "NEW",
          screeningAnswers: JSON.stringify(d.answers),
          source: "Formulir Web",
          trackingCode: await randomTrackingCode(),
          stageHistory: JSON.stringify([{ stage: "NEW", at: new Date().toISOString() }]),
          portfolioUrl: null,
          isDuplicate: false,
          consentAt: new Date(),
        },
      });
      appsCreated++;
      console.log(`  + lamaran demo: ${d.name} (${app.trackingCode})`);
    }
  }

  const totalPositions = await db.position.count();
  const totalApplications = await db.application.count();
  console.log(
    `\nSelesai: ${created} posisi dibuat, ${skipped} dilewati, ${appsCreated} lamaran demo dibuat. ` +
      `Total di DB: ${totalPositions} posisi / ${totalApplications} lamaran.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
