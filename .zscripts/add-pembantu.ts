/**
 * NR-21 — Buat 2 lowongan sekaligus (semua 12 ide per lowongan):
 *   1. "Pembantu Operasional Studio" (featured + urgent)
 *   2. "Pembantu Rumah Tangga" (live-in)
 * Idempoten: bila slug sudah ada tanpa lamaran, hapus lalu buat ulang.
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const STUDIO_ADDR = "Jl. Studio Raya No. 88, Cipete, Jakarta Selatan";
const STUDIO_MAPS = "https://www.google.com/maps/search/?api=1&query=Jl.+Studio+Raya+No.+88+Cipete+Jakarta+Selatan";

// Pipeline kustom bersama (posisi fisik: pakai tahap trial kerja)
const TRIAL_STAGES = JSON.stringify(["Screening Berkas", "Wawancara", "Coba Kerja 1 Hari", "Tes Kesehatan", "Offer"]);
const TRIAL_CATEGORIES = JSON.stringify({
  "Screening Berkas": "REVIEW",
  Wawancara: "INTERVIEW",
  "Coba Kerja 1 Hari": "INTERVIEW",
  "Tes Kesehatan": "INTERVIEW",
  Offer: "ACCEPTED",
});

const posOperasional = {
  title: "Pembantu Operasional Studio",
  titleEn: "Studio Operations Helper",
  slug: "pembantu-operasional-studio",
  department: "Operasional",
  type: "Full-time",
  location: "Jakarta (On-site)",
  workMode: "ONSITE",
  city: "Jakarta",
  address: STUDIO_ADDR,
  mapsUrl: STUDIO_MAPS,
  workHours: "Senin-Sabtu, 08.00-17.00 WIB",
  shiftSystem: "FIXED",
  description: [
    "Bergabunglah dengan tim operasional Lumina Studio sebagai Pembantu Operasional. Kamu adalah tangan kanan tim produksi: membantu menyiapkan peralatan syuting, memuat-muat barang ke armada, merapikan gudang props, dan memastikan hari kerja tim berjalan mulus.",
    "Posisi ini cocok untuk kamu yang kuat fisik, rajin, dan suka melihat hasil kerja nyata setiap hari. Tidak wajib berpengalaman — kami lebih menilai sikap: disiplin, jujur, mau belajar, dan tidak takut bersih-bersih.",
    "Tugas utama: bantu muat-naik & angkut peralatan produksi, siapkan lokasi syuting, packing & menyiapkan kiriman, menjaga kerapian studio dan gudang, mendampingi Supir Armada saat dinas, serta membantu kebutuhan harian tim.",
  ].join("\n\n"),
  descriptionEn: [
    "Join the Lumina Studio operations team as a Studio Operations Helper. You are the production team's right hand: preparing shooting equipment, loading gear into the fleet, organizing the props warehouse, and making sure the team's day runs smoothly.",
    "This role suits someone physically strong, diligent, and who enjoys seeing tangible results every day. Experience is not required — we value attitude: discipline, honesty, willingness to learn, and no fear of cleaning up.",
    "Main duties: load/unload and carry production equipment, prepare shooting locations, pack and prepare deliveries, keep the studio and warehouse tidy, assist the Fleet Driver during trips, and support the team's daily needs.",
  ].join("\n\n"),
  requirements: JSON.stringify([
    "Min. lulus SMA/SMK sederhana (ijazah bukan syarat mutlak — sikap utama)",
    "Sehat jasmani dan mampu mengangkat beban hingga ±20 kg",
    "Jujur, rajin, tepat waktu, dan mau belajar",
    "Domisili Jabodetabek (dekat kantor lebih disukai)",
    "Bersedia bekerja hari Sabtu dan lembur/dinas sesuai kebutuhan",
    "Punya kendaraan sendiri (motor) + SIM C menjadi nilai plus",
    "Pengalaman kerja fisik (gudang/pabrik/event) menjadi nilai plus",
  ]),
  requirementsEn: JSON.stringify([
    "Minimum high school education (diploma not absolute — attitude comes first)",
    "Physically healthy and able to lift loads up to ±20 kg",
    "Honest, diligent, punctual, and eager to learn",
    "Living in Jabodetabek (closer to the office preferred)",
    "Willing to work Saturdays and overtime/trips as needed",
    "Having your own motorcycle + SIM C license is a plus",
    "Physical work experience (warehouse/factory/events) is a plus",
  ]),
  facilities: JSON.stringify([
    "Seragam kerja",
    "Makan siang & uang makan lembur",
    "BPJS Kesehatan & Ketenagakerjaan",
    "Uang transport",
    "Bonus kehadiran penuh",
  ]),
  salaryText: "Rp 2,8 - 3,5 juta/bulan + uang makan",
  salaryVisible: true,
  salaryMin: 2800000,
  salaryMax: 3500000,
  urgent: true,
  featured: true,
  order: 1,
  isActive: true,
  applyOpen: true,
  requireCv: false,
  requireIntro: false,
  requirePortfolio: false,

  // Ide 6 — pertanyaan screening khusus pembantu operasional
  screeningQuestions: JSON.stringify([
    { id: "sq-fisik", label: "Apakah Anda sehat dan sanggup melakukan pekerjaan fisik, termasuk mengangkat beban ±20 kg?", required: true },
    { id: "sq-pengalaman", label: "Pengalaman kerja fisik apa yang pernah Anda lakukan? (gudang, pabrik, event, dll.)", required: true },
    { id: "sq-kendaraan", label: "Apakah Anda punya kendaraan sendiri (motor) dan SIM C?", required: true },
    { id: "sq-lembur", label: "Apakah Anda bersedia lembur atau dinas pada hari Sabtu bila dibutuhkan?", required: true },
    { id: "sq-domisili", label: "Di mana domisili Anda sekarang? Berapa lama perjalanan ke Cipete, Jakarta Selatan?", required: true },
  ]),

  // Ide 7 — dokumen wajib tambahan (lebih ringan dari Supir)
  customDocs: JSON.stringify([
    "Foto KTP",
    "Surat Keterangan Sehat dari dokter / puskesmas",
  ]),

  // Ide 8 — pipeline kustom dengan tahap trial kerja
  stages: TRIAL_STAGES,
  stageCategories: TRIAL_CATEGORIES,
  stageNotes: JSON.stringify({
    "Screening Berkas":
      "Tim kami memeriksa kelengkapan berkas: KTP dan surat keterangan sehat. Proses ini biasanya 1-3 hari kerja.",
    Wawancara:
      "Percakapan santai di studio mengenai kesiapan kerja fisik, jadwal, dan ekspektasi. Bawa KTP aslimu untuk diverifikasi.",
    "Coba Kerja 1 Hari":
      "Kamu diundang mencoba bekerja satu hari penuh di studio (dibayar harian). Kami menilai sikap kerja, kerapian, dan kerja sama tim secara nyata.",
    "Tes Kesehatan":
      "Pemeriksaan kesehatan ringkas untuk memastikan kamu siap bekerja. Biaya pemeriksaan ditanggung studio.",
    Offer:
      "Selamat! Kamu menerima penawaran kerja. Cek halaman status ini untuk melihat detail penawaran dan konfirmasi tanggal mulai.",
  }),

  // Ide 9 — rubric & checklist
  rubricCriteria: JSON.stringify([
    "Kerja keras & inisiatif",
    "Kerapian hasil kerja",
    "Sikap & sopan santun",
    "Ketepatan waktu",
    "Mengikuti instruksi dengan baik",
  ]),
  checklistTemplate: JSON.stringify([
    "KTP diverifikasi",
    "Surat keterangan sehat diterima",
    "Coba kerja 1 hari selesai",
    "Referensi dicek",
    "Kesediaan jadwal dikonfirmasi",
  ]),

  // Ide 11 — AI criteria + auto-shortlist
  aiCriteria: [
    "Prioritaskan pelamar yang:",
    "(1) berdomisili di Jabodetabek;",
    "(2) secara eksplisit menyatakan sehat dan sanggup kerja fisik;",
    "(3) punya pengalaman kerja fisik atau pekerjaan lapangan;",
    "(4) bersedia kerja Sabtu dan lembur.",
    "Tandai negatif bila pelamar menyatakan tidak sanggup mengangkat beban, tidak bersedia kerja Sabtu, atau jawaban tidak jelas pada pertanyaan fisik.",
  ].join(" "),
  autoShortlistScore: 75,
  autoShortlistStage: "Wawancara",

  dailySlotQuota: 4,
  interviewMode: "ONSITE",
  interviewDuration: 45,
  interviewCriteria: JSON.stringify([
    "Kesiapan kerja fisik",
    "Sikap & keramahan",
    "Kedisiplinan & ketepatan waktu",
    "Kemampuan mengikuti instruksi",
  ]),
  roundPlan: JSON.stringify([
    { round: 1, name: "Wawancara & Coba Kerja", mode: "ONSITE", durationMin: 90 },
  ]),

  // Ide 12 — template pesan
  applyTemplate:
    "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman ini. Tim kami memeriksa kelengkapan berkas 1-3 hari kerja.",
  interviewInviteTemplate:
    "Hai {nama}, kamu diundang wawancara & coba kerja untuk posisi {posisi} pada {tanggal} pukul {jam} di studio. Bawa sepatu nyaman dan baju yang rapi ya — lokasi lengkap ada di halaman status lamaranmu!",
  offerTemplate:
    "Selamat {nama}! Kami menawarkanmu posisi {posisi} dengan kompensasi {gaji}, rencana mulai bekerja {tanggal}. Mohon konfirmasi sebelum {deadline} melalui halaman status lamaranmu.",
  welcomeTemplate:
    "Selamat bergabung di Lumina Studio, {nama}! Kamu resmi menjadi bagian dari tim {posisi}. Detail hari pertama ada di halaman status lamaranmu.",

  probationMonths: 3,
  onboardingDocs: JSON.stringify(["Fotokopi KTP", "NPWP (bila ada)", "Buku rekening", "Foto 3x4"]),
};

const posPrt = {
  title: "Pembantu Rumah Tangga",
  titleEn: "Domestic Helper (Live-in)",
  slug: "pembantu-rumah-tangga",
  department: "Rumah Tangga",
  type: "Full-time",
  location: "Jakarta Selatan (Live-in)",
  workMode: "ONSITE",
  city: "Jakarta Selatan",
  address: "Residensi keluarga di Cipete, Jakarta Selatan — pertemuan awal di Studio Lumina (Jl. Studio Raya No. 88); alamat lengkap dibagikan saat penjadwalan wawancara.",
  mapsUrl: STUDIO_MAPS,
  workHours: "Senin-Sabtu, 06.30-16.30 WIB · libur Ahad",
  shiftSystem: "FIXED",
  description: [
    "Keluarga pemilik Lumina Studio mencari Pembantu Rumah Tangga (live-in) untuk membantu menjaga rumah tetap bersih, rapi, dan nyaman. Kamu akan menjadi bagian dari rumah tangga yang menghargai pekerjaan rumah dan memperlakukan pembantu dengan hormat.",
    "Tugas utama: membersihkan dan merapikan rumah, mencuci & setrika pakaian, membantu menyiapkan masakan sederhana, belanja kebutuhan harian, serta membantu menyambut tamu. Tidak ada perawatan anak atau lansia.",
    "Kami mencari orang yang jujur, sabar, rapi, dan menjaga privasi keluarga. Pengalaman merawat rumah sangat membantu, namun yang terpenting adalah sikap dan kepercayaan.",
  ].join("\n\n"),
  descriptionEn: [
    "The family behind Lumina Studio is looking for a live-in Domestic Helper to keep the house clean, tidy, and comfortable. You will be part of a household that values housework and treats helpers with respect.",
    "Main duties: cleaning and tidying the house, washing & ironing clothes, helping prepare simple meals, daily grocery shopping, and helping welcome guests. No childcare or elderly care involved.",
    "We are looking for someone honest, patient, tidy, and respectful of family privacy. Housekeeping experience helps a lot, but attitude and trustworthiness matter most.",
  ].join("\n\n"),
  requirements: JSON.stringify([
    "Sehat jasmani dan bersedia melakukan pekerjaan rumah setiap hari",
    "Jujur, sabar, rapi, dan menjaga kerahasiaan & privasi keluarga",
    "Bisa masak menu harian sederhana (diutamakan, bisa diajarkan)",
    "Bersedia tinggal di tempat (live-in) di Jakarta Selatan",
    "Usia ideal 20-40 tahun (pengalaman kerja lebih diutamakan)",
    "Tidak merokok",
    "Punya referensi kerja sebelumnya menjadi nilai plus",
  ]),
  requirementsEn: JSON.stringify([
    "Physically healthy and willing to do daily housework",
    "Honest, patient, tidy, and respectful of family privacy",
    "Able to cook simple daily meals (preferred, can be taught)",
    "Willing to live in (live-in) in South Jakarta",
    "Ideal age 20-40 (work experience preferred)",
    "Non-smoker",
    "References from previous employers are a plus",
  ]),
  facilities: JSON.stringify([
    "Kamar & makan harian ditanggung (live-in)",
    "BPJS Kesehatan & Ketenagakerjaan",
    "Libur 1 hari per minggu",
    "Tiket pulang kampung 1x per tahun",
    "Seragam & perlengkapan mandi",
  ]),
  salaryText: "Rp 2,2 - 3 juta/bulan (live-in, kamar & makan ditanggung)",
  salaryVisible: true,
  salaryMin: 2200000,
  salaryMax: 3000000,
  urgent: false,
  featured: false,
  order: 6,
  isActive: true,
  applyOpen: true,
  requireCv: false,
  requireIntro: false,
  requirePortfolio: false,

  // Pertanyaan screening khusus PRT
  screeningQuestions: JSON.stringify([
    { id: "sq-livein", label: "Apakah Anda bersedia tinggal di tempat (live-in) di Jakarta Selatan?", required: true },
    { id: "sq-pengalaman", label: "Berapa lama pengalaman Anda merawat rumah? Sebutkan jenis pekerjaan yang biasa Anda lakukan.", required: true },
    { id: "sq-masak", label: "Apakah Anda bisa masak menu harian sederhana? Sebutkan 2 contoh menu.", required: true },
    { id: "sq-rokok", label: "Apakah Anda merokok?", required: true },
    { id: "sq-referensi", label: "Apakah ada referensi dari majikan sebelumnya? Jelaskan singkat.", required: true },
  ]),

  // Dokumen wajib PRT
  customDocs: JSON.stringify([
    "Foto KTP",
    "Surat Keterangan Sehat dari dokter / puskesmas",
    "Foto terbaru",
  ]),

  stages: TRIAL_STAGES,
  stageCategories: TRIAL_CATEGORIES,
  stageNotes: JSON.stringify({
    "Screening Berkas":
      "Keluarga kami memeriksa kelengkapan berkas: KTP, surat keterangan sehat, dan foto. Proses ini biasanya 1-3 hari kerja.",
    Wawancara:
      "Pertemuan santai (boleh didampingi keluarga) membahas pekerjaan rumah, jadwal, dan kesepakatan bersama. Alamat lengkap dibagikan saat penjadwalan.",
    "Coba Kerja 1 Hari":
      "Kamu diundang mencoba bekerja satu hari di rumah (dibayar harian) agar kedua pihak bisa saling mengenal kebiasaan dan cara kerja masing-masing.",
    "Tes Kesehatan":
      "Pemeriksaan kesehatan ringkas untuk memastikan kamu siap bekerja. Biaya pemeriksaan ditanggung keluarga.",
    Offer:
      "Selamat! Kamu menerima penawaran kerja. Cek halaman status ini untuk melihat detail penawaran (gaji, jadwal, fasilitas) dan konfirmasi tanggal mulai.",
  }),

  rubricCriteria: JSON.stringify([
    "Kerapian & kebersihan hasil",
    "Kecepatan & inisiatif",
    "Sikap & sopan santun",
    "Kejujuran & keterpercayaan",
    "Kebersihan diri",
  ]),
  checklistTemplate: JSON.stringify([
    "KTP diverifikasi",
    "Surat keterangan sehat diterima",
    "Coba kerja 1 hari selesai",
    "Referensi dicek",
    "Kesepakatan jam kerja dipahami",
  ]),

  aiCriteria: [
    "Prioritaskan pelamar yang:",
    "(1) secara eksplisit bersedia live-in di Jakarta Selatan;",
    "(2) punya pengalaman merawat rumah minimal 1 tahun;",
    "(3) bisa masak menu sederhana;",
    "(4) punya referensi majikan sebelumnya.",
    "Tandai negatif bila pelamar tidak bersedia live-in tanpa alternatif jelas, atau jawaban mengindikasikan masalah kejujuran.",
  ].join(" "),
  autoShortlistScore: 70,
  autoShortlistStage: "Wawancara",

  dailySlotQuota: 3,
  interviewMode: "ONSITE",
  interviewDuration: 45,
  interviewCriteria: JSON.stringify([
    "Sikap & keramahan",
    "Pengalaman pekerjaan rumah",
    "Kejujuran & keterbukaan",
    "Kesepahaman jadwal & aturan rumah",
  ]),
  roundPlan: JSON.stringify([
    { round: 1, name: "Wawancara Keluarga", mode: "ONSITE", durationMin: 60 },
  ]),

  applyTemplate:
    "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman ini. Keluarga kami memeriksa kelengkapan berkas 1-3 hari kerja.",
  interviewInviteTemplate:
    "Hai {nama}, kamu diundang wawancara untuk posisi {posisi} pada {tanggal} pukul {jam}. Alamat lengkap dibagikan via WhatsApp setelah jadwal dikonfirmasi. Boleh didampingi keluarga ya!",
  offerTemplate:
    "Selamat {nama}! Keluarga kami menawarkanmu posisi {posisi} dengan kompensasi {gaji}, rencana mulai bekerja {tanggal}. Mohon konfirmasi sebelum {deadline} melalui halaman status lamaranmu.",
  welcomeTemplate:
    "Selamat bergabung dengan keluarga kami, {nama}! Kamu resmi menjadi bagian dari rumah tangga kami sebagai {posisi}. Detail hari pertama ada di halaman status lamaranmu.",

  probationMonths: 2,
  onboardingDocs: JSON.stringify(["Fotokopi KTP", "Buku rekening", "Foto 3x4"]),
};

async function upsert(data: Record<string, unknown>) {
  const slug = data.slug as string;
  const existing = await db.position.findUnique({ where: { slug } });
  if (existing) {
    const apps = await db.application.count({ where: { positionId: existing.id } });
    if (apps > 0) {
      console.log(`SKIP: "${slug}" sudah ada dengan ${apps} lamaran — tidak diubah.`);
      return existing.id;
    }
    await db.position.delete({ where: { id: existing.id } });
    console.log(`Posisi lama tanpa lamaran dihapus: ${slug}`);
  }
  const pos = await db.position.create({ data: data as never });
  console.log("OK dibuat:", pos.id, "|", pos.title);
  return pos.id;
}

async function main() {
  await upsert(posOperasional);
  await upsert(posPrt);
  const total = await db.position.count({ where: { deletedAt: null } });
  console.log("Total posisi aktif:", total);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("GAGAL:", e);
  await db.$disconnect();
  process.exit(1);
});
