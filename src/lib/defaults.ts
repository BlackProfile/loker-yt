// Nilai default aplikasi rekrutmen konten kreator.
// File ini murni konstanta (tanpa import server), aman diimpor dari klien maupun server.
import type { Role, SiteContent } from "@/lib/types";

export const DEFAULT_ADMIN_PASSWORD = "admin123";

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
  },
];
