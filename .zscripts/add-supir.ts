/**
 * NR-20 — Buat lowongan "Supir Armada Operasional" (semua 12 ide).
 * Idempoten: bila slug sudah ada, hapus dulu lalu buat ulang (kecuali ada lamaran).
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const data = {
  title: "Supir Armada Operasional",
  titleEn: "Operations Fleet Driver",
  slug: "supir-armada-operasional",
  department: "Operasional",
  type: "Full-time",
  location: "Jakarta (On-site)",
  workMode: "ONSITE",
  city: "Jakarta",
  address: "Jl. Studio Raya No. 88, Cipete, Jakarta Selatan",
  mapsUrl: "https://www.google.com/maps/search/?api=1&query=Jl.+Studio+Raya+No.+88+Cipete+Jakarta+Selatan",
  workHours: "Senin-Sabtu, 07.00-16.00 WIB",
  shiftSystem: "FIXED",
  description: [
    "Bergabunglah dengan tim operasional Lumina Studio sebagai Supir Armada. Kamu adalah tulang punggung mobilitas studio: mengantar-jemput tim produksi ke lokasi syuting, mengantar peralatan dan paket ke klien, serta menjaga armada tetap prima setiap hari.",
    "Kami mencari pribadi yang disiplin, sabar, dan mengutamakan keselamatan. Pengalaman menembus macet Jakarta dan hafal rute Jabodetabek adalah nilai plus besar. Kamu akan mengendarai mobil studio (manual/matic) dan berkoordinasi erat dengan tim operasional lewat grup WhatsApp.",
    "Tugas utama: antar-jemput tim & peralatan produksi, pengiriman paket/aset ke klien, perawatan harian kendaraan, catat KM & konsumsi BBM, serta jaga kebersihan mobil.",
  ].join("\n\n"),
  descriptionEn: [
    "Join the Lumina Studio operations team as a Fleet Driver. You are the backbone of studio mobility: picking up and dropping off the production team at shooting locations, delivering equipment and packages to clients, and keeping the fleet in top shape every day.",
    "We are looking for a disciplined, patient, and safety-first person. Experience navigating Jakarta traffic and familiarity with Jabodetabek routes are big pluses. You will drive the studio car (manual/automatic) and coordinate closely with the operations team via a WhatsApp group.",
    "Main duties: pick up/drop off the team & production equipment, deliver packages/assets to clients, daily vehicle maintenance, log KM & fuel consumption, and keep the car clean.",
  ].join("\n\n"),
  requirements: JSON.stringify([
    "Memiliki SIM B2 Umum yang masih aktif",
    "Pengalaman sebagai supir minimal 2 tahun, hafal rute Jabodetabek",
    "Bisa mengendarai mobil manual dan matic",
    "Sehat jasmani dan tidak memiliki riwayat penyakit yang mengganggu konsentrasi",
    "Tidak punya riwayat pelanggaran lalu lintas berat / kecelakaan akibat kelalaian 2 tahun terakhir",
    "Disiplin, jujur, tepat waktu, dan mengutamakan keselamatan berkendara",
    "Bersedia bekerja hari Sabtu dan dinas luar kota sesuai jadwal",
  ]),
  requirementsEn: JSON.stringify([
    "Hold an active SIM B2 Umum (public driver's license)",
    "Minimum 2 years of driving experience, familiar with Jabodetabek routes",
    "Able to drive both manual and automatic cars",
    "Physically healthy with no conditions that impair concentration",
    "No major traffic violations or at-fault accidents in the last 2 years",
    "Disciplined, honest, punctual, and safety-first",
    "Willing to work Saturdays and out-of-town trips as scheduled",
  ]),
  facilities: JSON.stringify([
    "Seragam kerja",
    "BBM & e-toll",
    "BPJS Kesehatan & Ketenagakerjaan",
    "Uang makan lembur",
    "Bonus safety driving",
  ]),
  salaryText: "Rp 3,5 - 4,5 juta/bulan + lembur",
  salaryVisible: true,
  salaryMin: 3500000,
  salaryMax: 4500000,
  urgent: true,
  featured: true,
  order: 0,
  isActive: true,
  applyOpen: true,

  // Ide 6 — pertanyaan screening khusus supir
  screeningQuestions: JSON.stringify([
    { id: "sq-sim", label: "Apakah Anda memiliki SIM B2 Umum yang masih aktif? Sebutkan tahun masa berlakunya.", required: true },
    { id: "sq-pengalaman", label: "Berapa tahun pengalaman Anda bekerja sebagai supir?", required: true },
    { id: "sq-transmisi", label: "Apakah Anda bisa mengendarai mobil manual dan matic?", required: true },
    { id: "sq-luarkota", label: "Apakah Anda bersedia dinas luar kota beberapa hari per bulan?", required: true },
    { id: "sq-kecelakaan", label: "Dalam 2 tahun terakhir, apakah Anda pernah mengalami kecelakaan atau pelanggaran lalu lintas berat? Jelaskan singkat.", required: true },
  ]),

  // Ide 7 — dokumen wajib tambahan
  customDocs: JSON.stringify([
    "Foto SIM B2 (masih aktif)",
    "SKCK (Surat Keterangan Catatan Kepolisian)",
    "Surat Keterangan Sehat dari dokter",
  ]),
  requireCv: false,
  requireIntro: false,
  requirePortfolio: false,

  // Ide 8 — pipeline kustom 5 tahap + kategori + penjelasan per tahap (halaman status)
  stages: JSON.stringify(["Screening Berkas", "Tes Mengemudi", "Wawancara", "Tes Kesehatan", "Offer"]),
  stageCategories: JSON.stringify({
    "Screening Berkas": "REVIEW",
    "Tes Mengemudi": "INTERVIEW",
    Wawancara: "INTERVIEW",
    "Tes Kesehatan": "INTERVIEW",
    Offer: "ACCEPTED",
  }),
  stageNotes: JSON.stringify({
    "Screening Berkas":
      "Tim kami memeriksa kelengkapan berkas: foto SIM B2, SKCK, dan surat keterangan sehat. Proses ini biasanya memakan 1-3 hari kerja.",
    "Tes Mengemudi":
      "Kamu diundang tes mengemudi di kantor studio (durasi sekitar 60 menit) bersama supervisor armada. Yang dinilai: teknik berkendara, kepatuhan rambu, parkir, dan manuver.",
    Wawancara:
      "Percakapan santai dengan tim HR mengenai pengalaman kerja, kesiapan jadwal, dan ekspektasi. Bawa SIM aslimu untuk diverifikasi.",
    "Tes Kesehatan":
      "Pemeriksaan kesehatan ringkas untuk memastikan kamu siap bekerja. Biaya pemeriksaan ditanggung studio.",
    Offer:
      "Selamat! Kamu menerima penawaran kerja. Cek halaman status ini untuk melihat detail penawaran dan konfirmasi tanggal mulai.",
  }),

  // Ide 9 — rubric tes mengemudi + checklist evaluasi
  rubricCriteria: JSON.stringify([
    "Teknik berkendara",
    "Kepatuhan rambu & keselamatan",
    "Parkir & manuver",
    "Kerapian & perawatan kendaraan",
    "Etika layanan & keramahan",
  ]),
  checklistTemplate: JSON.stringify([
    "SIM B2 asli diverifikasi",
    "SKCK diterima",
    "Surat keterangan sehat diterima",
    "Tes mengemudi selesai",
    "Referensi kerja dicek",
  ]),

  // Ide 11 — kriteria AI + auto-shortlist ke Tes Mengemudi
  aiCriteria: [
    "Prioritaskan pelamar yang:",
    "(1) secara eksplisit menyatakan memiliki SIM B2 Umum yang aktif;",
    "(2) punya pengalaman sebagai supir minimal 2 tahun;",
    "(3) berdomisili di Jabodetabek;",
    "(4) bersedia dinas luar kota dan bekerja hari Sabtu.",
    "Tandai negatif bila pelamar tidak menyebut SIM B2, pengalamannya kurang dari 1 tahun, atau menyebut kecelakaan/pelanggaran berat dalam 2 tahun terakhir.",
  ].join(" "),
  autoShortlistScore: 75,
  autoShortlistStage: "Tes Mengemudi",

  // Ide 5 — kuota slot wawancara on-site
  dailySlotQuota: 4,

  // Wawancara & evaluasi khusus supir (ONSITE)
  interviewMode: "ONSITE",
  interviewDuration: 60,
  interviewCriteria: JSON.stringify([
    "Keterampilan mengemudi",
    "Pengetahuan rute & navigasi",
    "Kedisiplinan & ketepatan waktu",
    "Komunikasi & etika layanan",
  ]),
  roundPlan: JSON.stringify([
    { round: 1, name: "Tes Mengemudi", mode: "ONSITE", durationMin: 60 },
    { round: 2, name: "Wawancara HR", mode: "ONSITE", durationMin: 45 },
  ]),

  // Ide 12 — template pesan
  applyTemplate:
    "Hai {nama}, lamaranmu untuk posisi {posisi} sudah kami terima. Gunakan kode {kode} untuk memantau progres seleksi di halaman ini. Tim kami memeriksa kelengkapan berkas 1-3 hari kerja.",
  interviewInviteTemplate:
    "Hai {nama}, kamu diundang tes mengemudi & wawancara untuk posisi {posisi} pada {tanggal} pukul {jam}. Cek detail lokasi dan konfirmasi kehadiranmu di halaman status lamaran ya!",
  offerTemplate:
    "Selamat {nama}! Kami menawarkanmu posisi {posisi} dengan kompensasi {gaji}, rencana mulai bekerja {tanggal}. Mohon konfirmasi sebelum {deadline} melalui halaman status lamaranmu.",
  welcomeTemplate:
    "Selamat bergabung di Lumina Studio, {nama}! Kamu resmi menjadi bagian dari tim {posisi}. Detail hari pertama ada di halaman status lamaranmu.",

  // Onboarding khusus supir
  probationMonths: 3,
  onboardingDocs: JSON.stringify(["Fotokopi SIM B2", "Fotokopi KTP", "NPWP", "Buku rekening"]),
};

async function main() {
  const existing = await db.position.findUnique({ where: { slug: data.slug } });
  if (existing) {
    const apps = await db.application.count({ where: { positionId: existing.id } });
    if (apps > 0) {
      console.log(`SKIP: posisi "${data.slug}" sudah ada dengan ${apps} lamaran — tidak diubah.`);
      await db.$disconnect();
      return;
    }
    await db.position.delete({ where: { id: existing.id } });
    console.log("Posisi lama tanpa lamaran dihapus untuk dibuat ulang.");
  }
  const pos = await db.position.create({ data });
  console.log("OK dibuat:", pos.id, "|", pos.title, "| slug:", pos.slug);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error("GAGAL:", e);
  await db.$disconnect();
  process.exit(1);
});
