// Nilai default aplikasi rekrutmen konten kreator.
// File ini murni konstanta (tanpa import server), aman diimpor dari klien maupun server.
import {
  DEFAULT_TELEGRAM_ALERTS,
  type Role,
  type ScreeningQuestion,
  type SelectionContent,
  type SectionVisibility,
  type SiteContent,
} from "@/lib/types";

export const DEFAULT_ADMIN_PASSWORD = "admin123";

// Fitur inti aktif secara default: daftar posisi, formulir pendaftaran, dan
// cek status. Section lain mati secara default — admin bisa menyalakannya
// kapan saja dari menu Pengaturan (Kartu Tampilan Section).
export const DEFAULT_SECTIONS: SectionVisibility = {
  hero: false,
  positions: true,
  about: false,
  benefits: false,
  steps: false,
  applyForm: true,
  statusCheck: true,
  testimonials: false,
  faq: false,
  subscribe: false,
  finalCta: false,
  chatbot: false,
};

// Teks awal kartu editor admin untuk section "Proses Seleksi" (cerminan kamus ID).
// Dipakai saat admin mengaktifkan teks kustom — nilai di DB tetap null (teks
// bawaan) sampai admin benar-benar menyimpan.
export const DEFAULT_SELECTION_CONTENT: SelectionContent = {
  badge: "Alur Seleksi",
  title: "Proses Seleksi dari Awal sampai Gabung",
  desc: "Enam tahap transparan — kamu selalu tahu sedang di mana dan apa langkah berikutnya.",
  stages: [
    {
      title: "Lamar & Unggah Berkas",
      description: "Isi formulir singkat, unggah CV, dan tambahkan tautan karya terbaikmu.",
      duration: "±3 menit",
      tips: [
        "Siapkan CV satu halaman dan tautan portofolio terbaikmu",
        "Isi data dengan jujur — tim memverifikasi setiap lamaran",
        "Video perkenalan singkat membuat lamaranmu lebih personal",
      ],
    },
    {
      title: "Seleksi Berkas",
      description: "Tim meninjau CV, portofolio, dan jawaban screening setiap pelamar.",
      duration: "±1-3 hari kerja",
      tips: [
        "Pastikan CV mudah dibaca dan relevan dengan posisi",
        "Tulis motivasi yang spesifik untuk studio, bukan template umum",
      ],
    },
    {
      title: "Tes Seleksi",
      description:
        "Posisi tertentu mendapat tugas uji singkat sesuai bidangnya, lengkap dengan tenggat.",
      duration: "1-3 hari pengerjaan",
      tips: [
        "Kumpulkan sebelum tenggat — keterlambatan memengaruhi penilaian",
        "Ikuti instruksi tugas dengan saksama; kualitas lebih penting dari kuantitas",
        "Nilai tes muncul di Cek Status setelah tim menilai",
      ],
    },
    {
      title: "Wawancara",
      description:
        "Sesi ngobrol online atau tatap muka untuk saling mengenal — bisa lebih dari satu ronde.",
      duration: "±45 menit per sesi",
      tips: [
        "Hadir 10 menit lebih awal dan uji kamera serta mikrofon",
        "Siapkan pertanyaan untuk tim — tanda ketertarikan yang baik",
        "Cek Status memudahkan konfirmasi kehadiran dan ubah jadwal",
      ],
    },
    {
      title: "Penawaran",
      description:
        "Kamu menerima surat penawaran berisi posisi, kompensasi, dan tanggal mulai.",
      duration: "±1-2 hari kerja",
      tips: [
        "Baca detail offer sampai selesai, termasuk batas jawaban",
        "Tanyakan dulu bila ada yang belum jelas sebelum memutuskan",
      ],
    },
    {
      title: "Onboarding",
      description:
        "Selamat bergabung! Lengkapi dokumen, kenali tim, dan mulai proyek pertamamu.",
      duration: "Hari pertamamu",
      tips: [
        "Lengkapi dokumen onboarding sebelum hari pertama",
        "Catat pertanyaan apa saja — minggu pertama adalah waktu terbaik untuk bertanya",
      ],
    },
  ],
};

export const DEFAULT_SITE: SiteContent = {
  siteName: "Lumina Studio",
  tagline: "Tim Kreatif Konten Digital",
  heroBadge: "Rekrutmen Batch 2025 Terbuka",
  heroTitle: "Bergabung dengan Tim",
  heroHighlight: "Kreatif Kami",
  heroDescription:
    "Kami mencari talenta digital yang siap menciptakan konten menghibur untuk jutaan penonton. Ada posisi remote, on-site di studio, dan hybrid — semua dengan jam fleksibel di tim kreator yang sudah dipercaya lebih dari 2 juta pengikut.",
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
        "Tidak semua. Sebagian posisi dikerjakan penuh remote, sebagian on-site di studio kami, dan ada juga yang hybrid. Mode kerja tertera jelas di setiap lowongan — cek badge Remote/On-site/Hybrid di kartu posisi, lengkap dengan alamat kantor bila perlu datang.",
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
  chatbotEnabled: false,
  discordWebhookUrl: "",
  telegramBotToken: "",
  telegramChatId: "",
  telegramWriteEnabled: true,
  telegramAllowedChats: [],
  telegramAlerts: { ...DEFAULT_TELEGRAM_ALERTS },
  telegramLastDigest: "",
  telegramMutes: {},
  telegramLastChart: "",
  telegramQuotaAlerts: {},
  recruitmentClosed: false,
  recruitmentClosedMessage: "",
  selection: null,
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
  // Mode kerja & lokasi terstruktur (fitur non-remote)
  workMode?: "REMOTE" | "ONSITE" | "HYBRID";
  city?: string;
  address?: string;
  mapsUrl?: string;
  workHours?: string;
  shiftSystem?: "NONE" | "FIXED" | "ROTATING";
  facilities?: string[];
  description: string;
  requirements: string[];
  order: number;
  // Fitur per lowongan (v3) — opsional, hanya untuk memperkaya data demo
  salaryText?: string;
  salaryVisible?: boolean;
  benefits?: string[];
  examples?: string[];
  selectionTips?: string[]; // NR68 (#15) — kiat lamar per posisi
  urgent?: boolean;
  featured?: boolean;
  screeningQuestions?: ScreeningQuestion[];
  requireCv?: boolean;
  requireIntro?: boolean;
  requirePortfolio?: boolean;
  // NR-22 — slot opsional wizard klasik bisa disembunyikan per posisi
  showCvField?: boolean;
  showIntroField?: boolean;
  showPortfolioField?: boolean;
  showSocialField?: boolean;
  // NR-24 — kolom opsional ekspektasi gaji di wizard
  showExpectedSalary?: boolean;
  // NR-52 — dokumen wajib tambahan (customDocs) & batas umur minimum
  customDocs?: string[];
  minAge?: number;
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
    location: "Jakarta (hybrid — 2 hari remote/minggu)",
    workMode: "HYBRID",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Senin-Jumat, 10.00-18.00 WIB (Senin & Rabu remote)",
    shiftSystem: "NONE",
    facilities: [
      "Parkir motor & mobil",
      "Makan siang gratis",
      "Uang transport",
      "Ruang kolaborasi & studio mini",
    ],
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
    location: "Jakarta (on-site)",
    workMode: "ONSITE",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Senin-Jumat, 09.00-17.00 WIB",
    shiftSystem: "NONE",
    facilities: [
      "Parkir motor & mobil",
      "Makan siang gratis",
      "Uang transport",
      "Asuransi kesehatan",
    ],
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

  // NR-52 — 7 lowongan operasional & produksi pendukung.
  {
    title: "Pembersih Rumah",
    department: "Operasional & Rumah Tangga",
    type: "Part-time",
    location: "Jakarta (on-site)",
    workMode: "ONSITE",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Senin, Rabu & Jumat, 08.00-13.00 WIB",
    shiftSystem: "NONE",
    facilities: ["Uang transport harian", "Sarapan sebelum mulai kerja", "Peralatan & bahan kebersihan disediakan"],
    order: 7,
    description:
      "Menjaga kebersihan dan kenyamanan ruang kerja studio serta area rumah produksi: menyapu, mengepel, merapikan ruang meeting, membersihkan dapur & kamar mandi, serta membantu tata ulang ruang saat ada acara syuting.",
    requirements: [
      "Pengalaman kerja kebersihan rumah/kantor minimal 1 tahun",
      "Rapi, jujur, dan tepat waktu",
      "Sehat dan mampu bekerja secara fisik (menyapu, mengepel, mengangkat peralatan ringan)",
      "Bersedia bekerja di area studio Menteng, Jakarta Pusat",
    ],
    salaryText: "Rp 1,8 - 2,2 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Jadwal pendek 3 hari seminggu",
      "Peralatan kerja lengkap disediakan",
      "Suasana kerja santai bersama tim kreatif",
    ],
    screeningQuestions: [
      { id: "q1", label: "Berapa lama pengalamanmu membersihkan rumah atau kantor?", required: true },
      { id: "q2", label: "Apakah bersedia bekerja Senin-Rabu-Jumat pukul 08.00-13.00 di area Menteng?", required: true },
      { id: "q3", label: "Apakah kamu memiliki kendaraan sendiri untuk menuju lokasi kerja?", required: false },
    ],
    customDocs: ["Foto/Salinan KTP"],
    minAge: 18,
    showCvField: false,
    showIntroField: false,
    showPortfolioField: false,
    showSocialField: false,
    showExpectedSalary: false,
    aiCriteria:
      "Utamakan kandidat dengan pengalaman kebersihan yang jelas, kesediaan penuh terhadap jadwal Senin-Rabu-Jumat pagi, dan jawaban yang jujur-ramah. Sertakan kesiapan transportasi sebagai nilai plus.",
    rubricCriteria: ["Pengalaman kebersihan", "Kesesuaian jadwal", "Kerapian & sikap"],
    checklistTemplate: ["Sudah cek foto KTP", "Sudah konfirmasi jadwal di screening"],
    noteTemplates: ["Catatan screening kebersihan: "],
  },
  {
    title: "Pembantu Rumah",
    department: "Operasional & Rumah Tangga",
    type: "Full-time",
    location: "Jakarta (on-site)",
    workMode: "ONSITE",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Senin-Sabtu, 08.00-17.00 WIB",
    shiftSystem: "NONE",
    facilities: ["Makan 3x sehari", "Uang transport", "Seragam kerja", "Bonus hari besar"],
    order: 8,
    description:
      "Membantu kegiatan rumah tangga tim & dapur studio: menyiapkan hidangan sederhana untuk tim, mencuci & menata peralatan, menyetrika, serta membantu kebutuhan acara kecil seperti arisan kreator atau makan siang bareng.",
    requirements: [
      "Pengalaman sebagai pembantu rumah minimal 1 tahun",
      "Mampu menyiapkan masakan rumahan sehari-hari",
      "Jujur, komunikatif, dan nyaman bekerja di sekitar tim kreatif",
      "Sehat dan bersedia membantu menyiapkan acara kecil di studio",
    ],
    salaryText: "Rp 2,2 - 2,8 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Makan 3x sehari dari dapur studio",
      "Libur Minggu rutin & bonus hari besar",
      "Lingkungan kerja keluarga dan aman",
    ],
    screeningQuestions: [
      { id: "q1", label: "Berapa lama pengalamanmu bekerja sebagai pembantu rumah?", required: true },
      { id: "q2", label: "Menuju masakan apa saja yang paling kamu kuasai untuk menu sehari-hari?", required: true },
      { id: "q3", label: "Apakah bersedia membantu menyiapkan konsumsi saat ada acara tim di studio?", required: true },
    ],
    customDocs: ["Foto/Salinan KTP"],
    minAge: 18,
    showCvField: false,
    showIntroField: false,
    showPortfolioField: false,
    showSocialField: false,
    showExpectedSalary: false,
    aiCriteria:
      "Utamakan kandidat dengan pengalaman rumah tangga nyata, mampu menuliskan menu masakan yang masuk akal, dan bersedia membantu acara tim. Jawaban hangat & komunikatif adalah nilai plus.",
    rubricCriteria: ["Pengalaman rumah tangga", "Kemampuan memasak", "Sikap & komunikasi"],
    checklistTemplate: ["Sudah cek foto KTP", "Sudah cek jawaban menu masakan"],
    noteTemplates: ["Catatan screening pembantu rumah: "],
  },
  {
    title: "Audio Engineer",
    department: "Audio & Produksi",
    type: "Part-time",
    location: "Jakarta (hybrid — mixing boleh remote)",
    workMode: "HYBRID",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Fleksibel — sesi rekam di studio, mixing boleh dari rumah",
    shiftSystem: "NONE",
    facilities: ["Akses studio rekam mini", "Monitor speaker & interface disediakan", "Proyek musik lintas channel"],
    order: 9,
    description:
      "Menangani perekaman, editing, mixing, dan mastering audio untuk podcast YouTube, voice-over video, dan konten pendek. Kamu memastikan setiap konten terdengar bersih, konsisten, dan nyaman didengar di semua platform.",
    requirements: [
      "Menguasai minimal satu DAW: Adobe Audition, Reaper, Cubase, atau Pro Tools",
      "Pengalaman mixing & mastering podcast atau video (minimal 1 tahun)",
      "Paham noise reduction, equalization, dan loudness standar platform (mis. -14 LUFS)",
      "Memiliki contoh karya mixing yang bisa diputar/didengarkan",
    ],
    salaryText: "Rp 4 - 6 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Akses penuh studio rekam mini Lumina",
      "Jam kerja fleksibel berbasis deliverable",
      "Portofolio audio lintas genre (podcast, voice-over, musik)",
    ],
    requirePortfolio: true,
    screeningQuestions: [
      { id: "q1", label: "DAW apa yang paling kamu kuasai dan berapa lama menggunakannya?", required: true },
      { id: "q2", label: "Tautkan 1-2 contoh hasil mixing/mastering terbaikmu (SoundCloud/Drive/YouTube).", required: true },
      { id: "q3", label: "Berapa jam audio jadi yang biasa kamu selesaikan dalam seminggu?", required: false },
    ],
    showPortfolioField: true,
    showIntroField: false,
    showSocialField: false,
    aiCriteria:
      "Utamakan kandidat dengan tautan karya nyata, penguasaan DAW yang spesifik, dan pemahaman loudness standar platform. Pengalaman podcast/voice-over bernilai plus.",
    rubricCriteria: ["Kualitas hasil mixing", "Penguasaan DAW", "Ketepatan deadline"],
    checklistTemplate: ["Sudah dengarkan contoh mixing", "Sudah cek jawaban DAW & loudness"],
    noteTemplates: ["Catatan tes audio: "],
  },
  {
    title: "Kameramen",
    department: "Produksi Video",
    type: "Freelance",
    location: "Jakarta (on-site, mengikuti jadwal syuting)",
    workMode: "ONSITE",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Mengikuti jadwal syuting (umumnya 09.00-17.00, kadang weekend)",
    shiftSystem: "ROTATING",
    facilities: ["Uang transport & makan saat syuting", "Akses alat studio (tripod, lighting, audio kit)", "Kredit nama di video"],
    order: 10,
    description:
      "Menangani kamera saat produksi konten YouTube, TikTok, dan iklan klien: menyiapkan komposisi, exposure, dan fokus, membantu penataan lighting dasar, serta bekerja sama dengan sutradara/kreator di lapangan.",
    requirements: [
      "Terbiasa mengoperasikan kamera mirrorless/cine (Sony, Canon, atau setara)",
      "Paham dasar exposure, white balance, fokus, dan framing untuk konten vertikal & horizontal",
      "Pengalaman syuting multi-kamera atau event/live session menjadi nilai plus",
      "Mampu bekerja cepat di lokasi dengan cahaya minim",
    ],
    salaryText: "Rp 3 - 4,5 juta/bulan (per batch proyek)",
    salaryVisible: true,
    benefits: [
      "Proyek rutin multi-genre (vlog, podcast, iklan)",
      "Akses peralatan studio saat syuting",
      "Jaringan luas dengan kreator & brand",
    ],
    requirePortfolio: true,
    screeningQuestions: [
      { id: "q1", label: "Kamera & lensa apa yang paling sering kamu pakai? Sebutkan pengalamannya.", required: true },
      { id: "q2", label: "Pernah menangani syuting multi-kamera atau acara live? Ceritakan singkat.", required: true },
      { id: "q3", label: "Apakah memiliki alat transportasi untuk menuju lokasi syuting luar studio?", required: false },
    ],
    showSocialField: false,
    aiCriteria:
      "Utamakan kandidat dengan portofolio rekaman nyata (reel/showreel), spesifikasi kamera yang jelas, dan pengalaman syuting multi-kamera. Kesiapan travel lokasi adalah nilai plus.",
    rubricCriteria: ["Teknis kamera & framing", "Pengalaman produksi", "Kerja tim di lapangan"],
    checklistTemplate: ["Sudah cek showreel/portofolio", "Sudah cek jawaban kamera & multi-kamera"],
    noteTemplates: ["Catatan review showreel: "],
  },
  {
    title: "Asisten Studio",
    department: "Operasional Studio",
    type: "Full-time",
    location: "Jakarta (hybrid)",
    workMode: "HYBRID",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Senin-Jumat, 09.00-18.00 WIB (kadang weekend saat event)",
    shiftSystem: "NONE",
    facilities: ["Uang transport & makan", "Dukungan alat kerja (laptop)", "Asuransi kesehatan"],
    order: 11,
    description:
      "Membantu kelancaran aktivitas harian studio: mengatur jadwal kreator, mengkoordinasi vendor & kurir, menyiapkan kebutuhan meeting/acara, serta administrasi ringan (pembelian, arsip nota, follow-up pihak luar).",
    requirements: [
      "Pengalaman sebagai asisten pribadi/tim atau admin kantor minimal 1 tahun",
      "Rapi dalam mengatur jadwal (kalender, reminder, daftar tugas)",
      "Komunikatif, ramah, dan terbiasa berhubungan dengan pihak luar",
      "Mampu multitasking dan tetap tenang saat ada perubahan mendadak",
    ],
    salaryText: "Rp 3 - 4 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Terlibat langsung dalam operasional studio kreatif",
      "Jam kerja jelas dengan lembur terbatas",
      "Peluang berkembang ke peran operasional/produksi",
    ],
    screeningQuestions: [
      { id: "q1", label: "Ceritakan pengalamanmu menjadi asisten/admin (durasi & tugas harian).", required: true },
      { id: "q2", label: "Sebutkan 3 aplikasi yang kamu pakai untuk mengatur jadwal & catatan (mis. Google Calendar, Notion, WhatsApp).", required: true },
      { id: "q3", label: "Apakah bersedia membantu acara weekend sesekali (maks 2x sebulan)?", required: false },
    ],
    customDocs: ["Foto/Salinan KTP"],
    minAge: 18,
    showCvField: true,
    showIntroField: true,
    showPortfolioField: false,
    showSocialField: false,
    aiCriteria:
      "Utamakan kandidat dengan pengalaman asisten/admin konkret, menyebut aplikasi organisasi yang relevan, dan nada jawaban rapi-berstruktur. Kesiapan bantu acara weekend bernilai plus.",
    rubricCriteria: ["Keteraturan & organisasi", "Kemampuan komunikasi", "Pengalaman relevan"],
    checklistTemplate: ["Sudah cek CV (jika ada)", "Sudah cek jawaban aplikasi organisasi"],
    noteTemplates: ["Catatan interview HR: "],
  },
  {
    title: "Supir",
    department: "Transportasi & Logistik",
    type: "Full-time",
    location: "Jakarta (on-site)",
    workMode: "ONSITE",
    city: "Jakarta",
    address: "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat",
    mapsUrl: "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat",
    workHours: "Senin-Sabtu, fleksibel mengikuti jadwal tim (umumnya 08.00-17.00)",
    shiftSystem: "FIXED",
    facilities: ["Uang makan & bensin", "Jadwal teratur dengan lembur jelas", "Servis kendaraan ditanggung studio"],
    order: 12,
    description:
      "Mengantar tim & peralatan studio ke lokasi syuting, meeting klien, dan event; merawat kendaraan studio (kebersihan, servis rutin, cek ban & dokumen); membantu muat-pindah peralatan ringan saat turun lokasi.",
    requirements: [
      "Memiliki SIM A yang masih aktif (min. 2 tahun)",
      "Paham rute Jabodetabek dan terbiasa memakai navigasi",
      "Berkendara aman, teliti, dan menjaga privasi tim",
      "Bersedia membantu memindahkan peralatan ringan saat syuting",
    ],
    salaryText: "Rp 3 - 3,5 juta/bulan + uang lembur",
    salaryVisible: true,
    benefits: [
      "Uang makan & bensin harian",
      "Lembur dihitung jelas per jam",
      "Kendaraan studio dirawat rutin — tidak dipakai pribadi sembarangan",
    ],
    screeningQuestions: [
      { id: "q1", label: "SIM apa yang kamu miliki, dan sudah berapa tahun aktif menyetir secara profesional?", required: true },
      { id: "q2", label: "Seberapa akrab kamu dengan rute Jabodetabek? Sebutkan area yang paling sering kamu lalui.", required: true },
      { id: "q3", label: "Apakah bersedia mengantar tim ke luar kota bila dibutuhkan (menginap 1-2 malam)?", required: false },
    ],
    customDocs: ["Foto/Salinan SIM A yang masih aktif", "Foto/Salinan KTP"],
    minAge: 21,
    showCvField: false,
    showIntroField: false,
    showPortfolioField: false,
    showSocialField: false,
    showExpectedSalary: false,
    aiCriteria:
      "Utamakan kandidat dengan SIM A aktif & pengalaman profesional jelas, pemahaman rute Jabodetabek yang konkret, dan kesediaan luar kota. Sikap aman & tertib adalah nilai utama.",
    rubricCriteria: ["Kelayakan SIM & pengalaman", "Pemahaman rute", "Sikap aman & profesional"],
    checklistTemplate: ["Sudah cek foto SIM aktif", "Sudah cek foto KTP", "Sudah verifikasi pengalaman menyetir"],
    noteTemplates: ["Catatan screening supir: "],
  },
  {
    title: "Admin Media Sosial",
    department: "Social Media",
    type: "Part-time",
    location: "Remote",
    workMode: "REMOTE",
    workHours: "Fleksibel — wajib respons jam sibuk 18.00-21.00 WIB",
    shiftSystem: "NONE",
    facilities: ["100% remote", "Jam fleksibel dengan target harian jelas", "Sertifikat & bonus engagement"],
    order: 13,
    description:
      "Menjadwalkan & mengunggah konten ke Instagram, TikTok, dan X sesuai kalender tim; membalas komentar & DM dengan nada brand; mengarsipkan ide konten dari interaksi penonton; serta membuat laporan engagement mingguan sederhana.",
    requirements: [
      "Paham ekosistem Instagram, TikTok, dan X (format, jam aktif, tren)",
      "Copywriting ringan yang rapi dan sesuai nada brand",
      "Terbiasa memakai scheduler (Meta Business Suite, Later, atau setara)",
      "Responsif dan disiplin pada jadwal unggahan",
    ],
    salaryText: "Rp 2,5 - 3,5 juta/bulan",
    salaryVisible: true,
    benefits: [
      "Bekerja dari mana saja",
      "Materi konten sudah disiapkan tim desain & editing",
      "Peluang naik ke peran Social Media Officer",
    ],
    screeningQuestions: [
      { id: "q1", label: "Akun media sosial apa saja yang pernah kamu kelola (brand/kreator/pribadi)? Sebutkan hasilnya.", required: true },
      { id: "q2", label: "Berapa kali sehari kamu biasa mengunggah & membalas interaksi di akun yang dikelola?", required: true },
      { id: "q3", label: "Apakah nyaman on-call membalas DM/komentar di jam sibuk 18.00-21.00 WIB?", required: true },
    ],
    minAge: 18,
    showCvField: true,
    showIntroField: false,
    showPortfolioField: false,
    showSocialField: true,
    aiCriteria:
      "Utamakan kandidat dengan bukti pengelolaan akun nyata (tautan akun), pola posting yang masuk akal, dan kesediaan penuh untuk jam sibuk malam. Pemahaman tren IG/TikTok/X bernilai plus.",
    rubricCriteria: ["Pemahaman platform", "Konsistensi posting", "Kualitas interaksi komunitas"],
    checklistTemplate: ["Sudah cek tautan akun yang dikelola", "Sudah cek jawaban jam sibuk"],
    noteTemplates: ["Catatan screening admin medsos: "],
  },
];
