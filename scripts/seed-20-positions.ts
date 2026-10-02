// Seed 15 posisi tambahan (total 20 dengan 5 posisi bawaan) — lengkap semua fitur
// per lowongan: mode kerja terstruktur, gaji, benefit, screening, dokumen wajib,
// template pesan, rubric/checklist, round plan wawancara, dua bahasa, dst.
// Idempoten: posisi dengan slug yang sama dilewati.
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

const JKT_ADDR = "Gedung Kreatif Lumina, Jl. Cikini Raya No. 45, Menteng, Jakarta Pusat";
const JKT_MAPS = "https://maps.google.com/?q=Jl.+Cikini+Raya+No.+45,+Menteng,+Jakarta+Pusat";
const BDO_ADDR = "Lumina Hub Bandung, Jl. Asia Afrika No. 88, Sumur Bandung, Kota Bandung";
const BDO_MAPS = "https://maps.google.com/?q=Jl.+Asia+Afrika+No.+88,+Kota+Bandung";
const SBY_ADDR = "Lumina Space Surabaya, Jl. Basuki Rachmat No. 12, Kedungdoro, Surabaya";
const SBY_MAPS = "https://maps.google.com/?q=Jl.+Basuki+Rachmat+No.+12,+Surabaya";

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
    title: "Ilustrator Karakter",
    titleEn: "Character Illustrator",
    department: "Desain Grafis",
    type: "Freelance",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Menggambar karakter dan aset ilustrasi untuk stiker, thumbnail, dan segmen animasi video kami. Kamu akan bekerja dari style guide channel namun tetap punya ruang untuk ciri khas gayamu sendiri.",
    descriptionEn:
      "Draw characters and illustration assets for stickers, thumbnails, and animated segments in our videos. You will work from the channel style guide while keeping room for your own signature style.",
    requirements: [
      "Menguasai Procreate, Clip Studio Paint, atau Illustrator",
      "Punya gaya karakter yang konsisten dan mudah dikenali",
      "Terbiasa mengerjakan revisi cepat dengan brief jelas",
      "Mampu mengirim 8-12 aset ilustrasi per bulan",
    ],
    requirementsEn: [
      "Proficient in Procreate, Clip Studio Paint, or Illustrator",
      "Consistent, recognizable character style",
      "Comfortable with fast revisions and clear briefs",
      "Able to deliver 8-12 illustration assets per month",
    ],
    salaryText: "Rp 150-300 ribu/aset",
    benefits: [
      "Brief lengkap dengan referensi visual dari tim desain",
      "Pembayaran per batch dua mingguan, tepat waktu",
      "Aset kamu dipakai di konten dengan jutaan penonton",
      "Kredit nama pada proyek besar",
    ],
    urgent: true,
    closesInDays: 21,
    requirePortfolio: true,
    requireCv: true,
    screeningQuestions: [
      { id: "q1", label: "Tautkan 5 ilustrasi karakter terbaikmu.", required: true },
      { id: "q2", label: "Tools apa yang kamu pakai untuk menggambar sehari-hari?", required: true },
    ],
    aiCriteria:
      "Utamakan kandidat dengan portofolio karakter orisinal, gaya konsisten, dan mencantumkan tools yang dikuasai. Pengalaman membuat aset untuk konten digital bernilai plus.",
    rubricCriteria: ["Kualitas ilustrasi", "Konsistensi gaya", "Kecepatan eksekusi"],
    checklistTemplate: [
      "Sudah cek 5 ilustrasi terlampir",
      "Sudah cek kesesuaian gaya dengan channel",
    ],
    noteTemplates: ["Hasil review portofolio: ", "Catatan tes aset: "],
    interviewDuration: 30,
    interviewCriteria: ["Keseriusan komitmen", "Kesesuaian gaya", "Kejelasan ekspektasi fee"],
    onboardingDocs: ["Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "WHATSAPP", durationMin: 30 },
      { round: 2, name: "Tes Aset", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 45 },
    ],
  },
  {
    title: "Motion Graphic Designer",
    titleEn: "Motion Graphic Designer",
    department: "Video Editing",
    type: "Kontrak",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Membuat animasi judul, transisi, dan elemen motion yang jadi identitas visual video kami. Kamu akan berkolaborasi dengan editor dan desainer untuk menjaga konsistensi gaya di semua platform.",
    descriptionEn:
      "Create title animations, transitions, and motion elements that define our video identity. You will collaborate with editors and designers to keep a consistent style across platforms.",
    requirements: [
      "Menguasai After Effects dan dasar Premiere Pro",
      "Paham prinsip animasi (timing, easing, anticipation)",
      "Punya showreel motion graphic yang bisa ditunjukkan",
      "Terbiasa bekerja dengan brand kit dan template",
    ],
    requirementsEn: [
      "Proficient in After Effects and basic Premiere Pro",
      "Understands animation principles (timing, easing, anticipation)",
      "Has a motion graphic showreel",
      "Comfortable working with brand kits and templates",
    ],
    salaryText: "Rp 4 - 6 juta/bulan",
    salaryMin: 4000000,
    salaryMax: 6000000,
    benefits: [
      "Lisensi Adobe disediakan perusahaan",
      "Bonus proyek saat konten melewati target performa",
      "Jam fleksibel dengan deadline mingguan",
      "Portofolio motion untuk brand besar",
    ],
    featured: true,
    closesInDays: 30,
    requirePortfolio: true,
    requireCv: true,
    maxApplicants: 15,
    screeningQuestions: [
      { id: "q1", label: "Tautkan showreel motion graphic terbaikmu.", required: true },
      { id: "q2", label: "Berapa lama pengalamanmu dengan After Effects?", required: true },
      { id: "q3", label: "Elemen motion apa yang paling sering kamu buat?", required: false },
    ],
    aiCriteria:
      "Utamakan kandidat dengan showreel motion yang kuat, paham prinsip animasi, dan terbiasa kerja template. Pengalaman untuk channel YouTube bernilai plus.",
    assignment: {
      title: "Tes Motion: Animasi intro 5 detik dari logo terlampir",
      url: "https://drive.google.com/lumina-tes-motion",
      note: "Gunakan After Effects. Kirim file projekt + render MP4. Fokus pada easing dan timing.",
    },
    rubricCriteria: ["Kualitas animasi", "Konsistensi brand", "Ketepatan deadline"],
    checklistTemplate: [
      "Sudah cek showreel",
      "Sudah cek jawaban screening",
      "Sudah review hasil tes motion",
    ],
    noteTemplates: ["Catatan showreel: ", "Hasil tes motion: "],
    interviewDuration: 45,
    interviewCriteria: ["Kedalaman teknis", "Kualitas showreel", "Komunikasi deadline"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "Review Teknis", mode: "ONLINE", platform: "ZOOM", durationMin: 60 },
    ],
  },
  {
    title: "Copywriter Iklan",
    titleEn: "Ad Copywriter",
    department: "Penulisan Konten",
    type: "Part-time",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Menulis copy yang menjual untuk caption, iklan, dan materi promosi kolaborasi brand. Kamu akan menerjemahkan data brief menjadi kalimat pendek yang membuat orang berhenti scroll.",
    descriptionEn:
      "Write selling copy for captions, ads, and brand campaign materials. You will turn briefs into short lines that stop the scroll.",
    requirements: [
      "Pengalaman menulis copy untuk iklan atau promosi",
      "Paham dasar A/B testing headline dan CTA",
      "Gaya bahasa adaptif: bisa formal untuk brand, santai untuk komunitas",
      "Terbiasa dengan deadline harian",
    ],
    requirementsEn: [
      "Experience writing ad or promotional copy",
      "Understands headline and CTA A/B testing basics",
      "Adaptive tone: formal for brands, casual for community",
      "Comfortable with daily deadlines",
    ],
    salaryText: "Rp 2 - 3,5 juta/bulan",
    salaryMin: 2000000,
    salaryMax: 3500000,
    benefits: [
      "Brief terstruktur dengan target audiens yang jelas",
      "Akses data performa iklan untuk belajar iterasi",
      "Jam kerja fleksibel, rapat mingguan singkat",
    ],
    closesInDays: 45,
    requireCv: true,
    requirePortfolio: true,
    screeningQuestions: [
      { id: "q1", label: "Tuliskan 1 copy iklan (maks 30 kata) untuk kopi kekinian.", required: true },
      { id: "q2", label: "Brand atau kampanye apa yang pernah kamu tangani?", required: false },
    ],
    aiCriteria:
      "Utamakan kandidat dengan contoh copy nyata, paham CTA, dan gaya bahasa fleksibel. Pengalaman di industri F&B atau kreator bernilai plus.",
    rubricCriteria: ["Daya jual copy", "Fleksibilitas gaya", "Kecepatan revisi"],
    checklistTemplate: ["Sudah cek contoh copy", "Sudah cek jawaban tes copy"],
    noteTemplates: ["Catatan tes copy: "],
    interviewDuration: 30,
    interviewCriteria: ["Portofolio copy", "Pemahaman audiens", "Komunikasi"],
    onboardingDocs: ["Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
    ],
  },
  {
    title: "Spesialis Riset Tren",
    titleEn: "Trend Research Specialist",
    department: "Perencanaan Konten",
    type: "Part-time",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Memantau tren di YouTube, TikTok, dan Instagram lalu mengubahnya menjadi ide video siap produksi. Risetmu menjadi bahan baku brainstorming mingguan tim kreatif.",
    descriptionEn:
      "Monitor trends across YouTube, TikTok, and Instagram and turn them into production-ready video ideas. Your research fuels the weekly creative brainstorm.",
    requirements: [
      "Jeli terhadap tren konten sebelum jadi mainstream",
      "Terbiasa memakai alat riset tren dan analitik platform",
      "Mampu merangkum riset jadi rekomendasi singkat",
      "Komunikatif dan disiplin laporan mingguan",
    ],
    requirementsEn: [
      "Sharp eye for trends before they go mainstream",
      "Familiar with trend research tools and platform analytics",
      "Able to summarize research into concise recommendations",
      "Communicative and disciplined with weekly reports",
    ],
    salaryText: "Rp 2 - 3 juta/bulan",
    salaryMin: 2000000,
    salaryMax: 3000000,
    benefits: [
      "Langganan alat riset premium disediakan",
      "Ide kamu langsung diproduksi jadi video",
      "Jam fleksibel dengan laporan mingguan",
    ],
    closesInDays: 60,
    requireCv: true,
    maxApplicants: 20,
    screeningQuestions: [
      { id: "q1", label: "Sebutkan 1 tren yang menurutmu akan naik bulan depan dan alasannya.", required: true },
      { id: "q2", label: "Alat riset apa yang biasa kamu pakai?", required: false },
    ],
    aiCriteria:
      "Utamakan kandidat yang paham ekosistem konten Indonesia, jawaban trennya spesifik dan relevan dengan audiens muda.",
    rubricCriteria: ["Ketajaman riset", "Relevansi tren", "Kualitas rekomendasi"],
    checklistTemplate: ["Sudah cek jawaban tren", "Sudah review laporan contoh"],
    noteTemplates: ["Catatan wawancara riset: "],
    interviewDuration: 30,
    interviewCriteria: ["Pemahaman tren", "Struktur berpikir", "Komunikasi"],
    onboardingDocs: ["Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
    ],
  },
  {
    title: "Community Manager",
    titleEn: "Community Manager",
    department: "Komunitas",
    type: "Part-time",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Menjaga komunitas penonton kami tetap sehat dan aktif: moderasi komentar, program loyalitas, dan interaksi rutin di grup eksklusif. Kamu adalah wajah ramah Lumina di antara para superfans.",
    descriptionEn:
      "Keep our viewer community healthy and active: comment moderation, loyalty programs, and regular interaction in exclusive groups. You are the friendly face of Lumina among our superfans.",
    requirements: [
      "Berpengalaman mengelola grup komunitas (Discord/Telegram/WA)",
      "Sabar, empatik, dan tegas saat moderasi",
      "Mampu menyusun program aktivasi komunitas sederhana",
      "Responsif pada jam aktif yang disepakati",
    ],
    requirementsEn: [
      "Experience managing community groups (Discord/Telegram/WA)",
      "Patient, empathetic, and firm when moderating",
      "Able to design simple community activation programs",
      "Responsive during agreed active hours",
    ],
    salaryText: "Rp 2,5 - 4 juta/bulan",
    salaryMin: 2500000,
    salaryMax: 4000000,
    benefits: [
      "Akses penuh ke arsip konten dan merchandise internal",
      "Anggaran kegiatan komunitas bulanan",
      "Jaringan luas dengan kreator dan komunitas lain",
    ],
    urgent: false,
    closesInDays: 30,
    requireCv: true,
    requireIntro: true,
    screeningQuestions: [
      { id: "q1", label: "Komunitas sebesar apa yang pernah kamu kelola dan apa hasilnya?", required: true },
      { id: "q2", label: "Bagaimana caramu menangani member yang melanggar aturan?", required: true },
    ],
    aiCriteria:
      "Utamakan kandidat dengan bukti pengelolaan komunitas nyata, jawaban moderasi yang matang, dan gaya komunikasi hangat.",
    rubricCriteria: ["Pengalaman komunitas", "Kematangan moderasi", "Ide aktivasi"],
    checklistTemplate: ["Sudah cek bukti komunitas", "Sudah cek jawaban moderasi"],
    noteTemplates: ["Catatan wawancara HR: "],
    interviewDuration: 45,
    interviewCriteria: ["Kepribadian", "Pengalahan kasus", "Ketersediaan jam"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "WHATSAPP", durationMin: 30 },
      { round: 2, name: "Simulasi Moderasi", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 45 },
    ],
  },
  {
    title: "Podcast Editor",
    titleEn: "Podcast Editor",
    department: "Produksi Audio",
    type: "Freelance",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Merapikan rekaman podcast mingguan: membuang bagian melebar, menyeimbangkan audio, dan menyusun potongan klip pendek untuk promosi. Kualitas audio adalah standar kami.",
    descriptionEn:
      "Clean up weekly podcast recordings: trim tangents, balance audio, and cut short promo clips. Audio quality is our standard.",
    requirements: [
      "Menguasai Audition, Reaper, atau daw setara",
      "Paham noise reduction, EQ, dan loudness standar streaming",
      "Terbiasa mengekstrak klip pendek dari episode panjang",
      "Mampu menyelesaikan 4-6 episode per bulan",
    ],
    requirementsEn: [
      "Proficient in Audition, Reaper, or equivalent DAW",
      "Understands noise reduction, EQ, and streaming loudness standards",
      "Used to extracting short clips from long episodes",
      "Able to finish 4-6 episodes per month",
    ],
    salaryText: "Rp 300-500 ribu/episode",
    benefits: [
      "Rekaman mentah terorganisir dengan name convention jelas",
      "Pembayaran per episode, tepat waktu",
      "Akses template mixing internal",
    ],
    closesInDays: 45,
    requirePortfolio: true,
    requireCv: true,
    screeningQuestions: [
      { id: "q1", label: "Tautkan 1 episode podcast yang kamu rapikan sebelum-sesudah.", required: true },
      { id: "q2", label: "Target loudness apa yang kamu pakai untuk Spotify/YouTube?", required: false },
    ],
    aiCriteria:
      "Utamakan kandidat dengan contoh sebelum-sesudah audio nyata dan paham standar loudness platform.",
    rubricCriteria: ["Kebersihan audio", "Ritme editing", "Kecepatan pengerjaan"],
    checklistTemplate: ["Sudah cek contoh audio", "Sudah cek tools yang dipakai"],
    noteTemplates: ["Catatan tes audio: "],
    interviewDuration: 30,
    interviewCriteria: ["Standar teknis audio", "Workflow", "Komunikasi"],
    onboardingDocs: ["Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "WHATSAPP", durationMin: 30 },
    ],
  },
  {
    title: "Sound Designer & Mixer",
    titleEn: "Sound Designer & Mixer",
    department: "Produksi Audio",
    type: "Kontrak",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Mendesain efek suara, musik pengiring, dan mixing final untuk video YouTube serta kampanye brand. Kamu memastikan setiap detik terdengar mahal dan menyenangkan didengar.",
    descriptionEn:
      "Design sound effects, background music, and final mixing for YouTube videos and brand campaigns. You make every second sound premium.",
    requirements: [
      "Pengalaman 1+ tahun sound design untuk video",
      "Punya library SFX sendiri atau terbiasa hunting lisensi aman",
      "Menguasai mixing stereo untuk platform video",
      "Terbiasa menerima feedback director dengan cepat",
    ],
    requirementsEn: [
      "1+ year of sound design experience for video",
      "Owns an SFX library or comfortable sourcing licensed sounds",
      "Proficient in stereo mixing for video platforms",
      "Fast turnaround on director feedback",
    ],
    salaryText: "Rp 3,5 - 5,5 juta/bulan",
    salaryMin: 3500000,
    salaryMax: 5500000,
    benefits: [
      "Anggaran pembelian SFX & musik berlisensi",
      "Kredit sound designer di video besar",
      "Jam fleksibel berbasis deliverable",
    ],
    closesInDays: 30,
    requirePortfolio: true,
    requireCv: true,
    maxApplicants: 12,
    screeningQuestions: [
      { id: "q1", label: "Tautkan 1 video dengan sound design buatanmu.", required: true },
      { id: "q2", label: "Bagaimana workflow mixing-mu dari footage mentah sampai final?", required: true },
    ],
    aiCriteria:
      "Utamakan kandidat dengan contoh karya audio nyata untuk video, paham standar loudness YouTube, dan komunikasi cepat.",
    rubricCriteria: ["Kualitas mixing", "Kreativitas SFX", "Kecepatan revisi"],
    checklistTemplate: ["Sudah cek contoh karya", "Sudah review workflow"],
    noteTemplates: ["Catatan karya audio: "],
    interviewDuration: 45,
    interviewCriteria: ["Portofolio audio", "Standar teknis", "Kolaborasi"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "Review Karya", mode: "ONLINE", platform: "ZOOM", durationMin: 45 },
    ],
  },
  {
    title: "Host TikTok Live",
    titleEn: "TikTok Live Host",
    department: "Social Media",
    type: "Part-time",
    location: "Bandung (on-site)",
    workMode: "ONSITE",
    city: "Bandung",
    address: BDO_ADDR,
    mapsUrl: BDO_MAPS,
    workHours: "Shift 4 jam/hari, 5 hari kerja (pagi 09.00-13.00 atau sore 15.00-19.00)",
    shiftSystem: "FIXED",
    facilities: [
      "Parkir motor & mobil",
      "Makan siang pada shift siang",
      "Uang transport",
      "Studio live lengkap dengan ring light & setup kamera",
    ],
    dailySlotQuota: 8,
    description:
      "Menjadi wajah live streaming Lumina di TikTok: interaksi langsung dengan penonton, presentasi produk kolaborasi, dan menjaga energi siaran tetap tinggi selama 4 jam.",
    descriptionEn:
      "Be the live face of Lumina on TikTok: real-time interaction with viewers, presenting collab products, and keeping the energy high for 4-hour streams.",
    requirements: [
      "Percaya diri tampil dan berbicara di depan kamera",
      "Cepat berpikir dan nyambangi menjawab komentar live",
      "Bersedia bekerja dengan sistem shift",
      "Berpengalaman live streaming bernilai plus",
    ],
    requirementsEn: [
      "Confident on camera and speaking live",
      "Quick thinker when responding to live comments",
      "Willing to work in shifts",
      "Live streaming experience is a plus",
    ],
    salaryText: "Rp 3 - 4,5 juta/bulan + bonus gift",
    salaryMin: 3000000,
    salaryMax: 4500000,
    benefits: [
      "Bonus performa dari gift TikTok",
      "Coaching penyiaran rutin dari tim produksi",
      "Fasilitas studio live lengkap",
      "Uang transport & makan saat shift",
    ],
    urgent: true,
    closesInDays: 14,
    requireCv: true,
    requireIntro: true,
    customDocs: ["KTP", "SKCK"],
    maxApplicants: 25,
    aiCriteria:
      "Utamakan kandidat yang komunikatif, tidak gugup di depan kamera, dan bersedia shift. Pengalaman host live atau MC bernilai plus.",
    assignment: {
      title: "Tes On-Camera: Rekam video 60 detik memperkenalkan produk apa saja",
      note: "Kirim video vertikal tanpa edit berlebihan. Kami menilai energi, kejelasan bicara, dan spontanitas.",
    },
    rubricCriteria: ["Energi on-camera", "Spontanitas", "Kesediaan shift"],
    checklistTemplate: [
      "Sudah cek video tes on-camera",
      "Sudah konfirmasi ketersediaan shift",
    ],
    noteTemplates: ["Catatan video tes: ", "Preferensi shift: "],
    interviewMode: "ONSITE",
    interviewDuration: 30,
    interviewCriteria: ["Penampilan kamera", "Komunikasi", "Fleksibilitas jam"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri", "SKCK"],
    reapplyCooldownDays: 30,
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "WHATSAPP", durationMin: 20 },
      { round: 2, name: "On-Camera Trial", mode: "ONSITE", platform: "LAINNYA", durationMin: 60 },
    ],
  },
  {
    title: "Studio Operator (Kameraperson)",
    titleEn: "Studio Operator (Camera)",
    department: "Produksi Video",
    type: "Full-time",
    location: "Jakarta (on-site)",
    workMode: "ONSITE",
    city: "Jakarta",
    address: JKT_ADDR,
    mapsUrl: JKT_MAPS,
    workHours: "Senin-Jumat, 09.00-17.00 WIB (shot list harian dari tim produksi)",
    shiftSystem: "FIXED",
    facilities: [
      "Parkir motor & mobil",
      "Makan siang gratis",
      "Uang transport",
      "Asuransi kesehatan",
    ],
    dailySlotQuota: 6,
    description:
      "Mengoperasikan kamera, lighting dasar, dan setup studio untuk pengambilan gambar video mingguan. Kamu memastikan setiap rekaman siap edit sesuai shot list tim kreatif.",
    descriptionEn:
      "Operate camera, basic lighting, and studio setup for weekly video shoots. You ensure every take is edit-ready according to the creative team's shot list.",
    requirements: [
      "Menguasai kamera mirrorless/DSLR dan dasar lighting",
      "Paham komposisi untuk format video vertikal & horizontal",
      "Rapi dalam mengelola file rekaman dan backup",
      "Bersedia kerja full-time on-site di studio",
    ],
    requirementsEn: [
      "Proficient with mirrorless/DSLR cameras and basic lighting",
      "Understands composition for vertical & horizontal video",
      "Organized with footage management and backups",
      "Willing to work full-time on-site at the studio",
    ],
    salaryText: "Rp 4,5 - 6 juta/bulan",
    salaryMin: 4500000,
    salaryMax: 6000000,
    benefits: [
      "Asuransi kesehatan BPJS +rawat inap",
      "Makan siang & uang transport harian",
      "Peralatan studio kelas produksi",
      "Peluang ikut shoot lokasi luar kota",
    ],
    closesInDays: 21,
    requireCv: true,
    customDocs: ["KTP", "SKCK", "Surat Keterangan Sehat"],
    maxApplicants: 15,
    aiCriteria:
      "Utamakan kandidat dengan pengalaman kamera produksi nyata, memahami workflow file, dan bersedia on-site. Portofolio foto/video bernilai plus.",
    rubricCriteria: ["Teknis kamera", "Kebersihan file", "Kerja sama tim"],
    checklistTemplate: ["Sudah cek portofolio", "Sudah cek dokumen wajib"],
    noteTemplates: ["Catatan wawancara teknis: "],
    interviewMode: "ONSITE",
    interviewDuration: 45,
    interviewCriteria: ["Teknis kamera", "Pengalaman produksi", "Kesiapan on-site"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri", "SKCK", "Surat keterangan sehat"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "Tes Studio", mode: "ONSITE", platform: "LAINNYA", durationMin: 60 },
    ],
  },
  {
    title: "Gaffer & Lighting Crew",
    titleEn: "Gaffer & Lighting Crew",
    department: "Produksi Video",
    type: "Kontrak",
    location: "Surabaya (on-site)",
    workMode: "ONSITE",
    city: "Surabaya",
    address: SBY_ADDR,
    mapsUrl: SBY_MAPS,
    workHours: "Senin-Sabtu (mengikuti jadwal shoot), rata-rata 8 jam/hari",
    shiftSystem: "ROTATING",
    facilities: [
      "Parkir motor & mobil",
      "Makan siang pada hari shoot",
      "Uang transport & lembur",
      "Perlindungan kerja dan asuransi kecelakaan",
    ],
    dailySlotQuota: 6,
    description:
      "Menyiapkan dan mengatur pencahayaan untuk seluruh shoot di studio maupun lokasi. Kamu bekerja dengan kepala produksi untuk mencapai look yang diinginkan direktur kreatif.",
    descriptionEn:
      "Prepare and set up lighting for all studio and location shoots. You work with the production lead to achieve the creative director's desired look.",
    requirements: [
      "Paham teknik three-point lighting dan setup multi-sumber",
      "Terbiasa dengan peralatan studio (softbox, fresnel, LED panel)",
      "Fisik sehat dan mampu kerja di lokasi",
      "Teliti terhadap keselamatan kerja listrik",
    ],
    requirementsEn: [
      "Understands three-point lighting and multi-source setups",
      "Familiar with studio gear (softbox, fresnel, LED panels)",
      "Healthy and ready for on-location work",
      "Careful with electrical safety",
    ],
    salaryText: "Rp 4 - 6 juta/bulan",
    salaryMin: 4000000,
    salaryMax: 6000000,
    benefits: [
      "Uang lembur pada shoot panjang",
      "Asuransi kecelakaan kerja",
      "Pengalaman produksi skala besar",
    ],
    closesInDays: 45,
    requireCv: true,
    customDocs: ["KTP"],
    maxApplicants: 10,
    aiCriteria:
      "Utamakan kandidat dengan pengalaman lighting produksi nyata, jawaban teknis spesifik, dan kesediaan rotasi jadwal shoot.",
    rubricCriteria: ["Teknis lighting", "Keselamatan kerja", "Kerja tim"],
    checklistTemplate: ["Sudah cek pengalaman produksi", "Sudah cek kesiapan rotasi"],
    noteTemplates: ["Catatan wawancara produksi: "],
    interviewMode: "ONSITE",
    interviewDuration: 30,
    interviewCriteria: ["Teknis lighting", "Pengalaman lokasi", "Kesiapan jadwal"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "TELEPON", durationMin: 20 },
      { round: 2, name: "Walkthrough Alat", mode: "ONSITE", platform: "LAINNYA", durationMin: 45 },
    ],
  },
  {
    title: "Digital Marketing Specialist",
    titleEn: "Digital Marketing Specialist",
    department: "Pemasaran",
    type: "Full-time",
    location: "Jakarta (hybrid — 2 hari remote/minggu)",
    workMode: "HYBRID",
    city: "Jakarta",
    address: JKT_ADDR,
    mapsUrl: JKT_MAPS,
    workHours: "Senin-Jumat, 09.00-17.00 WIB (Selasa & Kamis remote)",
    shiftSystem: "NONE",
    facilities: FAC_FULL,
    description:
      "Merancang dan menjalankan kampanye pemasaran digital untuk pertumbuhan channel dan kolaborasi brand: SEO, email, dan kampanye lintas platform. Kamu memakai data untuk memutuskan langkah berikutnya.",
    descriptionEn:
      "Design and run digital marketing campaigns for channel growth and brand collaborations: SEO, email, and cross-platform campaigns. You use data to decide the next move.",
    requirements: [
      "Pengalaman 1+ tahun digital marketing atau growth",
      "Paham dasar SEO, email marketing, dan funnel",
      "Terbiasa membaca analitik dan menyusun laporan",
      "Mampu mengelola beberapa kampanye sekaligus",
    ],
    requirementsEn: [
      "1+ year in digital marketing or growth",
      "Understands SEO basics, email marketing, and funnels",
      "Comfortable reading analytics and writing reports",
      "Able to juggle multiple campaigns",
    ],
    salaryText: "Rp 7 - 10 juta/bulan",
    salaryMin: 7000000,
    salaryMax: 10000000,
    benefits: [
      "Anggaran kampanye bulanan yang kamu kelola",
      "Makan siang gratis & uang transport saat WFO",
      "Sertifikasi industri ditanggung perusahaan",
      "Asuransi kesehatan",
    ],
    featured: false,
    closesInDays: 30,
    requireCv: true,
    maxApplicants: 20,
    screeningQuestions: [
      { id: "q1", label: "Kampanye apa yang paling banggakan dan berapa hasilnya?", required: true },
      { id: "q2", label: "Tools marketing apa yang kamu kuasai?", required: false },
    ],
    aiCriteria:
      "Utamakan kandidat dengan bukti hasil kampanye nyata (angka), paham funnel konten, dan pengalaman di industri kreatif bernilai plus.",
    rubricCriteria: ["Bukti hasil", "Pemahaman funnel", "Kemampuan analitik"],
    checklistTemplate: ["Sudah cek studi kasus kampanye", "Sudah verifikasi angka hasil"],
    noteTemplates: ["Catatan interview HR: ", "Hasil cek studi kasus: "],
    interviewDuration: 60,
    interviewCriteria: ["Strategi", "Bukti angka", "Kultur fit"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri", "NPWP"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "User Interview", mode: "ONLINE", platform: "ZOOM", durationMin: 60 },
      { round: 3, name: "Final Talk", mode: "ONSITE", platform: "LAINNYA", durationMin: 45 },
    ],
  },
  {
    title: "Performance Ads Specialist",
    titleEn: "Performance Ads Specialist",
    department: "Pemasaran",
    type: "Full-time",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Mengelola iklan berbayar (Meta, TikTok Ads, Google) untuk pertumbuhan subscriber dan penjualan merchandise. Kamu punya target ROAS yang jelas dan anggaran untuk eksperimen.",
    descriptionEn:
      "Manage paid ads (Meta, TikTok Ads, Google) to grow subscribers and merchandise sales. You have clear ROAS targets and budget to experiment.",
    requirements: [
      "Pengalaman mengelola iklan berbayar dengan anggaran nyata",
      "Mampu membaca metrik ROAS, CTR, dan CPA lalu mengambil tindakan",
      "Terbiasa membuat laporan performa mingguan",
      "Detail-oriented pada tracking dan pixel",
    ],
    requirementsEn: [
      "Experience managing paid ads with real budgets",
      "Able to read ROAS, CTR, and CPA metrics and act on them",
      "Used to writing weekly performance reports",
      "Detail-oriented with tracking and pixels",
    ],
    salaryText: "Rp 6 - 9 juta/bulan",
    salaryMin: 6000000,
    salaryMax: 9000000,
    benefits: [
      "Full remote dengan jam fleksibel",
      "Anggaran spend bulanan signifikan",
      "Bonus pencapaian target ROAS",
      "Kursus sertifikasi platform iklan ditanggung",
    ],
    closesInDays: 60,
    requireCv: true,
    maxApplicants: 12,
    aiCriteria:
      "Utamakan kandidat dengan angka hasil iklan konkret (ROAS/spend), jawaban metrik akurat, dan pengalaman e-commerce atau kreator.",
    rubricCriteria: ["Bukti ROAS", "Kedalaman metrik", "Struktur laporan"],
    checklistTemplate: ["Sudah cek angka ROAS", "Sudah cek dashboard contoh"],
    noteTemplates: ["Catatan interview ads: "],
    interviewDuration: 45,
    interviewCriteria: ["Kemampuan metrik", "Studi kasus", "Komunikasi"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri", "NPWP"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "Case Review", mode: "ONLINE", platform: "ZOOM", durationMin: 60 },
    ],
  },
  {
    title: "Web Developer (Next.js)",
    titleEn: "Web Developer (Next.js)",
    department: "Teknologi",
    type: "Kontrak",
    location: "Remote",
    workMode: "REMOTE",
    description:
      "Membangun dan merawat situs rekrutmen serta landing page kampanye kami berbasis Next.js. Kamu akan bekerja langsung dengan pendiri untuk fitur cepat namun tetap rapi.",
    descriptionEn:
      "Build and maintain our recruitment site and campaign landing pages on Next.js. You will work directly with the founders shipping fast but keeping things clean.",
    requirements: [
      "Menguasai TypeScript, React, dan Next.js App Router",
      "Paham Tailwind CSS dan komponen shadcn/ui",
      "Terbiasa dengan Prisma + SQLite/PostgreSQL",
      "Mampu bekerja async dengan dokumentasi rapi",
    ],
    requirementsEn: [
      "Proficient in TypeScript, React, and Next.js App Router",
      "Understands Tailwind CSS and shadcn/ui components",
      "Comfortable with Prisma + SQLite/PostgreSQL",
      "Able to work async with clean documentation",
    ],
    salaryText: "Rp 8 - 12 juta/bulan",
    salaryMin: 8000000,
    salaryMax: 12000000,
    benefits: [
      "100% remote, rapat wajib minimal",
      "Peralatan kerja digital disediakan",
      "Kode review yang sehat untuk pertumbuhan skill",
      "Bonus peluncuran fitur besar",
    ],
    featured: true,
    closesInDays: 30,
    requireCv: true,
    requirePortfolio: true,
    maxApplicants: 10,
    screeningQuestions: [
      { id: "q1", label: "Tautkan 1 proyek Next.js yang pernah kamu bangun dan peranmu di dalamnya.", required: true },
      { id: "q2", label: "Berapa jam per minggu yang bisa kamu dedikasikan?", required: true },
    ],
    aiCriteria:
      "Utamakan kandidat dengan repo/proyek Next.js nyata, jawaban teknis spesifik, dan komunikasi tertulis yang jelas.",
    assignment: {
      title: "Tes Kode: Perbaiki 3 bug di mini-app terlampir",
      url: "https://github.com/lumina/tes-frontend",
      note: "Fork repo, perbaiki bug, dan jelaskan alasan di commit message. Waktu pengerjaan bebas dalam 3 hari.",
    },
    rubricCriteria: ["Kualitas kode", "Ketepatan solusi", "Kejelasan komunikasi"],
    checklistTemplate: ["Sudah cek repo tes", "Sudah review commit message"],
    noteTemplates: ["Catatan tes kode: "],
    interviewDuration: 60,
    interviewCriteria: ["Kedalaman teknis", "Pengalaman proyek", "Kolaborasi async"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri", "NPWP"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "Technical Interview", mode: "ONLINE", platform: "ZOOM", durationMin: 60 },
    ],
  },
  {
    title: "Data & Analytics Associate",
    titleEn: "Data & Analytics Associate",
    department: "Data & Analitik",
    type: "Full-time",
    location: "Bandung (hybrid — 2 hari remote/minggu)",
    workMode: "HYBRID",
    city: "Bandung",
    address: BDO_ADDR,
    mapsUrl: BDO_MAPS,
    workHours: "Senin-Jumat, 09.00-17.00 WIB (Rabu & Jumat remote)",
    shiftSystem: "NONE",
    facilities: [
      "Parkir motor & mobil",
      "Makan siang gratis",
      "Uang transport",
      "Asuransi kesehatan",
    ],
    description:
      "Mengumpulkan dan menganalisis data performa konten dari semua platform, lalu menyajikannya jadi dashboard dan rekomendasi yang mudah dibaca tim kreatif.",
    descriptionEn:
      "Collect and analyze content performance data across platforms, then turn it into dashboards and clear recommendations for the creative team.",
    requirements: [
      "Menguasai spreadsheet tingkat lanjut dan dasar SQL",
      "Terbiasa dengan analitik YouTube/TikTok/Instagram",
      "Mampu membuat visualisasi data yang bersih",
      "Teliti dan jujur terhadap angka",
    ],
    requirementsEn: [
      "Advanced spreadsheet skills and basic SQL",
      "Familiar with YouTube/TikTok/Instagram analytics",
      "Able to build clean data visualizations",
      "Meticulous and honest with numbers",
    ],
    salaryText: "Rp 5 - 8 juta/bulan",
    salaryMin: 5000000,
    salaryMax: 8000000,
    benefits: [
      "Makan siang gratis & uang transport saat WFO",
      "Akses tools analytics premium",
      "Asuransi kesehatan",
      "Mentoring langsung dari pendiri",
    ],
    closesInDays: 45,
    requireCv: true,
    maxApplicants: 12,
    screeningQuestions: [
      { id: "q1", label: "Metrik apa yang paling penting untuk pertumbuhan channel YouTube menurutmu? Jelaskan.", required: true },
      { id: "q2", label: "Tools analisis apa yang paling sering kamu pakai?", required: false },
    ],
    aiCriteria:
      "Utamakan kandidat yang jawabannya logis dan berbasis data, paham metrik platform, dan komunikasi insight sederhana.",
    rubricCriteria: ["Kemampuan analitik", "Kualitas visualisasi", "Komunikasi insight"],
    checklistTemplate: ["Sudah cek jawaban metrik", "Sudah review contoh dashboard"],
    noteTemplates: ["Catatan interview analitik: "],
    interviewDuration: 45,
    interviewCriteria: ["Logika data", "Pemahaman platform", "Komunikasi"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri", "NPWP"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "Analitik Case", mode: "ONLINE", platform: "ZOOM", durationMin: 60 },
    ],
  },
  {
    title: "Talent & People Coordinator",
    titleEn: "Talent & People Coordinator",
    department: "Talent Management",
    type: "Full-time",
    location: "Yogyakarta (hybrid — 3 hari remote/minggu)",
    workMode: "HYBRID",
    city: "Yogyakarta",
    address: "Lumina Loft Yogyakarta, Jl. Prawirotaman No. 21, Mergangsan, Kota Yogyakarta",
    mapsUrl: "https://maps.google.com/?q=Jl.+Prawirotaman+No.+21,+Yogyakarta",
    workHours: "Senin-Jumat, 09.00-17.00 WIB (Senin, Rabu, Jumat remote)",
    shiftSystem: "NONE",
    facilities: [
      "Parkir motor & mobil",
      "Makan siang gratis",
      "Uang transport",
      "Asuransi kesehatan",
    ],
    description:
      "Mendukung operasional rekrutmen dan kesejahteraan tim: menjadwalkan wawancara, mengelola onboarding, dan menjaga suasana kerja tetap sehat untuk talenta kreatif kami.",
    descriptionEn:
      "Support recruitment operations and team wellbeing: schedule interviews, manage onboarding, and keep the workplace healthy for our creative talent.",
    requirements: [
      "Kemampuan organisasi dan menjadwalkan yang rapi",
      "Komunikatif dan hangat saat berhubungan dengan kandidat",
      "Terbiasa dengan spreadsheet dan alat produktivitas",
      "Menjaga kerahasiaan data kandidat",
    ],
    requirementsEn: [
      "Well-organized scheduling skills",
      "Warm, communicative with candidates",
      "Comfortable with spreadsheets and productivity tools",
      "Keeps candidate data confidential",
    ],
    salaryText: "Rp 5 - 7 juta/bulan",
    salaryMin: 5000000,
    salaryMax: 7000000,
    benefits: [
      "Makan siang gratis & uang transport saat WFO",
      "Asuransi kesehatan",
      "Jam kerja hybrid yang stabil",
      "Pelatihan HR dan people operations",
    ],
    closesInDays: 55,
    requireCv: true,
    requireIntro: true,
    maxApplicants: 15,
    screeningQuestions: [
      { id: "q1", label: "Pengalaman apa yang membuatmu cocok menangani urusan orang?", required: true },
      { id: "q2", label: "Bagaimana caramu memprioritaskan 5 jadwal wawancara yang bertabrakan?", required: true },
    ],
    aiCriteria:
      "Utamakan kandidat yang terorganisir, empatik, jawaban prioritasnya sistematis. Pengalaman HR atau admin bernilai plus.",
    rubricCriteria: ["Keterorganisasian", "Kemampuan komunikasi", "Empati"],
    checklistTemplate: ["Sudah cek jawaban screening", "Sudah cek kesiapan hybrid"],
    noteTemplates: ["Catatan interview HR: "],
    interviewDuration: 45,
    interviewCriteria: ["Organisasi", "Komunikasi", "Kultur fit"],
    onboardingDocs: ["KTP aktif", "Rekening bank atas nama sendiri", "NPWP"],
    roundPlan: [
      { round: 1, name: "HR Screen", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 30 },
      { round: 2, name: "User Interview", mode: "ONLINE", platform: "GOOGLE_MEET", durationMin: 45 },
    ],
  },
];

async function main() {
  let created = 0;
  let skipped = 0;
  for (const seed of SEEDS) {
    const existing = await db.position.findFirst({ where: { title: seed.title } });
    if (existing) {
      skipped++;
      continue;
    }
    const slug = await uniqueSlug(seed.title);
    await db.position.create({
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
        order: 5 + SEEDS.indexOf(seed) + 1,
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
        applyTemplate: applyTpl,
        acceptTemplate: acceptTpl,
        rejectTemplate: rejectTpl,
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
    console.log(`+ ${seed.title} (${seed.workMode}, ${seed.type}, slug: ${slug})`);
  }
  const total = await db.position.count();
  console.log(`\nSelesai: ${created} dibuat, ${skipped} dilewati, total posisi aktif di DB: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
