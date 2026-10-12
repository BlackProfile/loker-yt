// SERVER-ONLY — Simulator pelamar demo ("Mode Demo").
// Membuat lamaran LENGKAP secara otomatis: persona Indonesia yang realistis,
// jawaban seluruh pertanyaan formulir (termasuk field kondisional showIf), NIK
// + tanggal lahir terstruktur, info kehadiran on-site, ekspektasi gaji, jawaban
// screening (mode klasik), hingga berkas CV/audio mini yang valid bila posisi
// mewajibkannya.
//
// DUA MODE (NR48):
//   - "interval" (santai): satu lamaran tiap N detik — cocok isi santai.
//   - "burst" (lonjakan trafik): N pelamar PER DETIK selama durasi tertentu —
//     meniru lonjakan trafik asli (mis. 217 pelamar dalam 1 detik). Pump
//     berbasis "due" (jumlah yang seharusnya sudah masuk) sehingga kecepatan
//     nyata yang tak terkejar diteruskan/dikoreksi sendiri, dan kecepatan
//     aktual yang tampil di UI selalu JUJUR (dihitung per detik).
//
// Aliran data meniru POST /api/applications publik:
//   persona -> jawaban form -> validateFormAnswers -> berkas -> Application
//   -> ActivityLog -> startBackgroundProcessing (AI screening + notifikasi)
//   -> emitRealtime("applications:changed")
//
// Simulator BERJALAN DI PROSES SERVER (timer global; mati saat server restart,
// status API selalu mencerminkan keadaan sebenarnya). Lamaran demo ditandai
// source = "Demo Simulator" sehingga bisa dibersihkan massal kapan saja.
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { generateUniqueTrackingCode } from "@/lib/tracking";
import { parseScreeningQuestions } from "@/lib/seed";
import {
  FORM_LIMITS,
  isExperienceEnabled,
  isExperienceRequired,
  isFieldVisible,
  isFormSchemaActive,
  isMotivationEnabled,
  isMotivationRequired,
  normalizeFormSchema,
  parseFormSchema,
  validateFormAnswers,
  type FormAnswerValue,
  type FormField,
} from "@/lib/form-schema";
import { KOMUTER_PLANS, SHIFT_PREFS } from "@/lib/types";
import { startBackgroundProcessing } from "@/lib/processing";
import { cancelWaitingAiJobs } from "@/lib/load-metrics";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

/* ================================ Util acak =============================== */

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function chance(probability: number): boolean {
  return Math.random() < probability;
}
function shuffle<T>(list: readonly T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/* ============================= Pool data persona ============================ */

const MALE_FIRST_NAMES = [
  "Ahmad", "Andi", "Arif", "Bagas", "Bayu", "Dimas", "Dwi", "Eko", "Fajar", "Farhan",
  "Gilang", "Hendra", "Ilham", "Irfan", "Kevin", "Rangga", "Reza", "Rizky", "Teguh", "Wahyu",
  "Yoga", "Yusuf", "Aditya", "Bimo", "Cahyo", "Dani", "Fauzan", "Galih", "Hariyanto", "Joko",
];
const FEMALE_FIRST_NAMES = [
  "Anisa", "Ayu", "Citra", "Dewi", "Fitri", "Intan", "Kartika", "Lestari", "Maya", "Mega",
  "Nadia", "Nurul", "Putri", "Rahma", "Rani", "Ratna", "Rina", "Sarah", "Siti", "Tia",
  "Vina", "Wulan", "Yuni", "Zahra", "Aulia", "Cindy", "Dinda", "Hana", "Laila", "Salsa",
];
const LAST_NAMES = [
  "Pratama", "Saputra", "Nugroho", "Wijaya", "Santoso", "Hidayat", "Ramadhan", "Kusuma",
  "Setiawan", "Firmansyah", "Maulana", "Hartono", "Permana", "Gunawan", "Nurdin", "Saputro",
  "Wibowo", "Halim", "Susanto", "Wardana", "Anggraini", "Rahmawati", "Puspita", "Handayani",
  "Wijayanti", "Utami", "Safitri", "Lestari", "Maharani", "Oktaviani",
];
const EMAIL_DOMAINS = ["gmail.com", "yahoo.co.id", "outlook.com", "mail.com", "icloud.com"];
const WA_PREFIXES = ["811", "812", "813", "821", "822", "852", "857", "878", "896", "898"];

const CITY_AREAS = [
  "Bogor Timur, Kota Bogor", "Bogor Tengah, Kota Bogor", "Bogor Selatan, Kota Bogor",
  "Bogor Utara, Kota Bogor", "Tanah Sareal, Kota Bogor", "Cibinong, Kab. Bogor",
  "Citeureup, Kab. Bogor", "Ciawi, Kab. Bogor", "Gunung Sindur, Kab. Bogor",
  "Depok Timur, Kota Depok", "Sawangan, Kota Depok", "Jatiasih, Kota Depok",
  "Bekasi Selatan, Kota Bekasi", "Tangerang Selatan", "Jakarta Timur", "Jakarta Selatan",
];
const STREETS = [
  "Jl. Merdeka", "Jl. Raya Padjadjaran", "Jl. Kenanga", "Jl. Melati", "Jl. Sukajadi",
  "Jl. Cempaka", "Jl. Pahlawan", "Jl. Diponegoro", "Jl. Pandu Raya", "Jl. Lawang",
  "Jl. Pesona Kholid", "Jl. Tegar Beriman", "Jl. Raya Cibinong", "Jl. Margonda",
];

const EXPERIENCE_LINES = [
  "3 tahun sebagai admin operasional di perusahaan logistik, mengelola jadwal armada dan laporan harian.",
  "2 tahun di bidang customer service, terbiasa menangani komplain pelanggan lewat telepon dan chat.",
  "Freelance content support untuk UMKM sejak 2022: caption, jadwal posting, dan dokumentasi event.",
  "1 tahun sebagai staf gudang di e-commerce, bertanggung jawab atas stock opname dan pengiriman.",
  "Magang di kantor kecamatan selama 6 bulan: arsip surat, layanan publik, dan koordinasi acara.",
  "4 tahun membantu usaha keluarga di bidang distribusi makanan, dari penjadwalan sampai laporan keuangan.",
  "2 tahun sebagai kasir & barista di kedai kopi, terbiasa shift dan melayani puncak weekend.",
  "Membuat video pendek untuk klien UMKM: riset, editing CapCut, dan terjemahan subtitle.",
];
const MOTIVATION_LINES = [
  "Saya suka lingkungan kerja yang dinamis dan ingin tumbuh bersama tim kreatif Lumina Studio.",
  "Saya orang yang disiplin, tepat waktu, dan siap belajar hal baru dari nol.",
  "Saya tertarik dengan industri produksi konten dan ingin berkontribusi secara nyata.",
  "Saya mengincar pengalaman kerja yang menantang dan bisa memperluas keterampilan saya.",
  "Saya nyaman bekerja dalam tim maupun mandiri, dan senang membantu menyelesaikan apa pun yang dibutuhkan.",
];
const GENERIC_SHORT_ANSWERS = [
  "Siap bekerja dengan jadwal yang ditentukan tim.",
  "Saya terbiasa bekerja di bawah tekanan tenggat.",
  "Bersedia mengikuti pelatihan yang diberikan perusahaan.",
  "Saya nyaman berkomunikasi dengan orang baru setiap hari.",
  "Tidak ada kendala; saya siap mulai kapan saja.",
  "Saya suka pekerjaan yang rapi, terjadwal, dan jelas targetnya.",
];
const START_DATE_PREFS = ["Segera", "Minggu depan", "Setelah 2 minggu pemberitahuan", "Awal bulan depan", "Fleksibel, menyesuaikan tim"];

/* ============================ Berkas mini (PDF/WAV) =========================== */

/** PDF satu halaman yang valid (Helvetica) — cukup untuk pratinjau/demo. */
function makeMiniPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) =>
    s.replace(/[^\x20-\x7E]/g, "-").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const contentParts: string[] = [
    "BT", "/F1 18 Tf", "50 790 Td", `(${esc(title)}) Tj`,
    "/F1 11 Tf", "0 -30 Td", "18 TL",
  ];
  for (const line of lines) contentParts.push(`(${esc(line)}) Tj`, "T*");
  contentParts.push("ET");
  const content = contentParts.join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${pad(off, 10)} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** WAV PCM 16-bit mono 8kHz berisi hening — lolos validasi audio perkenalan. */
function makeMiniWav(seconds = 1): Buffer {
  const sampleRate = 8000;
  const dataSize = sampleRate * seconds * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf; // sampel hening (nol)
}

async function saveDemoAsset(filename: string, mimeType: string, buffer: Buffer): Promise<string> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const storedName = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}-${filename
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(-60)}`;
  await writeFile(path.join(uploadsDir, storedName), buffer);
  const asset = await db.fileAsset.create({
    data: {
      filename,
      mimeType,
      size: buffer.length,
      path: `uploads/${storedName}`,
    },
    select: { id: true },
  });
  return asset.id;
}

/* ============================ Persona & jawaban ============================ */

type Gender = "L" | "P";
type Persona = {
  name: string;
  email: string;
  phone: string;
  gender: Gender;
  birthDate: Date;
  nik: string;
  handle: string;
};

function buildPersona(minAge: number | null): Persona {
  const gender: Gender = chance(0.55) ? "L" : "P";
  const firstName = gender === "L" ? pick(MALE_FIRST_NAMES) : pick(FEMALE_FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const name = `${firstName} ${lastName}`;

  // Usia: hormati umur minimum posisi (demo = pelamar memenuhi syarat).
  const ageMin = Math.max(minAge ?? 19, 18);
  const age = randInt(ageMin, Math.max(ageMin, 50));
  const now = new Date();
  const birthDate = new Date(now.getFullYear() - age, randInt(0, 11), randInt(1, 28));

  const handle = `${firstName.toLowerCase()}.${lastName.toLowerCase()}`;
  const emailDomain = pick(EMAIL_DOMAINS);
  const emailNumber = chance(0.4) ? String(randInt(2, 99)) : "";
  const email = `${handle}${emailNumber}@${emailDomain}`;

  const phone = `+62${pick(WA_PREFIXES)}${pad(randInt(0, 99999999), 8)}`.slice(0, 17);

  // NIK 16 digit menyerupai format asli: 32 (Jabar) 73 (Kota Bogor) + DDMMYY
  // (DD +40 untuk perempuan) + 4 digit serial.
  let dd = birthDate.getDate();
  if (gender === "P") dd += 40;
  const nik =
    `32${73}${pad(dd, 2)}${pad(birthDate.getMonth() + 1, 2)}${pad(birthDate.getFullYear() % 100, 2)}` +
    pad(randInt(0, 9999), 4);

  return { name, email, phone, gender, birthDate, nik, handle };
}

function streetAddress(persona: Persona): string {
  return `${pick(STREETS)} No.${randInt(1, 120)}, RT ${pad(randInt(1, 15), 2)}/RW ${pad(randInt(1, 12), 2)}, ${pick(CITY_AREAS)}`;
}

/** Jawaban untuk field skema (mode Form Builder) — realistis per tipe & kata kunci label. */
function answerForField(field: FormField, persona: Persona): FormAnswerValue | null {
  const label = field.label.toLowerCase();
  const options = field.options.length > 0 ? field.options : [];

  switch (field.type) {
    case "radio":
    case "dropdown": {
      if (options.length === 0) return field.allowOther ? pick(GENERIC_SHORT_ANSWERS) : null;
      // Pertanyaan "Punya ...?" (pemicu field kondisional) -> condong "Ya".
      if (options.includes("Ya") && (label.includes("punya") || label.includes("bersedia"))) {
        return chance(0.75) ? "Ya" : pick(options);
      }
      return pick(options);
    }
    case "checkbox": {
      if (options.length === 0) return field.allowOther ? [pick(GENERIC_SHORT_ANSWERS)] : null;
      const shuffled = shuffle(options);
      const count = Math.min(shuffled.length, randInt(1, 2));
      return shuffled.slice(0, count);
    }
    case "date": {
      const now = new Date();
      if (label.includes("mulai") || label.includes("bergabung")) {
        // "Kapan bisa mulai bekerja" -> 1-6 minggu ke depan.
        const d = new Date(now.getTime() + randInt(7, 42) * 24 * 60 * 60 * 1000);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
      }
      const d = new Date(now.getTime() - randInt(30, 730) * 24 * 60 * 60 * 1000);
      return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
    }
    case "number": {
      const min = field.min ?? 1;
      const max = field.max ?? (label.includes("tahun") ? 8 : 100);
      return randInt(min, Math.max(min, max));
    }
    case "currency": {
      const base = randInt(28, 85) * 100_000; // 2,8jt - 8,5jt step 100rb
      const min = field.min ?? 0;
      const max = field.max ?? Number.MAX_SAFE_INTEGER;
      return Math.min(Math.max(base, min), max);
    }
    case "rating": {
      const max = field.max ?? FORM_LIMITS.ratingMaxDefault;
      return randInt(3, Math.max(3, max));
    }
    case "url": {
      if (label.includes("instagram")) return `https://instagram.com/${persona.handle.replace(".", "_")}`;
      if (label.includes("tiktok")) return `https://tiktok.com/@${persona.handle.replace(".", "_")}`;
      if (label.includes("portofolio") || label.includes("portfolio")) return `https://behance.net/${persona.handle.replace(".", "_")}`;
      if (label.includes("linkedin")) return `https://linkedin.com/in/${persona.handle}`;
      if (label.includes("youtube")) return `https://youtube.com/@${persona.handle.replace(".", "_")}`;
      if (label.includes("drive") || label.includes("dokumen")) return `https://drive.google.com/drive/folders/demo-${randInt(1000, 9999)}`;
      return `https://linktr.ee/${persona.handle.replace(".", "_")}`;
    }
    case "file":
      return null; // berkas ditangani terpisah (dibuat + disisipkan setelah validasi)
    case "textarea": {
      const sentences = shuffle([...EXPERIENCE_LINES, ...MOTIVATION_LINES]).slice(0, 2);
      return sentences.join(" ");
    }
    default: {
      // text — petakan kata kunci label umum.
      if (label.includes("alamat")) return streetAddress(persona);
      if (label.includes("domisili") || label.includes("kota")) return pick(CITY_AREAS);
      if (label.includes("sekolah") || label.includes("asal sekolah")) {
        return pick(["SMK Negeri 1 Bogor", "SMA Negeri 3 Bogor", "SMK Bina Karya", "SMA Boen Tek Hie", "SMK Wikrama Bogor"]);
      }
      if (label.includes("jurusan")) {
        return pick(["Multimedia / DKV", "Teknik Kendaraan Ringan", "Akuntansi", "Bahasa Inggris", "IPA"]);
      }
      if (label.includes("kendaraan")) {
        return pick(["Motor pribadi (matic)", "Motor + SIM C aktif", "Mobil keluarga (ada SIM A)"]);
      }
      if (label.includes("ukuran") || label.includes("seragam")) {
        return pick(["M", "L", "XL", "XXL"]);
      }
      if (label.includes("sim")) {
        return pick(["SIM A, terbit 2019", "SIM B2 Umum, terbit 2021", "SIM C, terbit 2020"]);
      }
      if (label.includes("media sosial") || label.includes("sosmed") || label.includes("sosial")) {
        return `IG: @${persona.handle.replace(".", "_")} · TikTok: @${persona.handle.replace(".", "_")}`;
      }
      if (label.includes("gaji")) return `Rp ${randInt(35, 75) * 100_000}`.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      if (label.includes("pengalaman")) return pick(EXPERIENCE_LINES);
      return pick(GENERIC_SHORT_ANSWERS);
    }
  }
}

/** Jawaban pertanyaan screening (mode klasik) berdasar kata kunci pertanyaan. */
function answerForScreening(question: string, persona: Persona): string {
  const q = question.toLowerCase();
  if (q.includes("berapa lama") || q.includes("pengalaman")) {
    return "Sekitar 2-3 tahun, terakhir menangani produksi konten harian untuk brand lokal.";
  }
  if (q.includes("software") || q.includes("alat") || q.includes("tool")) {
    return "Paling lancar CapCut & Premiere Pro untuk harian; After Effects untuk motion sederhana.";
  }
  if (q.includes("berapa video") || q.includes("per bulan") || q.includes("per minggu")) {
    return `Rata-rata ${randInt(6, 12)} karya per bulan, termasuk yang tayang di akun pribadi.`;
  }
  if (q.includes("tautan") || q.includes("link") || q.includes("portofolio") || q.includes("thumbnail")) {
    return `https://drive.google.com/drive/folders/demo-${persona.handle.replace(/\./g, "-")}-${randInt(1000, 9999)}`;
  }
  if (q.includes("hook")) {
    return "Berhenti menunggu mood — jadwal dan naskah yang bikin konsisten.";
  }
  if (q.includes("genre") || q.includes("riset")) {
    return "Paling kuat riset konten edukasi populer dan self-improvement.";
  }
  if (q.includes("akun") || q.includes("sosial media") || q.includes("kelola")) {
    return `IG @${persona.handle.replace(".", "_")} (~12 ribu follower) dan TikTok @${persona.handle.replace(".", "_")} (~40 ribu).`;
  }
  return "Saya berkomitmen memberikan hasil terbaik dan siap mengikuti arahan tim Lumina Studio.";
}

/* ========================= Inti: buat satu lamaran ========================= */

export type DemoSubmitResult =
  | { ok: true; name: string; positionTitle: string; trackingCode: string }
  | { ok: false; error: string };

const DEMO_SOURCE = "Demo Simulator";

/** Cache daftar posisi terbuka utk mode lonjakan (per detik, hanya mode "semua posisi"). */
let demoPositionCache: { sec: number; positions: Awaited<ReturnType<typeof db.position.findMany>> } | null =
  null;

async function createDemoApplication(positionIdOverride: string | null): Promise<DemoSubmitResult> {
  // 1. Kandidat posisi: aktif, formulir terbuka, jadwal tayang/tutupnya valid.
  const now = new Date();
  let candidates: Awaited<ReturnType<typeof db.position.findMany>>;
  if (!positionIdOverride) {
    // Lonjakan memanggil ini ratusan kali per detik — daftar posisi stabil
    // cukup dibaca sekali per detik (kuota tetap dicek per lamaran di bawah).
    const sec = Math.floor(now.getTime() / 1000);
    if (demoPositionCache && demoPositionCache.sec === sec) {
      candidates = demoPositionCache.positions;
    } else {
      candidates = await db.position.findMany({
        where: { isActive: true, applyOpen: true },
      });
      demoPositionCache = { sec, positions: candidates };
    }
  } else {
    candidates = await db.position.findMany({
      where: {
        isActive: true,
        applyOpen: true,
        id: positionIdOverride,
      },
    });
  }
  const openPositions = candidates.filter(
    (p) =>
      (!p.closesAt || p.closesAt > now) &&
      (!p.publishAt || p.publishAt <= now) &&
      (p.maxApplicants == null ||
        // posisi berkuota tetap boleh dipilih; penuh baru dianggap tertutup
        true),
  );
  if (openPositions.length === 0) {
    return { ok: false, error: "Tidak ada posisi terbuka untuk demo." };
  }

  // Kuota penuh tetap dikecualikan bila terdeteksi.
  const eligible: typeof openPositions = [];
  for (const position of openPositions) {
    if (position.maxApplicants != null) {
      const used = await db.application.count({
        where: { positionId: position.id, status: { not: "REJECTED" } },
      });
      if (used >= position.maxApplicants) continue;
    }
    eligible.push(position);
  }
  if (eligible.length === 0) {
    return { ok: false, error: "Semua posisi kandidat sudah penuh kuotanya." };
  }

  // 2. Coba maksimal 3 posisi acak (posisi ber-skema bisa gagal validasi).
  let lastError: string | null = null;
  for (const position of shuffle(eligible).slice(0, 3)) {
    const attempt = await tryCreateForPosition(position.id, now);
    if (attempt.ok) return attempt;
    // catat alasan terakhir; coba posisi lain
    lastError = attempt.error;
  }
  return { ok: false, error: lastError ?? "Gagal membuat lamaran demo." };
}

async function tryCreateForPosition(positionId: string, now: Date): Promise<DemoSubmitResult> {
  const position = await db.position.findUnique({ where: { id: positionId } });
  if (!position) return { ok: false, error: "Posisi tidak ditemukan." };

  const parsedFormSchema = parseFormSchema(position.formSchema);
  const formSchema = normalizeFormSchema(parsedFormSchema, {
    requireCv: position.requireCv,
    requireIntro: position.requireIntro,
    requirePortfolio: position.requirePortfolio,
  });
  const schemaActive = isFormSchemaActive({ formSchema });
  const experienceSection = formSchema?.sections.find((s) => s.kind === "experience");

  const experienceEnabled = schemaActive && experienceSection
    ? isExperienceEnabled(experienceSection)
    : true;
  const experienceRequired = schemaActive && experienceSection
    ? isExperienceRequired(experienceSection)
    : true;
  const motivationEnabled = schemaActive && experienceSection
    ? isMotivationEnabled(experienceSection)
    : true;
  const motivationRequired = schemaActive && experienceSection
    ? isMotivationRequired(experienceSection)
    : true;

  const persona = buildPersona(position.minAge);
  const deadSections = new Set(
    (formSchema?.sections ?? [])
      .filter((s) => s.removed === true)
      .map((s) => s.id),
  );

  /* ---- (a) jawaban skema (mode Form Builder) ---- */
  let formAnswersJson: string | null = null;
  const draftAnswers: Record<string, FormAnswerValue> = {};
  const fileFields: FormField[] = [];
  if (formSchema && schemaActive) {
    // Bangun jawaban BERURUTAN agar showIf tahu field terlihat/tersembunyi.
    for (const field of formSchema.fields) {
      if (deadSections.has(field.sectionId)) continue;
      if (!isFieldVisible(field, draftAnswers)) continue;
      if (field.type === "file") {
        fileFields.push(field);
        continue;
      }
      const value = answerForField(field, persona);
      if (value != null && value !== "" && !(Array.isArray(value) && value.length === 0)) {
        draftAnswers[field.id] = value;
      }
    }
    const validated = validateFormAnswers(formSchema, draftAnswers);
    if (!validated.ok) {
      return { ok: false, error: `${position.title}: ${validated.error}` };
    }
    formAnswersJson = JSON.stringify(validated.cleaned);
  }

  /* ---- (b) jawaban screening (mode klasik) ---- */
  let screeningAnswersJson: string | null = null;
  if (!formAnswersJson) {
    const questions = parseScreeningQuestions(position.screeningQuestions);
    if (questions.length > 0) {
      const record: Record<string, string> = {};
      for (const question of questions) {
        record[question.id] = answerForScreening(question.label, persona);
      }
      screeningAnswersJson = JSON.stringify(record);
    }
  }

  /* ---- (c) berkas mini bila diwajibkan / ada field file ---- */
  const createdAssetIds: string[] = [];
  let cvFileId: string | null = null;
  let introFileId: string | null = null;
  try {
    if (position.requireCv) {
      cvFileId = await saveDemoAsset(
        `CV-${persona.name.replace(/\s+/g, "-")}.pdf`,
        "application/pdf",
        makeMiniPdf(`CV - ${persona.name}`, [
          `Posisi dilamar: ${position.title}`,
          `Kode lamaran: (demo)`,
          `Email: ${persona.email}`,
          `WhatsApp: ${persona.phone}`,
          `Domisili: ${pick(CITY_AREAS)}`,
          "",
          "Ringkasan:",
          ...EXPERIENCE_LINES.slice(0, 2).map((l) => `- ${l}`),
          "",
          "(Dokumen demo dibuat otomatis oleh Simulator Pelamar.)",
        ]),
      );
      createdAssetIds.push(cvFileId);
    }
    if (position.requireIntro) {
      introFileId = await saveDemoAsset(
        `Perkenalan-${persona.name.replace(/\s+/g, "-")}.wav`,
        "audio/wav",
        makeMiniWav(1),
      );
      createdAssetIds.push(introFileId);
    }
    if (fileFields.length > 0) {
      // Sisipkan jawaban berkas SETELAH validasi (meniru aliran route publik).
      const cleaned = formAnswersJson ? (JSON.parse(formAnswersJson) as Record<string, FormAnswerValue>) : {};
      for (const field of fileFields.slice(0, 5)) {
        const assetId = await saveDemoAsset(
          `${field.label.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")}-${persona.name.replace(/\s+/g, "-")}.pdf`,
          "application/pdf",
          makeMiniPdf(field.label, [
            `Nama: ${persona.name}`,
            `Posisi: ${position.title}`,
            "",
            "(Berkas demo dibuat otomatis oleh Simulator Pelamar.)",
          ]),
        );
        createdAssetIds.push(assetId);
        cleaned[field.id] = { fileId: assetId, filename: `${field.label} - ${persona.name}.pdf` };
      }
      formAnswersJson = JSON.stringify(cleaned);
    }
  } catch (fileError) {
    // Berkas demo gagal: buang aset yang sudah terlanjur dibuat lalu batalkan.
    for (const assetId of createdAssetIds) {
      await db.fileAsset.delete({ where: { id: assetId } }).catch(() => {});
    }
    console.error("[demo-applicants] gagal membuat berkas demo:", fileError);
    return { ok: false, error: `${position.title}: gagal menyiapkan berkas demo.` };
  }

  /* ---- (d) teks pengalaman & motivasi (bagian inti) ---- */
  const experience =
    experienceEnabled === false
      ? "-"
      : `${pick(EXPERIENCE_LINES)} ${pick(EXPERIENCE_LINES).split(". ")[0]}.`;
  const motivation = motivationEnabled === false ? "-" : pick(MOTIVATION_LINES);
  if (experienceRequired && experience.length < 10) {
    return { ok: false, error: `${position.title}: pengalaman terlalu pendek.` };
  }

  /* ---- (e) info kehadiran on-site/hybrid + gaji ---- */
  const isOnsite = position.workMode === "ONSITE" || position.workMode === "HYBRID";
  const domisili = isOnsite ? pick(CITY_AREAS) : null;
  const komuterPlan = isOnsite ? pick(KOMUTER_PLANS) : null;
  const shiftPref = isOnsite ? pick(SHIFT_PREFS) : null;
  const startDatePref = isOnsite ? pick(START_DATE_PREFS).slice(0, 60) : null;
  const salaryExpectation = randInt(32, 85) * 100_000;

  // Portofolio: wajib bila posisi mensyaratkan; kadang diisi pelamar rajin.
  const portfolioUrl =
    position.requirePortfolio || chance(0.6)
      ? `https://behance.net/${persona.handle.replace(".", "_")}`
      : null;

  /* ---- (f) simpan lamaran ---- */
  const trackingCode = await generateUniqueTrackingCode();
  const created = await db.application.create({
    data: {
      name: persona.name,
      email: persona.email,
      phone: persona.phone,
      positionId: position.id,
      portfolioUrl,
      experience,
      motivation,
      trackingCode,
      cvFileId,
      introFileId,
      extraDocs: "[]",
      source: DEMO_SOURCE,
      screeningAnswers: screeningAnswersJson,
      formAnswers: formAnswersJson,
      domisili,
      komuterPlan,
      shiftPref,
      startDatePref,
      salaryExpectation,
      nik: persona.nik,
      birthDate: persona.birthDate,
      consentAt: now,
      stageUpdatedAt: now,
    },
  });

  await db.activityLog.create({
    data: {
      applicationId: created.id,
      actor: "Sistem",
      action: "APPLICATION_SUBMITTED",
      detail: `Lamaran demo (Simulator Pelamar) masuk untuk posisi ${position.title}`,
    },
  });

  // Pipeline latar belakang + sinyal realtime — sama seperti submit nyata.
  void startBackgroundProcessing(created.id).catch(() => {});
  void emitRealtime(REALTIME_EVENTS.applications);

  return {
    ok: true,
    name: persona.name,
    positionTitle: position.title,
    trackingCode,
  };
}

/* ======================= Mesin status simulator (timer) ====================== */

const MAX_GENERATED_PER_RUN = 200; // rem mode santai: hentikan otomatis pada 200 lamaran per jalan
const MIN_INTERVAL_SEC = 5;
const MAX_INTERVAL_SEC = 3600;
const MIN_RATE_PER_SEC = 5; // rem mode lonjakan
const MAX_RATE_PER_SEC = 500;
const MIN_DURATION_SEC = 5;
const MAX_DURATION_SEC = 300;
const MAX_BURST_TOTAL = 3000; // rem mode lonjakan: berhenti otomatis pada 3.000 lamaran per jalan
const BURST_CONCURRENCY = 8; // pembuatan lamaran paralel (diuji: 6-12, 8 paling stabil & cepat)
const BURST_BATCH = 48; // tugas per putaran pool
const RECENT_WINDOW_SEC = 5; // jendela hitung kecepatan aktual

export type DemoMode = "interval" | "burst";

type RecentBucket = { sec: number; count: number };

type DemoSimulatorInternal = {
  timer: ReturnType<typeof setTimeout> | null;
  mode: DemoMode;
  intervalSec: number; // mode interval
  ratePerSec: number; // mode lonjakan
  durationSec: number | null; // mode lonjakan; null = terus sampai dihentikan
  burstStartedAt: number; // epoch ms mulai lonjakan (basis hitung due & aktual)
  burstDeadline: number | null; // epoch ms batas dispatch (null = tanpa durasi)
  dispatched: number; // tugas dikirim pada lonjakan berjalan
  runGenerated: number; // lamaran sukses pada jalan berjalan (basis rem per-jalan)
  inFlight: number; // tugas sedang dibuat
  pumping: boolean; // pump lonjakan aktif
  recent: RecentBucket[]; // bucket per-detik utk kecepatan aktual
  positionId: string | null; // null = semua posisi terbuka
  running: boolean;
  generated: number;
  failed: number;
  startedAt: string | null;
  lastAt: string | null;
  lastError: string | null;
  note: string | null;
  lastApplicant: { name: string; positionTitle: string; trackingCode: string } | null;
};

const SIM_KEY = "__luminaDemoSimulatorState";

function simulatorState(): DemoSimulatorInternal {
  const holder = globalThis as unknown as Record<string, unknown>;
  if (!holder[SIM_KEY]) {
    holder[SIM_KEY] = {
      timer: null,
      mode: "interval" as DemoMode,
      intervalSec: 15,
      ratePerSec: 100,
      durationSec: 30 as number | null,
      burstStartedAt: 0,
      burstDeadline: null,
      dispatched: 0,
      runGenerated: 0,
      inFlight: 0,
      pumping: false,
      recent: [] as RecentBucket[],
      positionId: null,
      running: false,
      generated: 0,
      failed: 0,
      startedAt: null,
      lastAt: null,
      lastError: null,
      note: null,
      lastApplicant: null,
    } satisfies DemoSimulatorInternal;
  }
  return holder[SIM_KEY] as DemoSimulatorInternal;
}

export type DemoSimulatorStatus = {
  running: boolean;
  mode: DemoMode;
  intervalSec: number;
  ratePerSec: number;
  durationSec: number | null;
  targetTotal: number | null; // perkiraan total lonjakan (null utk mode interval)
  inFlight: number;
  recentPerSec: number; // kecepatan aktual ±N/detik (mode lonjakan)
  positionId: string | null;
  generated: number;
  failed: number;
  startedAt: string | null;
  lastAt: string | null;
  lastError: string | null;
  note: string | null;
  lastApplicant: { name: string; positionTitle: string; trackingCode: string } | null;
};

function statusSnapshot(): DemoSimulatorStatus {
  const s = simulatorState();
  const targetTotal =
    s.mode === "burst"
      ? s.durationSec != null
        ? Math.min(MAX_BURST_TOTAL, s.ratePerSec * s.durationSec)
        : MAX_BURST_TOTAL
      : null;
  return {
    running: s.running,
    mode: s.mode,
    intervalSec: s.intervalSec,
    ratePerSec: s.ratePerSec,
    durationSec: s.durationSec,
    targetTotal,
    inFlight: s.inFlight,
    recentPerSec: recentPerSec(s),
    positionId: s.positionId,
    generated: s.generated,
    failed: s.failed,
    startedAt: s.startedAt,
    lastAt: s.lastAt,
    lastError: s.lastError,
    note: s.note,
    lastApplicant: s.lastApplicant,
  };
}

/** Catat n lamaran masuk ke bucket detik berjalan (maks 6 bucket disimpan). */
function recordRecent(count: number): void {
  const s = simulatorState();
  const sec = Math.floor(Date.now() / 1000);
  const last = s.recent[s.recent.length - 1];
  if (last && last.sec === sec) {
    last.count += count;
  } else {
    s.recent.push({ sec, count });
    if (s.recent.length > RECENT_WINDOW_SEC + 1) s.recent.shift();
  }
}

/** Kecepatan aktual (lamaran/detik) dari bucket per-detik terakhir — jujur. */
function recentPerSec(s: DemoSimulatorInternal): number {
  if (!s.running || s.mode !== "burst") return 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const elapsedSec = Math.max(1, Math.round((Date.now() - s.burstStartedAt) / 1000));
  const window = Math.min(RECENT_WINDOW_SEC, elapsedSec);
  let total = 0;
  for (const bucket of s.recent) {
    if (bucket.sec >= nowSec - window) total += bucket.count;
  }
  return Math.round(total / window);
}

async function runTick(): Promise<void> {
  const s = simulatorState();
  if (!s.running) return;
  try {
    const result = await createDemoApplication(s.positionId);
    if (result.ok) {
      s.generated += 1;
      s.runGenerated += 1;
      s.lastAt = new Date().toISOString();
      s.lastApplicant = {
        name: result.name,
        positionTitle: result.positionTitle,
        trackingCode: result.trackingCode,
      };
      s.lastError = null;
    } else {
      s.failed += 1;
      s.lastError = result.error;
    }
  } catch (error) {
    s.failed += 1;
    s.lastError = error instanceof Error ? error.message : String(error);
  }

  if (s.runGenerated >= MAX_GENERATED_PER_RUN) {
    s.running = false;
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.note = `Batas ${MAX_GENERATED_PER_RUN} lamaran demo dalam satu kali jalan tercapai — simulator dihentikan otomatis.`;
    return;
  }
  if (s.running) {
    s.timer = setTimeout(() => {
      void runTick();
    }, s.intervalSec * 1000);
  }
}

/* ==================== Mode lonjakan trafik (pump per detik) =================== */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Kumpulan pekerja: membuat `count` lamaran dengan paralel terbatas.
 * Setiap pekerja mengecek s.running sebelum tiap tugas agar Stop terasa instan.
 */
async function runBurstBatch(count: number): Promise<void> {
  const s = simulatorState();
  let next = 0;
  const workers = Array.from({ length: Math.min(BURST_CONCURRENCY, count) }, async () => {
    while (s.running && next < count) {
      next += 1;
      s.dispatched += 1;
      s.inFlight += 1;
      try {
        const result = await createDemoApplication(s.positionId);
        if (result.ok) {
          s.generated += 1;
          s.runGenerated += 1;
          s.lastAt = new Date().toISOString();
          s.lastApplicant = {
            name: result.name,
            positionTitle: result.positionTitle,
            trackingCode: result.trackingCode,
          };
          recordRecent(1);
        } else {
          s.failed += 1;
          s.lastError = result.error;
        }
      } catch (error) {
        s.failed += 1;
        s.lastError = error instanceof Error ? error.message : String(error);
      } finally {
        s.inFlight = Math.max(0, s.inFlight - 1);
      }
    }
  });
  await Promise.all(workers);
}

/**
 * Pump lonjakan: setiap putaran menghitung "due" (berapa lamaran yang
 * seharusnya sudah masuk pada titik waktu ini = elapsed × target), lalu
 * menyiram selisihnya. Kalau server tak mampu mengejar target, backlog
 * menumpuk dan kecepatan aktual (recentPerSec) menunjukkan angka jujur.
 * Berhenti saat: durasi habis + tugas berjalan selesai, batas total
 * tercapai, tombol Hentikan (s.running = false), atau server restart.
 */
async function runBurstPump(): Promise<void> {
  const s = simulatorState();
  if (s.pumping) return; // pump lama masih hidup — ia membaca state terbaru tiap putaran
  s.pumping = true;
  try {
    while (s.running && s.mode === "burst") {
      const now = Date.now();
      const deadlineReached = s.burstDeadline != null && now >= s.burstDeadline;
      const capReached = s.runGenerated >= MAX_BURST_TOTAL;
      if (deadlineReached || capReached) {
        if (s.inFlight > 0) {
          await sleep(80); // tunggu tugas berjalan selesai (drain)
          continue;
        }
        if (capReached) {
          s.note = `Batas ${MAX_BURST_TOTAL.toLocaleString("id-ID")} lamaran demo dalam satu kali jalan tercapai — simulator berhenti.`;
        } else if (s.burstDeadline != null) {
          const secs = Math.max(1, Math.round((Date.now() - s.burstStartedAt) / 1000));
          s.note = `Lonjakan selesai — ${s.runGenerated.toLocaleString("id-ID")} lamaran dalam ±${secs} detik (target ${s.ratePerSec}/s).`;
        }
        s.running = false;
        s.timer = null;
        continue; // keluar — kondisi while tak lagi terpenuhi
      }

      const elapsedSec = Math.max(0, (now - s.burstStartedAt) / 1000);
      const plannedTotal =
        s.durationSec != null
          ? Math.min(MAX_BURST_TOTAL, s.ratePerSec * s.durationSec)
          : MAX_BURST_TOTAL;
      const dueTotal = Math.min(plannedTotal, Math.floor(elapsedSec * s.ratePerSec));
      const backlog = Math.max(0, dueTotal - s.dispatched);
      if (backlog <= 0) {
        await sleep(150);
        continue;
      }
      await runBurstBatch(Math.min(backlog, BURST_BATCH));
    }
  } finally {
    s.pumping = false;
  }
}

export function startDemoSimulator(options?: {
  intervalSec?: number;
  positionId?: string | null;
  mode?: DemoMode;
  ratePerSec?: number;
  durationSec?: number | null;
}): DemoSimulatorStatus {
  const s = simulatorState();
  s.mode = options?.mode === "burst" ? "burst" : "interval";

  const requestedInterval = Math.round(Number(options?.intervalSec ?? s.intervalSec));
  if (Number.isFinite(requestedInterval)) {
    s.intervalSec = Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, requestedInterval));
  }
  if (options?.ratePerSec !== undefined) {
    const requestedRate = Math.round(Number(options.ratePerSec));
    if (Number.isFinite(requestedRate)) {
      s.ratePerSec = Math.min(MAX_RATE_PER_SEC, Math.max(MIN_RATE_PER_SEC, requestedRate));
    }
  }
  if (options?.durationSec !== undefined) {
    const requestedDuration = Number(options.durationSec);
    if (
      options.durationSec === null ||
      !Number.isFinite(requestedDuration) ||
      requestedDuration <= 0
    ) {
      s.durationSec = null; // terus sampai dihentikan
    } else {
      s.durationSec = Math.min(
        MAX_DURATION_SEC,
        Math.max(MIN_DURATION_SEC, Math.round(requestedDuration)),
      );
    }
  }
  if (options?.positionId !== undefined) {
    s.positionId = options.positionId && options.positionId !== "ALL" ? options.positionId : null;
  }

  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.running = true;
  s.note = null;
  s.lastError = null;
  s.dispatched = 0;
  s.runGenerated = 0;
  s.recent = [];
  s.burstStartedAt = Date.now();
  s.burstDeadline =
    s.mode === "burst" && s.durationSec != null ? Date.now() + s.durationSec * 1000 : null;
  if (!s.startedAt) s.startedAt = new Date().toISOString();

  if (s.mode === "burst") {
    void runBurstPump();
  } else {
    // Tick pertama 1,5 detik setelah mulai — terasa "langsung masuk".
    s.timer = setTimeout(() => {
      void runTick();
    }, 1500);
  }
  return statusSnapshot();
}

export function stopDemoSimulator(): DemoSimulatorStatus {
  const s = simulatorState();
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.running = false;
  return statusSnapshot();
}

export function getDemoSimulatorStatus(): DemoSimulatorStatus {
  return statusSnapshot();
}

/* ============================ Bersihkan data demo =========================== */

/**
 * Hapus SEMUA lamaran bertanda source "Demo Simulator" beserta log aktivitas
 * dan berkas miliknya (CV/intro/berkas field form). Menghentikan simulator,
 * menunggu tugas pembuatan berjalan selesai (drain), lalu membatalkan tugas AI
 * yang masih mengantre milik lamaran demo.
 */
export async function cleanupDemoApplications(): Promise<{ deleted: number }> {
  stopDemoSimulator();

  // Tunggu tugas pembuatan yang masih berjalan selesai (maks ±2 dtk) supaya
  // tidak ada lamaran demo yang menyusup SETELAH penghapusan.
  {
    const s = simulatorState();
    const waitUntil = Date.now() + 2000;
    while (s.inFlight > 0 && Date.now() < waitUntil) {
      await sleep(50);
    }
  }

  const demoApps = await db.application.findMany({
    where: { source: DEMO_SOURCE },
    select: { id: true, cvFileId: true, introFileId: true, formAnswers: true },
  });
  if (demoApps.length === 0) {
    const s = simulatorState();
    s.generated = 0;
    s.failed = 0;
    s.startedAt = null;
    s.lastAt = null;
    s.lastApplicant = null;
    s.lastError = null;
    s.dispatched = 0;
    s.runGenerated = 0;
    s.inFlight = 0;
    s.recent = [];
    return { deleted: 0 };
  }

  // Kumpulkan id berkas: CV, intro, dan jawaban bertipe file di formAnswers.
  const assetIds = new Set<string>();
  for (const app of demoApps) {
    if (app.cvFileId) assetIds.add(app.cvFileId);
    if (app.introFileId) assetIds.add(app.introFileId);
    if (app.formAnswers) {
      try {
        const parsed: unknown = JSON.parse(app.formAnswers);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const value of Object.values(parsed as Record<string, unknown>)) {
            if (value && typeof value === "object" && !Array.isArray(value)) {
              const fileId = (value as Record<string, unknown>).fileId;
              if (typeof fileId === "string") assetIds.add(fileId);
            }
          }
        }
      } catch {
        // formAnswers rusak — lewati pengumpulan berkasnya.
      }
    }
  }

  const ids = demoApps.map((a) => a.id);
  await db.activityLog.deleteMany({ where: { applicationId: { in: ids } } });
  await db.application.deleteMany({ where: { id: { in: ids } } });
  // Buang tugas AI yang masih mengantre milik lamaran demo yang baru dihapus
  // (penting setelah lonjakan besar — ribuan tugas tidak perlu diproses).
  cancelWaitingAiJobs(new Set(ids));

  const assets = assetIds.size > 0
    ? await db.fileAsset.findMany({ where: { id: { in: [...assetIds] } }, select: { id: true, path: true } })
    : [];
  if (assets.length > 0) {
    await db.fileAsset.deleteMany({ where: { id: { in: assets.map((a) => a.id) } } });
    for (const asset of assets) {
      if (!asset.path) continue;
      await unlink(path.join(process.cwd(), asset.path)).catch(() => {});
    }
  }

  const s = simulatorState();
  s.generated = 0;
  s.failed = 0;
  s.startedAt = null;
  s.lastAt = null;
  s.lastApplicant = null;
  s.lastError = null;
  s.note = null;
  s.dispatched = 0;
  s.runGenerated = 0;
  s.inFlight = 0;
  s.recent = [];
  // Sinyal realtime agar seluruh panel admin yang terbuka segera memuat ulang
  // daftar lamaran (baris demo menghilang tanpa perlu refresh manual).
  void emitRealtime(REALTIME_EVENTS.applications);
  return { deleted: ids.length };
}
