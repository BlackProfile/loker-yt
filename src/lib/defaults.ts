// Nilai default aplikasi rekrutmen konten kreator.
// File ini murni konstanta (tanpa import server), aman diimpor dari klien maupun server.
import type {
  Role,
  ScreeningQuestion,
  SectionVisibility,
  SiteContent,
} from "@/lib/types";

export const DEFAULT_ADMIN_PASSWORD = "admin123";

// Semua bagian halaman publik tampil secara default.
export const DEFAULT_SECTIONS: SectionVisibility = {
  hero: true,
  positions: true,
  about: true,
  benefits: true,
  steps: true,
  applyForm: true,
  statusCheck: true,
  testimonials: true,
  faq: true,
  subscribe: true,
  finalCta: true,
  chatbot: true,
};

export const DEFAULT_SITE: SiteContent = {
  siteName: "Lumina Studio",
  tagline: "Tim Kreatif Konten Digital",
  heroBadge: "Rekrutmen Batch 2025 Terbuka",
  heroTitle: "Bergabung dengan Tim",
  heroHighlight: "Kreatif Kami",
  heroDescription:
    "Kami mencari talenta digital yang siap menciptakan konten menghibur untuk jutaan penonton. Bekerja remote dengan jam fleksibel, dan tumbuh bersama kreator yang sudah dipercaya lebih dari 2 juta pengikut.",
  deadline: "30 September 2025",
  aboutTitle: "Tentang Lumina Studio",
  aboutDescription:
    "Lumina Studio adalah rumah produksi konten digital yang menaungi channel YouTube, TikTok, dan Instagram dengan total lebih dari 2 juta pengikut. Setiap minggu kami memproduksi puluhan konten, mulai dari video pendek, vlog, podcast, hingga kolaborasi dengan brand. Untuk terus bertumbuh, kami membutuhkan tim kecil yang tajam, gesit, dan tentu saja seru.",
  benefits: [
    {
      icon: "Globe",
      title: "100% Remote",
      description:
        "Bekerja dari mana saja sesuai gayamu. Semua koordinasi tim berjalan online, jadi kamu tidak perlu terikat lokasi.",
    },
    {
      icon: "Clock",
      title: "Jam Fleksibel",
      description:
        "Kami fokus pada hasil, bukan jam kerja. Atur jadwalmu sendiri selama target dan deadline tercapai.",
    },
    {
      icon: "Wallet",
      title: "Kompensasi Kompetitif",
      description:
        "Gaji di atas rata-rata industri dengan bonus proyek, dan pembayaran selalu tepat waktu.",
    },
    {
      icon: "GraduationCap",
      title: "Mentoring & Kelas",
      description:
        "Belajar langsung dari kreator senior dan praktisi industri melalui sesi mentoring rutin setiap bulan.",
    },
    {
      icon: "Film",
      title: "Proyek Beragam",
      description:
        "Video pendek, vlog, podcast, hingga kampanye brand besar. Portofoliomu akan semakin kaya.",
    },
    {
      icon: "Rocket",
      title: "Jalur Karier Jelas",
      description:
        "Mulai dari freelancer hingga inti tim. Kinerjamu menentukan pertumbuhan karier dan kompensasimu.",
    },
  ],
  faqs: [
    {
      question: "Apakah semua posisi bisa dikerjakan remote?",
      answer:
        "Ya. Saat ini semua posisi kami dirancang untuk dikerjakan remote. Kegiatan tim seperti rapat mingguan dan sesi syuting khusus tetap dilakukan secara online, jadi kamu bisa berada di mana saja.",
    },
    {
      question: "Bagaimana proses seleksinya?",
      answer:
        "Setelah kamu mengirim lamaran, tim HR meninjau portofolio dan jawabanmu (1-3 hari kerja). Kandidat yang lolos tahap pertama diundang ke wawancara online, lalu masa uji coba proyek selama 1-2 minggu.",
    },
    {
      question: "Apakah boleh melamar lebih dari satu posisi?",
      answer:
        "Boleh, tapi kami sarankan memilih satu posisi yang paling sesuai dengan keahlianmu agar proses peninjauan lebih fokus. Jika sudah bergabung, kamu tetap bisa mencoba peran lain di kemudian hari.",
    },
    {
      question: "Sistem kerjanya seperti apa?",
      answer:
        "Kami memakai sistem berbasis proyek dengan deadline mingguan. Kamu bebas mengatur jadwal selama target tercapai dan hadir di rapat koordinasi online setiap Senin.",
    },
  ],
  contactEmail: "rekrutmen@lumina.id",
  contactWhatsapp: "6281234567890",
  instagram: "@lumina.studio",
  footerText: "© 2025 Lumina Studio. Seluruh hak cipta dilindungi.",
  teamMembers: [
    {
      name: "Rania Putri",
      role: "Video Editor Senior",
      quote:
        "Dua tahun di Lumina dan saya masih terkejut seberapa cepat kami mencoba ide gila baru setiap minggu.",
    },
    {
      name: "Dimas Aryo",
      role: "Penulis Naskah",
      quote:
        "Remote bukan berarti sendirian. Tim ini membuat saya tetap merasa punya rumah kreatif.",
    },
    {
      name: "Kayla Nursyifa",
      role: "Thumbnail Designer",
      quote:
        "Karya kami dilihat jutaan orang setiap minggu. Sensasinya tidak tergantikan.",
    },
  ],
  chatbotEnabled: true,
  discordWebhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
  sections: { ...DEFAULT_SECTIONS },
};

export type DefaultUserSeed = {
  name: string;
  email: string;
  password: string;
  role: Role;
};

// Akun admin awal (dibuat saat seed jika tabel AdminUser kosong).
export const DEFAULT_USERS: DefaultUserSeed[] = [
  { name: "Pemilik Studio", email: "admin@lumina.id", password: "admin123", role: "OWNER" },
  { name: "Tim HR", email: "hr@lumina.id", password: "admin123", role: "HR" },
  { name: "Pengamat", email: "viewer@lumina.id", password: "admin123", role: "VIEWER" },
];

export type DefaultPositionSeed = {
  title: string;
  department: string;
  type: string;
  location: string;
  description: string;
  requirements: string[];
  order: number;
  // Fitur per lowongan (v3) — opsional, hanya untuk memperkaya data demo
  salaryText?: string;
  salaryVisible?: boolean;
  benefits?: string[];
  examples?: string[];
  urgent?: boolean;
  featured?: boolean;
  screeningQuestions?: ScreeningQuestion[];
  requireCv?: boolean;
  requireIntro?: boolean;
  requirePortfolio?: boolean;
  maxApplicants?: number;
  aiCriteria?: string;
  applyTemplate?: string;
  acceptTemplate?: string;
  rejectTemplate?: string;
  assignmentTitle?: string;
  assignmentUrl?: string;
  assignmentNote?: string;
  rubricCriteria?: string[];
  checklistTemplate?: string[];
  noteTemplates?: string[];
};

export const DEFAULT_POSITIONS: DefaultPositionSeed[] = [
  {
    title: "Video Editor",
    department: "Video Editing",
    type: "Part-time",
    location: "Remote",
    order: 1,
    description:
      "Mengubah footage mentah menjadi cerita yang mengalir dan menghibur. Kamu akan bekerja langsung dengan tim kreatif untuk memproduksi 8-12 video pendek setiap bulan untuk YouTube, TikTok, dan Instagram.",
    requirements: [
      "Menguasai Premiere Pro, CapCut, atau DaVinci Resolve",
      "Paham ritme storytelling untuk konten pendek (short-form)",
      "Mampu bekerja dengan deadline ketat dan revisi cepat",
      "Memiliki portofolio video yang bisa ditunjukkan",
    ],
    salaryText: "Rp 3,5 - 5 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Peralatan editing disediakan (lisensi & workspace)",
      "Bonus performa per video yang melewati target views",
      "Jam fleksibel — deliverable berbasis deadline mingguan",
      "Akses arsip footage eksklusif untuk latihan gaya editing",
    ],
    examples: [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=9bZkp7q19f0",
    ],
    featured: true,
    requirePortfolio: true,
    screeningQuestions: [
      { id: "q1", label: "Berapa lama pengalamanmu editing video pendek (short-form)?", required: true },
      { id: "q2", label: "Software editing apa yang paling kamu kuasai dan kenapa?", required: true },
      { id: "q3", label: "Berapa video yang biasanya kamu selesaikan per minggu?", required: false },
    ],
    aiCriteria:
      "Utamakan kandidat dengan pengalaman short-form (TikTok/Reels/Shorts), paham ritme hook 3 detik pertama, dan mencantumkan portofolio nyata. Pengalaman di channel gaming/vlog bernilai plus.",
    applyTemplate:
      "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman ini. Tim kami meninjau lamaran 1-3 hari kerja — pantau terus yaa!",
    acceptTemplate:
      "Selamat {nama}! Kamu lolos seleksi untuk posisi {posisi} di Lumina Studio. Tim HR akan menghubungimu via WhatsApp untuk onboarding. Sampai jumpa di tim!",
    rejectTemplate:
      "Hai {nama}, terima kasih sudah melamar posisi {posisi}. Setelah meninjau lamaranmu, tim kami memutuskan untuk tidak melanjutkan ke tahap berikutnya. Jangan bersemangatmu padam — kamu dipersilakan melamar lagi di batch berikutnya!",
    assignmentTitle: "Tes Editing: Potong 1 video pendek 60 detik",
    assignmentUrl: "https://drive.google.com/lumina-tes-editing",
    assignmentNote:
      "Brief, footage mentah, dan referensi gaya ada di folder tes. Deadline 3 hari setelah brief dikirim. Fokus pada hook 3 detik pertama dan ritme cut.",
    rubricCriteria: ["Teknis editing", "Ritme storytelling", "Ketepatan deadline"],
    checklistTemplate: [
      "Sudah cek portofolio/video showreel",
      "Sudah cek jawaban pertanyaan screening",
      "Sudah cek referensi/link sosial media",
    ],
    noteTemplates: [
      "Portofolio sudah dilihat: ",
      "Catatan tes editing: ",
    ],
  },
  {
    title: "Thumbnail Designer",
    department: "Desain Grafis",
    type: "Freelance",
    location: "Remote",
    order: 2,
    description:
      "Merancang thumbnail dan aset visual yang membuat penonton penasaran untuk klik. Kamu akan berkolaborasi dengan tim riset untuk menguji desain dengan performa CTR terbaik.",
    requirements: [
      "Menguasai Photoshop atau Figma",
      "Memahami psikologi desain klik (CTR-driven)",
      "Sensitif terhadap tren visual di YouTube dan TikTok",
      "Mampu menghasilkan minimal 10 thumbnail per bulan",
    ],
    salaryText: "Rp 250-400 ribu/thumbnail",
    salaryVisible: true,
    benefits: [
      "Brief jelas dengan referensi gaya dari tim riset",
      "Pembayaran per batch, tepat waktu",
      "Nama kamu tertera di credits video performa tinggi",
    ],
    urgent: true,
    screeningQuestions: [
      { id: "q1", label: "Tautkan 3 thumbnail terbaikmu yang sudah tayang.", required: true },
    ],
    rubricCriteria: ["Daya tarik visual", "Kesesuaian gaya channel", "Kecepatan eksekusi"],
    checklistTemplate: ["Sudah cek 3 thumbnail yang dilampirkan"],
    noteTemplates: ["Hasil review thumbnail: "],
  },
  {
    title: "Penulis Naskah",
    department: "Penulisan Konten",
    type: "Part-time",
    location: "Remote",
    order: 3,
    description:
      "Menyusun ide dan naskah untuk video YouTube dan TikTok, mulai dari hook pembuka yang kuat hingga penutup yang mudah diingat. Riset tren dan topik menjadi bagian penting dari pekerjaanmu.",
    requirements: [
      "Kemampuan riset topik dan tren yang kuat",
      "Gaya bahasa segar, lucu, dan mudah dicerna",
      "Terbiasa menulis naskah untuk konten pendek dan panjang",
      "Punya portofolio tulisan (blog, naskah, atau skrip video)",
    ],
    salaryText: "Rp 2,5 - 4 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Akses riset tren premium (alat riset topik)",
      "Naskah diproduksi jadi video — lihat tulisanmu hidup",
      "Sesi brainstorming mingguan bersama kreator",
    ],
    requirePortfolio: true,
    screeningQuestions: [
      { id: "q1", label: "Tulis 1 hook (maks 15 kata) untuk video berjudul 'Kebiasaan kreator sukses yang jarang dibahas'.", required: true },
      { id: "q2", label: "Genre konten apa yang paling kamu kuasai risetnya?", required: false },
    ],
    assignmentTitle: "Tes Naskah: 1 outline video + 1 naskah 90 detik",
    assignmentNote:
      "Pilih satu topik tren terkini, buat outline 5 poin dan naskah lengkap 90 detik. Kirim saat diminta tim HR.",
    rubricCriteria: ["Kekuatan hook", "Struktur naskah", "Kesesuaian gaya suara"],
    checklistTemplate: ["Sudah cek portofolio tulisan", "Sudah cek jawaban tes hook"],
    noteTemplates: ["Catatan tes naskah: "],
  },
  {
    title: "Social Media Officer",
    department: "Social Media",
    type: "Full-time",
    location: "Remote",
    order: 4,
    description:
      "Mengelola kalender konten, caption, dan interaksi komunitas di semua platform kami. Kamu menjadi jembatan antara kreator dan penonton serta memastikan setiap unggahan berperforma optimal.",
    requirements: [
      "Berpengalaman mengelola akun sosial media brand atau kreator",
      "Memahami analitik Instagram, TikTok, dan YouTube",
      "Terbiasa menyusun kalender konten mingguan",
      "Komunikatif dan cepat tanggap terhadap tren",
    ],
    salaryText: "Rp 5 - 7 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Full-time remote dengan jam fleksibel",
      "Anggaran bulanan untuk eksperimen konten & ads",
      "Peluang menghadiri event komunitas kreator",
    ],
    maxApplicants: 10,
    screeningQuestions: [
      { id: "q1", label: "Akun sosial media apa yang pernah kamu kelola? Sebutkan hasilnya.", required: true },
    ],
    rubricCriteria: ["Pemahaman platform", "Bukti pertumbuhan akun", "Kemampuan komunitas"],
    checklistTemplate: ["Sudah cek akun yang dikelola", "Sudah verifikasi data pertumbuhan"],
    noteTemplates: ["Ringkasan interview HR: ", "Hasil cek akun: "],
  },
  {
    title: "Content Strategist",
    department: "Perencanaan Konten",
    type: "Full-time",
    location: "Remote",
    order: 5,
    description:
      "Merencanakan arah konten bulanan berdasarkan data performa dan riset audiens. Kamu akan memimpin brainstorming mingguan dan memastikan setiap video punya tujuan yang jelas.",
    requirements: [
      "Pengalaman 1+ tahun di perencanaan konten digital",
      "Mampu membaca data performa dan menarik insight",
      "Terbiasa memimpin diskusi kreatif tim kecil",
      "Memahami lanskap konten YouTube, TikTok, dan Instagram",
    ],
    salaryText: "Rp 6 - 9 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Kepemilikan penuh atas roadmap konten bulanan",
      "Anggaran riset audiens & tools analitik",
      "Kolaborasi langsung dengan kreator utama",
    ],
    rubricCriteria: ["Kemampuan analitik", "Visi konten", "Pengalaman memimpin"],
    checklistTemplate: ["Sudah review ide konten yang diusulkan", "Sudah cek studi kasus pertumbuhan"],
    noteTemplates: ["Catatan sesi brainstorming: "],
  },
];
