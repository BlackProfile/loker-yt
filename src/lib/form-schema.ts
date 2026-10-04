// Form Builder per Posisi — skema formulir lamaran yang bisa disusun admin.
// Satu sumber kebenaran untuk: admin builder, API sanitasi, renderer publik,
// validasi submit, tab Jawaban, dan ekspor CSV. File ini CLIENT-SAFE:
// tidak boleh mengimpor modul server-only (db/prisma).
//
// Model mental (v2 — SEMUA bagian bisa diedit & dihapus lewat kunci):
// - Seluruh bagian (Data Diri, Pengalaman, Berkas, dan bagian tambahan) hidup di
//   `Position.formSchema` (JSON string) sebagai `sections` berurutan bebas.
//   Urutan wizard publik = urutan sections di skema (Pratinjau selalu terakhir).
// - NR-23 — bagian bawaan Pengalaman & Berkas bisa "dihapus" lewat mode kunci
//   (konfirmasi mengetik "kunci" di builder) memakai batu nisan (tombstone):
//   section TETAP tersimpan di array dengan `removed: true` sehingga bisa
//   dipulihkan ke posisi aslinya. Bagian bertombstone tidak menghasilkan langkah
//   wizard, getter isinya dianggap mati, dan field di dalamnya tidak divalidasi.
//   Bagian bawaan TIDAK bisa dihapus secara fisik; Biodata tidak bisa dihapus
//   sama sekali (dibutuhkan untuk identitas, duplikat, dan komunikasi).
//   Semua bagian tetap bisa diedit: judul, deskripsi, posisi, dan isi itemnya
//   (WA wajib/tidak, pengalaman & motivasi aktif/tidak, CV/intro/portofolio
//   aktif & wajib/tidak). Bagian yang isinya kosong otomatis dilewati wizard.
// - NR-26 — item inti bagian bawaan kini bisa diedit "seperti biasa": label,
//   placeholder, teks bantuan, dan status wajib (nama tetap wajib — identitas;
//   email WA/pengalaman/motivasi bisa dibuat opsional). Semua kustomisasi
//   disimpan di `section.core` (peta per item inti, kunci hanya ditulis bila
//   beda dari bawaan) dan dihormati wizard publik, validasi server, serta
//   dialog detail admin. Slot berkas tetap memakai flag cvRequired/dll.
// - Kolom Application tetap: name/email/phone (biodata), experience/motivation
//   (pengalaman), cvFileId/introFileId/portfolioUrl (berkas), formAnswers
//   (semua pertanyaan kustom di bagian mana pun, kunci fieldId stabil).
// - Field yang dihapus dipindah ke `retiredFields` agar jawaban lama tetap
//   bisa dirender di tab Jawaban dan CSV.
//
// null pada kolom = mode klasik (wizard lama: screeningQuestions + customDocs).
// Schema aktif = fields.length > 0 ATAU version >= 2 (skema v2 selalu aktif).

export const FORM_SCHEMA_VERSION = 2;

export const FORM_FIELD_TYPES = [
  "text",
  "textarea",
  "radio",
  "checkbox",
  "dropdown",
  "date",
  "number",
  "rating",
  "file",
  "url",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Tipe field berbasis pilihan (punya daftar opsi). */
const CHOICE_TYPES: readonly FormFieldType[] = ["radio", "checkbox", "dropdown"];

export function isChoiceType(type: FormFieldType): boolean {
  return CHOICE_TYPES.includes(type);
}

/* ---------------------------------- Batasan ---------------------------------- */

export const FORM_LIMITS = {
  maxSections: 5, // maks bagian TAMBAHAN (kustom) per skema
  maxTotalSections: 8, // batas total bagian per skema (3 inti + 5 tambahan)
  maxFields: 25,
  maxOptions: 12,
  labelMin: 2,
  labelMax: 200,
  sectionTitleMax: 60,
  sectionDescMax: 200,
  optionMaxLen: 80,
  placeholderMax: 80,
  helpMax: 200,
  schemaMaxBytes: 64 * 1024, // konsisten dengan batas template posisi
  answersMaxBytes: 32 * 1024,
  textDefaultMax: 300,
  textareaDefaultMax: 2000,
  textHardMax: 4000,
  ratingMaxDefault: 5,
  ratingMaxLimit: 10,
  retiredMax: 50,
  fileMaxBytes: 20 * 1024 * 1024, // 20 MB per berkas field form
  checkboxMaxItems: 20,
  numberMax: 1_000_000_000,
} as const;

// Berkas yang boleh diunggah pada field tipe file (lebih longgar dari dokumen bawaan):
// PDF, gambar, Word, audio, dan video pendek (mis. showreel).
export const FORM_FILE_ALLOWED_EXTS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".doc",
  ".docx",
  ".mp3",
  ".wav",
  ".m4a",
  ".webm",
  ".mp4",
  ".mov",
] as const;

const FORM_FILE_ALLOWED_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/x-m4a",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime",
];

export function isAllowedFormFile(file: { type: string; name: string }): boolean {
  if (FORM_FILE_ALLOWED_MIMES.includes(file.type)) return true;
  if (!file.type) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    return (FORM_FILE_ALLOWED_EXTS as readonly string[]).includes(ext);
  }
  return false;
}

/* ----------------------------------- Tipe ----------------------------------- */

export type FormFileValue = { fileId: string; filename: string };

/** Nilai jawaban satu field: teks, daftar (checkbox), angka (rating/number), atau berkas. */
export type FormAnswerValue = string | string[] | number | FormFileValue;

export type FormField = {
  id: string; // stabil — kunci jawaban di Application.formAnswers
  sectionId: string;
  type: FormFieldType;
  label: string;
  required: boolean;
  options: string[]; // radio/checkbox/dropdown
  allowOther: boolean; // opsi "Lainnya" untuk radio/dropdown/checkbox
  placeholder?: string;
  helpText?: string;
  labelEn?: string;
  maxLen?: number; // text/textarea/url
  min?: number; // number
  max?: number; // number & rating (rating = skala 1..max)
};

/** Jenis bagian: tiga bawaan + kustom. Bawaan bisa disembunyikan (tombstone NR-23), kustom bisa dihapus fisik. */
export type FormSectionKind = "biodata" | "experience" | "files" | "custom";

export const FORM_SECTION_KINDS: FormSectionKind[] = ["biodata", "experience", "files", "custom"];

/** ID stabil bagian bawaan — dipakai konsisten saat migrasi & sanitasi. */
export const BIODATA_SECTION_ID = "sec_biodata";
export const EXPERIENCE_SECTION_ID = "sec_experience";
export const FILES_SECTION_ID = "sec_files";

/* ------------------- NR-26 — kustomisasi item inti bawaan ------------------- */

/** Kunci seluruh item inti bagian bawaan (nama stabil, tersimpan di JSON). */
export const CORE_ITEM_KEYS = [
  "name",
  "email",
  "wa",
  "experience",
  "motivation",
  "cv",
  "intro",
  "portfolio",
] as const;

export type CoreItemKey = (typeof CORE_ITEM_KEYS)[number];

/**
 * Kustomisasi satu item inti (NR-26). Semua properti opsional — yang tidak ada
 * berarti memakai perilaku/teks bawaan. `required` hanya dipakai item yang
 * boleh dibuat opsional (email/experience/motivation); slot berkas memakai
 * flag cvRequired/introRequired/portfolioRequired dan WA memakai waRequired.
 * Hanya `required: false` yang pernah disimpan (nilai bawaan = wajib).
 */
export type CoreItemOverride = {
  label?: string;
  placeholder?: string;
  helpText?: string;
  required?: boolean;
};

export type CoreOverrides = Partial<Record<CoreItemKey, CoreItemOverride>>;

/** Item inti milik tiap jenis bagian bawaan (urutan tampil di builder). */
export const CORE_SECTION_ITEM_KEYS: Record<
  Exclude<FormSectionKind, "custom">,
  CoreItemKey[]
> = {
  biodata: ["name", "email", "wa"],
  experience: ["experience", "motivation"],
  files: ["cv", "intro", "portfolio"],
};

/** Label bawaan item inti — fallback bila admin tidak menimpanya. */
export const CORE_ITEM_DEFAULT_LABELS: Record<CoreItemKey, string> = {
  name: "Nama Lengkap",
  email: "Email",
  wa: "Nomor WhatsApp",
  experience: "Pengalaman Kamu",
  motivation: "Alasan Bergabung",
  cv: "CV (PDF, maks 5 MB)",
  intro: "Audio/Video Perkenalan (maks 10 MB)",
  portfolio: "Link Portofolio / Video",
};

/**
 * Baca kustomisasi satu item inti — aman untuk data rusak (selalu objek).
 * Bagian kustom tidak punya item inti (mengembalikan {}).
 */
export function coreItem(section: FormSection, key: CoreItemKey): CoreItemOverride {
  if (section.kind === "custom" || !section.core) return {};
  const item = section.core[key];
  return item && typeof item === "object" ? item : {};
}

/** Label efektif satu item inti: timpaan admin atau label bawaan. */
export function coreItemLabel(section: FormSection, key: CoreItemKey): string {
  const override = coreItem(section, key);
  return override.label && override.label.trim() ? override.label.trim() : CORE_ITEM_DEFAULT_LABELS[key];
}

/**
 * Apakah item inti menimpa label/placeholder/teks bantuan? Dipakai builder
 * untuk menampilkan tombol "pulihkan bawaan" per item.
 */
export function coreItemOverridden(section: FormSection, key: CoreItemKey): boolean {
  const override = coreItem(section, key);
  return Boolean(
    (override.label && override.label.trim()) ||
      (override.placeholder && override.placeholder.trim()) ||
      (override.helpText && override.helpText.trim()),
  );
}

export type FormSection = {
  id: string;
  kind: FormSectionKind;
  title: string;
  description?: string;
  titleEn?: string;

  // Label kustom item inti (absen/kosong = pakai label bawaan FORM_CORE_ITEM_DEFAULTS).
  // NR-23: semua item inti kini bisa diedit penuh — labelnya ikut disimpan di sini.
  nameLabel?: string;       // biodata
  emailLabel?: string;      // biodata
  waLabel?: string;         // biodata
  experienceLabel?: string; // experience
  motivationLabel?: string; // experience
  cvLabel?: string;         // files
  introLabel?: string;      // files
  portfolioLabel?: string;  // files

  // Konfigurasi item inti (boleh tidak ada = pakai nilai bawaan):
  // biodata — WA boleh tidak wajib (nama & email selalu wajib, identitas pelamar).
  waRequired?: boolean;
  // experience — dua pertanyaan inti bisa dimatikan & diatur wajib satu per satu.
  experienceEnabled?: boolean;
  experienceRequired?: boolean; // NR-23 — default true (perilaku lama)
  motivationEnabled?: boolean;
  motivationRequired?: boolean; // NR-23 — default true (perilaku lama)
  // files — tiga slot berkas bawaan bisa dimatikan; wajib hanya berlaku saat aktif.
  cvEnabled?: boolean;
  cvRequired?: boolean;
  introEnabled?: boolean;
  introRequired?: boolean;
  portfolioEnabled?: boolean;
  portfolioRequired?: boolean;

  // NR-23 — batu nisan bagian bawaan — true = dihapus via mode kunci, masih
  // tersimpan agar bisa dipulihkan. Hanya kind experience/files yang boleh
  // membawa flag ini (biodata selalu hadir, kustom dihapus fisik). Saat
  // false/undefined kunci dihilangkan dari JSON agar tetap ramping.
  removed?: boolean;

  // NR-26 — kustomisasi item inti bagian bawaan (label/placeholder/teks
  // bantuan/status wajib per item). Tidak ada = semua memakai teks bawaan.
  core?: CoreOverrides;
};

/** Bagian bawaan (bukan tambahan kustom). Dipakai builder untuk membedakan aturan hapus. */
export function isBuiltinSection(section: FormSection): boolean {
  return section.kind !== "custom";
}

export type RetiredFormField = { id: string; label: string };

export type FormSchema = {
  version: number;
  sections: FormSection[];
  fields: FormField[];
  retiredFields: RetiredFormField[];
};

/** Nilai jawaban yang disimpan hanya dari tipe yang dikenal. */
function isKnownFieldType(type: unknown): type is FormFieldType {
  return (FORM_FIELD_TYPES as readonly string[]).includes(String(type));
}

/* ------------------------------ Bagian bawaan ------------------------------ */

/** Label singkat jenis bagian untuk UI admin (Indonesia). */
export const FORM_SECTION_KIND_LABELS: Record<FormSectionKind, string> = {
  biodata: "Data Diri",
  experience: "Pengalaman",
  files: "Berkas",
  custom: "Tambahan",
};

export function defaultBiodataSection(): FormSection {
  return {
    id: BIODATA_SECTION_ID,
    kind: "biodata",
    title: "Data Diri",
    titleEn: "Personal Details",
    waRequired: true,
  };
}

export function defaultExperienceSection(): FormSection {
  return {
    id: EXPERIENCE_SECTION_ID,
    kind: "experience",
    title: "Pengalaman",
    titleEn: "Experience",
    experienceEnabled: true,
    motivationEnabled: true,
  };
}

export function defaultFilesSection(files?: {
  requireCv?: boolean;
  requireIntro?: boolean;
  requirePortfolio?: boolean;
}): FormSection {
  return {
    id: FILES_SECTION_ID,
    kind: "files",
    title: "Berkas",
    titleEn: "Documents",
    cvEnabled: true,
    cvRequired: files?.requireCv === true,
    introEnabled: true,
    introRequired: files?.requireIntro === true,
    portfolioEnabled: true,
    portfolioRequired: files?.requirePortfolio === true,
  };
}

/* --------------------- Getter konfigurasi (aman & konsisten) --------------------- */
// Nilai tidak ada = pakai perilaku lama (legacy): WA wajib, pengalaman & motivasi
// aktif, CV/intro/portofolio tampil (opsional kecuali diatur wajib).

export function isWaRequired(section: FormSection): boolean {
  return section.kind !== "biodata" || section.waRequired !== false;
}

// NR-23 — getter di bawah menganggap bagian bertombstone (removed=true) mati
// total: wizard tidak menampilkan langkahnya, jadi isi apa pun di dalamnya
// (flag aktif/wajib) harus dianggap tidak berlaku di semua konsumen.

export function isExperienceEnabled(section: FormSection): boolean {
  return (
    section.kind === "experience" &&
    section.removed !== true &&
    section.experienceEnabled !== false
  );
}

/**
 * NR-26 — status wajib item inti kini dibaca dari section.core (editor item
 * inti di Form Builder). Gerbang enabled (NR-23) tetap dihormati: item yang
 * dimatikan/di-hash selalu dianggap tidak wajib. Nama selalu wajib (identitas
 * pelamar) sehingga tidak punya getter.
 */
export function isEmailRequired(section: FormSection): boolean {
  return section.kind !== "biodata" || coreItem(section, "email").required !== false;
}

export function isExperienceRequired(section: FormSection): boolean {
  return isExperienceEnabled(section) && coreItem(section, "experience").required !== false;
}

export function isMotivationEnabled(section: FormSection): boolean {
  return (
    section.kind === "experience" &&
    section.removed !== true &&
    section.motivationEnabled !== false
  );
}

export function isMotivationRequired(section: FormSection): boolean {
  return isMotivationEnabled(section) && coreItem(section, "motivation").required !== false;
}

export function isCvEnabled(section: FormSection): boolean {
  return section.kind === "files" && section.removed !== true && section.cvEnabled !== false;
}

export function isCvRequired(section: FormSection): boolean {
  return isCvEnabled(section) && section.cvRequired === true;
}

export function isIntroEnabled(section: FormSection): boolean {
  return section.kind === "files" && section.removed !== true && section.introEnabled !== false;
}

export function isIntroRequired(section: FormSection): boolean {
  return isIntroEnabled(section) && section.introRequired === true;
}

export function isPortfolioEnabled(section: FormSection): boolean {
  return section.kind === "files" && section.removed !== true && section.portfolioEnabled !== false;
}

export function isPortfolioRequired(section: FormSection): boolean {
  return isPortfolioEnabled(section) && section.portfolioRequired === true;
}

/** Semua field milik satu bagian (urut sesuai array fields). */
export function sectionFields(schema: FormSchema, sectionId: string): FormField[] {
  return schema.fields.filter((f) => f.sectionId === sectionId);
}

/**
 * Apakah bagian ini menghasilkan satu langkah wizard publik?
 * Bagian bawaan yang seluruh isinya dimatikan dan tanpa pertanyaan tambahan
 * dilewati (tidak muncul di wizard). Bagian bertombstone (NR-23, removed=true)
 * juga tidak menghasilkan langkah — field lamanya tetap tersimpan di skema.
 */
export function sectionHasStep(schema: FormSchema, section: FormSection): boolean {
  if (section.removed === true) return false;
  const fields = sectionFields(schema, section.id);
  switch (section.kind) {
    case "biodata":
      return true; // identitas selalu ada
    case "experience":
      return isExperienceEnabled(section) || isMotivationEnabled(section) || fields.length > 0;
    case "files":
      return (
        isCvEnabled(section) || isIntroEnabled(section) || isPortfolioEnabled(section) || fields.length > 0
      );
    default:
      return fields.length > 0;
  }
}

/**
 * Konversi konfigurasi bagian Berkas menjadi kolom Position.requireCv/requireIntro/
 * requirePortfolio agar fitur lama (kartu Ketentuan, prompt AI) tetap konsisten.
 * "Wajib" hanya berlaku bila slotnya aktif.
 */
export function filesConfigFromSchema(schema: FormSchema): {
  requireCv: boolean;
  requireIntro: boolean;
  requirePortfolio: boolean;
} {
  const files = schema.sections.find((s) => s.kind === "files");
  // NR-23 — bagian Berkas yang dihapus (tombstone) menyinkronkan kolom posisi
  // ke false: slot isinya dianggap mati walau flag lama masih tersimpan untuk
  // keperluan pemulihan.
  if (!files || files.removed === true) {
    return { requireCv: false, requireIntro: false, requirePortfolio: false };
  }
  return {
    requireCv: isCvRequired(files),
    requireIntro: isIntroRequired(files),
    requirePortfolio: isPortfolioRequired(files),
  };
}

/* ------------------------------- ID generator -------------------------------- */

const ID_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/i;

/** ID field/section baru yang aman untuk kunci jawaban (dipakai builder di klien). */
export function newFormId(prefix: string): string {
  const rand = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 36).toString(36),
  ).join("");
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

/* ---------------------------------- Parser ---------------------------------- */

/** Jenis bagian dari input mentah: valid, atau ditebak dari id bawaan, atau kustom. */
function parseSectionKind(value: unknown, id: string): FormSectionKind {
  if (typeof value === "string" && (FORM_SECTION_KINDS as readonly string[]).includes(value)) {
    return value as FormSectionKind;
  }
  if (id === BIODATA_SECTION_ID) return "biodata";
  if (id === EXPERIENCE_SECTION_ID) return "experience";
  if (id === FILES_SECTION_ID) return "files";
  return "custom";
}

/**
 * Flag boolean satu bagian dinormalisasi eksplisit (tanpa undefined).
 * NR-23 — flag tombstone `removed` dipertahankan HANYA untuk bagian bawaan
 * Pengalaman & Berkas: biodata tidak pernah boleh dihapus (identitas & deteksi
 * duplikat), dan bagian kustom tetap dihapus fisik — flag dari klien untuk
 * keduanya dibuang di sini (satu titik untuk parse & sanitasi).
 */
function normalizeSectionFlags(section: FormSection, raw: Record<string, unknown>): FormSection {
  if (
    (section.kind === "experience" || section.kind === "files") &&
    raw.removed === true
  ) {
    section.removed = true;
  }
  if (section.kind === "biodata") {
    section.waRequired = raw.waRequired !== false;
  }
  if (section.kind === "experience") {
    section.experienceEnabled = raw.experienceEnabled !== false;
    section.experienceRequired = section.experienceEnabled && raw.experienceRequired !== false;
    section.motivationEnabled = raw.motivationEnabled !== false;
    section.motivationRequired = section.motivationEnabled && raw.motivationRequired !== false;
  }
  if (section.kind === "files") {
    section.cvEnabled = raw.cvEnabled !== false;
    section.cvRequired = section.cvEnabled && raw.cvRequired === true;
    section.introEnabled = raw.introEnabled !== false;
    section.introRequired = section.introEnabled && raw.introRequired === true;
    section.portfolioEnabled = raw.portfolioEnabled !== false;
    section.portfolioRequired = section.portfolioEnabled && raw.portfolioRequired === true;
  }
  // NR-26 — kustomisasi item inti: dinormalisasi di titik temu parse &
  // sanitasi agar JSON tersimpan selalu bersih (kunci asing dibuang,
  // teks dipotong sesuai batas, nama dipaksa tetap wajib).
  const core = normalizeCoreOverrides(section.kind, raw.core);
  if (core) section.core = core;
  return section;
}

/**
 * NR-26 — normalisasi peta kustomisasi item inti dari input mentah (parse
 * maupun sanitasi). Kunci yang bukan item inti milik jenis bagian ini
 * dibuang; teks ditrim & dipotong sesuai batas; `required` hanya dipertahankan
 * sebagai false (nilai bawaan = wajib) dan nama tidak pernah opsional.
 * Hasil kosong = undefined (JSON tetap ramping).
 */
function normalizeCoreOverrides(
  kind: FormSectionKind,
  rawCore: unknown,
): CoreOverrides | undefined {
  if (kind === "custom") return undefined;
  if (!rawCore || typeof rawCore !== "object" || Array.isArray(rawCore)) return undefined;
  const allowed = CORE_SECTION_ITEM_KEYS[kind];
  const source = rawCore as Record<string, unknown>;
  const out: CoreOverrides = {};
  for (const key of allowed) {
    const value = source[key];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const override: CoreItemOverride = {};
    const label = typeof item.label === "string" ? item.label.trim().slice(0, FORM_LIMITS.labelMax) : "";
    if (label) override.label = label;
    const placeholder =
      typeof item.placeholder === "string" ? item.placeholder.trim().slice(0, FORM_LIMITS.placeholderMax) : "";
    if (placeholder) override.placeholder = placeholder;
    const helpText =
      typeof item.helpText === "string" ? item.helpText.trim().slice(0, FORM_LIMITS.helpMax) : "";
    if (helpText) override.helpText = helpText;
    if (key !== "name" && item.required === false) override.required = false;
    if (Object.keys(override).length > 0) out[key] = override;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Parse skema dari kolom DB — toleran terhadap data rusak (null bila tidak layak). */
export function parseFormSchema(raw: string | null | undefined): FormSchema | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  const sectionsRaw = Array.isArray(obj.sections) ? obj.sections : [];
  const fieldsRaw = Array.isArray(obj.fields) ? obj.fields : [];
  const retiredRaw = Array.isArray(obj.retiredFields) ? obj.retiredFields : [];

  const sections: FormSection[] = [];
  const seenSections = new Set<string>();
  for (const item of sectionsRaw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const id = typeof s.id === "string" && ID_RE.test(s.id) ? s.id : "";
    const title = typeof s.title === "string" ? s.title.trim().slice(0, FORM_LIMITS.sectionTitleMax) : "";
    if (!id || !title || seenSections.has(id)) continue;
    seenSections.add(id);
    const section: FormSection = { id, kind: parseSectionKind(s.kind, id), title };
    const desc = typeof s.description === "string" ? s.description.trim().slice(0, FORM_LIMITS.sectionDescMax) : "";
    if (desc) section.description = desc;
    const titleEn = typeof s.titleEn === "string" ? s.titleEn.trim().slice(0, FORM_LIMITS.sectionTitleMax) : "";
    if (titleEn) section.titleEn = titleEn;
    sections.push(normalizeSectionFlags(section, s));
    pickCoreLabels(section, s, false);
  }

  const fields: FormField[] = [];
  const seenFields = new Set<string>();
  for (const item of fieldsRaw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const id = typeof f.id === "string" && ID_RE.test(f.id) ? f.id : "";
    const label = typeof f.label === "string" ? f.label.trim().slice(0, FORM_LIMITS.labelMax) : "";
    if (!id || !label || seenFields.has(id)) continue;
    if (!seenSections.has(f.sectionId as string)) continue;
    if (!isKnownFieldType(f.type)) continue;
    seenFields.add(id);
    const type = f.type;
    const field: FormField = {
      id,
      sectionId: f.sectionId as string,
      type,
      label,
      required: f.required === true,
      options: [],
      allowOther: f.allowOther === true,
    };
    if (isChoiceType(type) && Array.isArray(f.options)) {
      field.options = f.options
        .filter((o): o is string => typeof o === "string")
        .map((o) => o.trim())
        .filter((o) => o.length > 0)
        .slice(0, FORM_LIMITS.maxOptions)
        .map((o) => o.slice(0, FORM_LIMITS.optionMaxLen));
    }
    const placeholder = typeof f.placeholder === "string" ? f.placeholder.trim().slice(0, FORM_LIMITS.placeholderMax) : "";
    if (placeholder) field.placeholder = placeholder;
    const helpText = typeof f.helpText === "string" ? f.helpText.trim().slice(0, FORM_LIMITS.helpMax) : "";
    if (helpText) field.helpText = helpText;
    const labelEn = typeof f.labelEn === "string" ? f.labelEn.trim().slice(0, FORM_LIMITS.labelMax) : "";
    if (labelEn) field.labelEn = labelEn;
    if ((type === "text" || type === "textarea" || type === "url") && typeof f.maxLen === "number" && Number.isFinite(f.maxLen)) {
      field.maxLen = Math.min(FORM_LIMITS.textHardMax, Math.max(1, Math.round(f.maxLen)));
    }
    if (type === "number") {
      if (typeof f.min === "number" && Number.isFinite(f.min)) field.min = f.min;
      if (typeof f.max === "number" && Number.isFinite(f.max)) field.max = f.max;
      if (field.min != null && field.max != null && field.min > field.max) {
        const swap = field.min;
        field.min = field.max;
        field.max = swap;
      }
    }
    if (type === "rating" && typeof f.max === "number" && Number.isFinite(f.max)) {
      field.max = Math.min(FORM_LIMITS.ratingMaxLimit, Math.max(2, Math.round(f.max)));
    }
    fields.push(field);
  }

  const version = typeof obj.version === "number" && Number.isFinite(obj.version) ? obj.version : 1;
  // NR-23 — skema v2 boleh kosong (semua bagian inti dihapus admin; identitas
  // tetap dikumpulkan wizard). Skema v1/tanpa versi yang kosong tetap dianggap
  // rusak (null → mode klasik).
  if (sections.length === 0 && fields.length === 0 && version < FORM_SCHEMA_VERSION) return null;

  const retiredFields: RetiredFormField[] = [];
  const seenRetired = new Set<string>();
  for (const item of retiredRaw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const id = typeof r.id === "string" && ID_RE.test(r.id) ? r.id : "";
    const label = typeof r.label === "string" ? r.label.trim().slice(0, FORM_LIMITS.labelMax) : "";
    if (!id || !label || seenRetired.has(id) || seenFields.has(id)) continue;
    seenRetired.add(id);
    retiredFields.push({ id, label });
  }

  return { version, sections, fields, retiredFields };
}

/* --------------------------------- Normalisasi --------------------------------- */

/**
 * Normalisasi skema APAPUN (v1 lama atau v2 rusak) menjadi bentuk v2 lengkap:
 * ketiga bagian bawaan dijamin ada, urutan bagian kustom dipertahankan.
 * `filesFallback` dipakai saat migrasi skema v1 agar konfigurasi berkas
 * mengikuti kolom Position.requireCv/requireIntro/requirePortfolio yang lama.
 * Tidak mengubah data tersimpan — hanya bentuk di memori untuk semua konsumen.
 */
export function normalizeFormSchema(
  schema: FormSchema | null,
  filesFallback?: { requireCv?: boolean; requireIntro?: boolean; requirePortfolio?: boolean },
): FormSchema | null {
  if (!schema) return null;
  // NR-23 — batu nisan tidak dihidupkan ulang: bagian bawaan yang ADA di array
  // (meski removed=true) dianggap hadir, jadi tidak pernah disisipkan ulang.
  // Pengecualian biodata: flag removed pada biodata (data rusak) dibuang agar
  // fungsi ini tidak pernah mengembalikan biodata yang "hilang".
  const hasBiodataTombstone = schema.sections.some(
    (s) => s.kind === "biodata" && s.removed === true,
  );
  const clean: FormSchema = hasBiodataTombstone
    ? {
        ...schema,
        sections: schema.sections.map((s) =>
          s.kind === "biodata" ? { ...s, removed: undefined } : s,
        ),
      }
    : schema;
  const hasKind = (kind: FormSectionKind) => clean.sections.some((s) => s.kind === kind);
  if (
    clean.version >= FORM_SCHEMA_VERSION &&
    hasKind("biodata") &&
    hasKind("experience") &&
    hasKind("files")
  ) {
    return clean;
  }

  // Rakit ulang: sisipkan bagian bawaan yang hilang, pertahankan bagian lain
  // (termasuk tombstone Pengalaman/Berkas — tetap di posisi array-nya).
  const taken = new Set(clean.sections.map((s) => s.id));
  const freeId = (base: string): string => {
    let id = base;
    let i = 2;
    while (taken.has(id)) id = `${base}_${i++}`;
    taken.add(id);
    return id;
  };

  const firstOfKind = (kind: FormSectionKind) => clean.sections.find((s) => s.kind === kind);
  const biodata = firstOfKind("biodata") ?? defaultBiodataSection();
  if (!firstOfKind("biodata")) biodata.id = freeId(BIODATA_SECTION_ID);
  const experience = firstOfKind("experience") ?? defaultExperienceSection();
  if (!firstOfKind("experience")) experience.id = freeId(EXPERIENCE_SECTION_ID);
  // filesFallback hanya dipakai saat bagian Berkas BENAR-BENAR tidak ada
  // (migrasi v1) — tombstone Berkas tetap membawa flag lamanya untuk pemulihan
  // dan TIDAK pernah diisi ulang dari kolom posisi yang mungkin basi.
  const files = firstOfKind("files") ?? defaultFilesSection(filesFallback);
  if (!firstOfKind("files")) files.id = freeId(FILES_SECTION_ID);

  const bawaanIds = new Set([biodata.id, experience.id, files.id]);
  // Duplikat bagian bawaan yang tersisa (data rusak) diturunkan jadi bagian kustom.
  const others = clean.sections
    .filter((s) => !bawaanIds.has(s.id))
    .map((s) => (s.kind === "custom" ? s : { ...s, kind: "custom" as const }));

  return {
    version: FORM_SCHEMA_VERSION,
    sections: [biodata, experience, ...others, files],
    fields: clean.fields,
    retiredFields: clean.retiredFields,
  };
}

/** Parse jawaban formulir pelamar dari kolom DB — toleran terhadap data rusak. */
export function parseFormAnswers(
  raw: string | null | undefined,
): Record<string, FormAnswerValue> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, FormAnswerValue> = {};
  const LIMIT = FORM_LIMITS;
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!ID_RE.test(key)) continue;
    if (typeof value === "string") {
      out[key] = value.slice(0, LIMIT.textHardMax);
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const items = value
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.slice(0, LIMIT.optionMaxLen))
        .slice(0, LIMIT.checkboxMaxItems);
      if (items.length > 0) out[key] = items;
      continue;
    }
    if (value && typeof value === "object") {
      const f = value as Record<string, unknown>;
      const fileId = typeof f.fileId === "string" ? f.fileId.slice(0, 60) : "";
      const filename = typeof f.filename === "string" ? f.filename.slice(0, 200) : "";
      if (fileId) out[key] = { fileId, filename };
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/* ------------------------- Skema bawaan (migrasi otomatis) ------------------------- */

type SimpleQuestion = { id: string; label: string; required: boolean };

/**
 * Bangun skema awal dari pengaturan klasik posisi (screeningQuestions + customDocs).
 * Dipakai saat admin membuka builder dan posisi masih mode klasik — draf awal
 * siap diedit; TIDAK tersimpan sebelum admin menekan Simpan.
 * Hasil sudah v2: ketiga bagian bawaan ikut hadir dan bisa langsung diedit.
 */
export function buildDefaultSchema(input: {
  screeningQuestions: SimpleQuestion[];
  customDocs: string[];
  requireCv?: boolean;
  requireIntro?: boolean;
  requirePortfolio?: boolean;
}): FormSchema {
  const sections: FormSection[] = [defaultBiodataSection(), defaultExperienceSection()];
  const fields: FormField[] = [];

  const questions = input.screeningQuestions.slice(0, FORM_LIMITS.maxFields);
  const docs = input.customDocs
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, FORM_LIMITS.maxFields - questions.length);

  if (questions.length > 0) {
    const sectionId = `sec_pertanyaan_${Date.now().toString(36)}`;
    sections.push({ id: sectionId, kind: "custom", title: "Pertanyaan Screening" });
    questions.forEach((q, index) => {
      fields.push({
        id: `sq_${q.id || index + 1}`,
        sectionId,
        type: "text",
        label: q.label,
        required: q.required === true,
        options: [],
        allowOther: false,
        maxLen: 500,
      });
    });
  }

  if (docs.length > 0) {
    const sectionId = `sec_dokumen_${Date.now().toString(36)}`;
    sections.push({ id: sectionId, kind: "custom", title: "Dokumen Tambahan" });
    docs.forEach((label, index) => {
      fields.push({
        id: `doc_${index + 1}_${Date.now().toString(36)}`,
        sectionId,
        type: "file",
        label,
        required: true,
        options: [],
        allowOther: false,
      });
    });
  }

  sections.push(defaultFilesSection(input));
  return { version: FORM_SCHEMA_VERSION, sections, fields, retiredFields: [] };
}

/* --------------------------------- Sanitasi --------------------------------- */

export type FormSchemaSanitizeResult =
  | { ok: true; value?: string | null } // undefined = tidak dikirim (konvensi PATCH)
  | { ok: false; error: string };

/**
 * Sanitasi input skema dari admin (PUT /form atau PATCH posisi).
 * - null/""  -> null (kembali ke mode klasik)
 * - objek    -> JSON string v2 yang sudah bersih (version dipaksa 2)
 * Ketiga bagian bawaan dijamin ada (disisipkan otomatis bila klien lupa),
 * urutan bagian dari klien dipertahankan apa adanya. NR-23: tombstone
 * (`removed: true`) dipertahankan untuk Pengalaman & Berkas — bagian yang ada
 * tapi bertombstone TETAP dianggap hadir (aturan "hanya boleh satu" lolos dan
 * tidak disisipkan ulang); biodata selalu hadir tanpa tombstone, bagian
 * kustom dihapus fisik (flag removed-nya dibuang). Retired fields otomatis
 * digabung dari previousSchemaRaw (field lama yang hilang dipindah ke makam,
 * bukan dihapus, agar jawaban lama tetap terbaca).
 */
export function sanitizeFormSchemaInput(
  value: unknown,
  opts: { previousSchemaRaw?: string | null } = {},
): FormSchemaSanitizeResult {
  if (value === undefined) return { ok: true };
  if (value === null || value === "") {
    return { ok: true, value: null };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Skema formulir tidak valid." };
  }
  const LIMIT = FORM_LIMITS;
  const obj = value as Record<string, unknown>;

  // Sections
  if (!Array.isArray(obj.sections)) return { ok: false, error: "Bagian formulir harus berupa daftar." };
  if (obj.sections.length > LIMIT.maxTotalSections) {
    return { ok: false, error: `Maksimal ${LIMIT.maxTotalSections} bagian formulir.` };
  }

  const sections: FormSection[] = [];
  const sectionIds = new Set<string>();
  const seenKinds = new Set<FormSectionKind>();
  let customCount = 0;
  for (let i = 0; i < obj.sections.length; i++) {
    const raw = obj.sections[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `Bagian #${i + 1} tidak valid.` };
    }
    const s = raw as Record<string, unknown>;
    const id = typeof s.id === "string" && ID_RE.test(s.id) ? s.id : "";
    if (!id) return { ok: false, error: `Bagian #${i + 1} butuh ID yang valid.` };
    if (sectionIds.has(id)) return { ok: false, error: `ID bagian "${id}" ganda.` };
    const kind = parseSectionKind(s.kind, id);
    if (kind !== "custom") {
      if (seenKinds.has(kind)) {
        return {
          ok: false,
          error: `Bagian bawaan "${FORM_SECTION_KIND_LABELS[kind]}" hanya boleh satu.`,
        };
      }
      seenKinds.add(kind);
    } else {
      customCount += 1;
      if (customCount > LIMIT.maxSections) {
        return { ok: false, error: `Maksimal ${LIMIT.maxSections} bagian tambahan.` };
      }
    }
    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (title.length < 1 || title.length > LIMIT.sectionTitleMax) {
      return { ok: false, error: `Judul bagian #${i + 1} harus 1-${LIMIT.sectionTitleMax} karakter.` };
    }
    const section: FormSection = { id, kind, title };
    const desc = typeof s.description === "string" ? s.description.trim() : "";
    if (desc) {
      if (desc.length > LIMIT.sectionDescMax) {
        return { ok: false, error: `Deskripsi bagian "${title}" maksimal ${LIMIT.sectionDescMax} karakter.` };
      }
      section.description = desc;
    }
    const titleEn = typeof s.titleEn === "string" ? s.titleEn.trim() : "";
    if (titleEn) {
      if (titleEn.length > LIMIT.sectionTitleMax) {
        return { ok: false, error: `Judul EN bagian "${title}" maksimal ${LIMIT.sectionTitleMax} karakter.` };
      }
      section.titleEn = titleEn;
    }
    sectionIds.add(id);
    sections.push(normalizeSectionFlags(section, s));
    const labelError = pickCoreLabels(section, s, true);
    if (labelError) return { ok: false, error: labelError };
  }

  // Jaminan bawaan: biodata di depan, pengalaman setelahnya, berkas di akhir.
  // NR-23 — bagian bawaan bertombstone tetap dihitung hadir (ada di array),
  // jadi blok ini hanya menyisipkan bila kind-nya benar-benar tidak ada.
  if (!seenKinds.has("biodata")) sections.unshift(defaultBiodataSection());
  if (!seenKinds.has("experience")) sections.splice(1, 0, defaultExperienceSection());
  if (!seenKinds.has("files")) sections.push(defaultFilesSection());

  // Fields
  if (!Array.isArray(obj.fields)) return { ok: false, error: "Pertanyaan formulir harus berupa daftar." };
  if (obj.fields.length > LIMIT.maxFields) {
    return { ok: false, error: `Maksimal ${LIMIT.maxFields} pertanyaan formulir.` };
  }
  const fields: FormField[] = [];
  const fieldIds = new Set<string>();
  for (let i = 0; i < obj.fields.length; i++) {
    const raw = obj.fields[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `Pertanyaan #${i + 1} tidak valid.` };
    }
    const f = raw as Record<string, unknown>;
    const id = typeof f.id === "string" && ID_RE.test(f.id) ? f.id : "";
    if (!id) return { ok: false, error: `Pertanyaan #${i + 1} butuh ID yang valid.` };
    if (fieldIds.has(id)) return { ok: false, error: `ID pertanyaan "${id}" ganda.` };
    const sectionId = typeof f.sectionId === "string" ? f.sectionId : "";
    if (!sectionIds.has(sectionId)) {
      return { ok: false, error: `Pertanyaan "${id}" harus menunjuk bagian yang ada.` };
    }
    if (!isKnownFieldType(f.type)) return { ok: false, error: `Tipe pertanyaan #${i + 1} tidak dikenal.` };
    const type = f.type;
    const label = typeof f.label === "string" ? f.label.trim() : "";
    if (label.length < LIMIT.labelMin || label.length > LIMIT.labelMax) {
      return { ok: false, error: `Label pertanyaan #${i + 1} harus ${LIMIT.labelMin}-${LIMIT.labelMax} karakter.` };
    }

    const field: FormField = {
      id,
      sectionId,
      type,
      label,
      required: f.required === true,
      options: [],
      allowOther: false,
    };

    if (isChoiceType(type)) {
      if (!Array.isArray(f.options)) return { ok: false, error: `Pertanyaan "${label}" butuh daftar opsi.` };
      const options: string[] = [];
      for (const opt of f.options) {
        if (typeof opt !== "string") return { ok: false, error: `Opsi pertanyaan "${label}" harus teks.` };
        const trimmed = opt.trim();
        if (!trimmed) continue;
        if (trimmed.length > LIMIT.optionMaxLen) {
          return { ok: false, error: `Opsi pertanyaan "${label}" maksimal ${LIMIT.optionMaxLen} karakter.` };
        }
        if (!options.includes(trimmed)) options.push(trimmed);
        if (options.length > LIMIT.maxOptions) {
          return { ok: false, error: `Pertanyaan "${label}" maksimal ${LIMIT.maxOptions} opsi.` };
        }
      }
      if (options.length === 0) {
        return { ok: false, error: `Pertanyaan "${label}" butuh minimal 1 opsi.` };
      }
      field.options = options;
      field.allowOther = f.allowOther === true;
    }

    const placeholder = typeof f.placeholder === "string" ? f.placeholder.trim() : "";
    if (placeholder) {
      if (placeholder.length > LIMIT.placeholderMax) {
        return { ok: false, error: `Placeholder "${label}" maksimal ${LIMIT.placeholderMax} karakter.` };
      }
      field.placeholder = placeholder;
    }
    const helpText = typeof f.helpText === "string" ? f.helpText.trim() : "";
    if (helpText) {
      if (helpText.length > LIMIT.helpMax) {
        return { ok: false, error: `Bantuan "${label}" maksimal ${LIMIT.helpMax} karakter.` };
      }
      field.helpText = helpText;
    }
    const labelEn = typeof f.labelEn === "string" ? f.labelEn.trim() : "";
    if (labelEn) {
      if (labelEn.length > LIMIT.labelMax) {
        return { ok: false, error: `Label EN "${label}" maksimal ${LIMIT.labelMax} karakter.` };
      }
      field.labelEn = labelEn;
    }

    if (type === "text" || type === "textarea" || type === "url") {
      if (typeof f.maxLen === "number" && Number.isFinite(f.maxLen)) {
        const maxLen = Math.round(f.maxLen);
        if (maxLen < 1 || maxLen > LIMIT.textHardMax) {
          return { ok: false, error: `Batas karakter "${label}" harus 1-${LIMIT.textHardMax}.` };
        }
        field.maxLen = maxLen;
      }
    }
    if (type === "number") {
      const min = typeof f.min === "number" && Number.isFinite(f.min) ? f.min : undefined;
      const max = typeof f.max === "number" && Number.isFinite(f.max) ? f.max : undefined;
      if (min != null && Math.abs(min) > LIMIT.numberMax) return { ok: false, error: `Nilai minimum "${label}" terlalu besar.` };
      if (max != null && Math.abs(max) > LIMIT.numberMax) return { ok: false, error: `Nilai maksimum "${label}" terlalu besar.` };
      if (min != null && max != null && min > max) {
        return { ok: false, error: `Minimum tidak boleh lebih besar dari maksimum pada "${label}".` };
      }
      if (min != null) field.min = min;
      if (max != null) field.max = max;
    }
    if (type === "rating") {
      const max = typeof f.max === "number" && Number.isFinite(f.max) ? Math.round(f.max) : LIMIT.ratingMaxDefault;
      if (max < 2 || max > LIMIT.ratingMaxLimit) {
        return { ok: false, error: `Skala "${label}" harus 2-${LIMIT.ratingMaxLimit}.` };
      }
      field.max = max;
    }

    fieldIds.add(id);
    fields.push(field);
  }

  // Gabungkan retired fields: field lama yang hilang dari skema baru.
  const retiredFields: RetiredFormField[] = [];
  const retiredSeen = new Set<string>();
  const previous = parseFormSchema(opts.previousSchemaRaw ?? null);
  if (previous) {
    for (const old of [...previous.fields, ...previous.retiredFields]) {
      if (fieldIds.has(old.id) || retiredSeen.has(old.id)) continue;
      retiredSeen.add(old.id);
      retiredFields.push({ id: old.id, label: old.label });
      if (retiredFields.length >= LIMIT.retiredMax) break;
    }
  }

  const schema: FormSchema = {
    version: FORM_SCHEMA_VERSION,
    sections,
    fields,
    retiredFields,
  };
  const json = JSON.stringify(schema);
  if (Buffer.byteLength(json, "utf8") > LIMIT.schemaMaxBytes) {
    return { ok: false, error: "Skema formulir terlalu besar. Kurangi jumlah pertanyaan atau teksnya." };
  }
  return { ok: true, value: json };
}

/* ----------------------------- Validasi jawaban ----------------------------- */

export type FormAnswersValidateResult =
  | { ok: true; cleaned: Record<string, FormAnswerValue> }
  | { ok: false; error: string };

/**
 * Validasi jawaban formulir dari pelamar terhadap skema (SERVER-side).
 * Field tipe file divalidasi terpisah oleh route (butuh objek File).
 * Nilai "Lainnya" pada pilihan dikirim klien sebagai teks bebas; server
 * menerimanya bila allowOther aktif.
 */
export function validateFormAnswers(
  schema: FormSchema,
  raw: unknown,
): FormAnswersValidateResult {
  const LIMIT = FORM_LIMITS;
  if (raw == null) raw = {};
  // NR-23 — field milik bagian yang dihapus (tombstone removed=true) tidak
  // divalidasi: bagian itu tidak muncul di wizard sehingga pelamar tidak punya
  // jawabannya. Jawaban lama yang tersimpan tetap terbaca di tab Jawaban.
  const deadSections = new Set(
    schema.sections.filter((s) => s.removed === true).map((s) => s.id),
  );
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Format jawaban formulir tidak valid." };
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Format jawaban formulir tidak valid." };
  }
  const input = raw as Record<string, unknown>;
  const cleaned: Record<string, FormAnswerValue> = {};

  for (const field of schema.fields) {
    if (field.type === "file") continue; // ditangani route (upload)
    if (deadSections.has(field.sectionId)) continue; // NR-23 — bagian dihapus
    const value = input[field.id];
    const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);

    if (field.required && empty) {
      return { ok: false, error: `Jawaban untuk "${field.label}" wajib diisi.` };
    }
    if (empty) continue;

    if (field.type === "text" || field.type === "textarea" || field.type === "url") {
      if (typeof value !== "string") return { ok: false, error: `Jawaban "${field.label}" harus teks.` };
      const text = value.trim();
      const maxLen = field.maxLen ?? (field.type === "textarea" ? LIMIT.textareaDefaultMax : LIMIT.textDefaultMax);
      if (text.length > maxLen) {
        return { ok: false, error: `Jawaban "${field.label}" maksimal ${maxLen} karakter.` };
      }
      if (field.type === "url" && !/^https?:\/\//i.test(text)) {
        return { ok: false, error: `"${field.label}" harus diawali http:// atau https://.` };
      }
      cleaned[field.id] = text;
      continue;
    }

    if (field.type === "number") {
      const num = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
      if (!Number.isFinite(num)) return { ok: false, error: `Jawaban "${field.label}" harus berupa angka.` };
      if (field.min != null && num < field.min) {
        return { ok: false, error: `Jawaban "${field.label}" minimal ${field.min}.` };
      }
      if (field.max != null && num > field.max) {
        return { ok: false, error: `Jawaban "${field.label}" maksimal ${field.max}.` };
      }
      cleaned[field.id] = num;
      continue;
    }

    if (field.type === "rating") {
      const num = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (!Number.isInteger(num) || num < 1 || num > (field.max ?? LIMIT.ratingMaxDefault)) {
        return { ok: false, error: `Skor "${field.label}" harus 1-${field.max ?? LIMIT.ratingMaxDefault}.` };
      }
      cleaned[field.id] = num;
      continue;
    }

    if (field.type === "date") {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
        return { ok: false, error: `Jawaban "${field.label}" harus tanggal yang valid.` };
      }
      cleaned[field.id] = value.trim();
      continue;
    }

    if (field.type === "radio" || field.type === "dropdown") {
      if (typeof value !== "string") return { ok: false, error: `Jawaban "${field.label}" harus salah satu opsi.` };
      const text = value.trim().slice(0, LIMIT.optionMaxLen);
      if (!text) continue;
      if (!field.options.includes(text) && !field.allowOther) {
        return { ok: false, error: `Jawaban "${field.label}" tidak ada di daftar opsi.` };
      }
      cleaned[field.id] = text;
      continue;
    }

    if (field.type === "checkbox") {
      if (!Array.isArray(value)) return { ok: false, error: `Jawaban "${field.label}" harus berupa pilihan.` };
      const items: string[] = [];
      for (const item of value.slice(0, LIMIT.checkboxMaxItems)) {
        if (typeof item !== "string") return { ok: false, error: `Pilihan "${field.label}" harus teks.` };
        const trimmed = item.trim().slice(0, LIMIT.optionMaxLen);
        if (!trimmed) continue;
        if (!field.options.includes(trimmed) && !field.allowOther) {
          return { ok: false, error: `Pilihan "${trimmed}" tidak ada di daftar opsi "${field.label}".` };
        }
        if (!items.includes(trimmed)) items.push(trimmed);
      }
      if (field.required && items.length === 0) {
        return { ok: false, error: `Jawaban untuk "${field.label}" wajib dipilih minimal satu.` };
      }
      if (items.length > 0) cleaned[field.id] = items;
      continue;
    }
  }

  return { ok: true, cleaned };
}

/* --------------------------------- Utilitas --------------------------------- */

/**
 * Skema dianggap aktif bila ada minimal satu field ATAU sudah v2 (skema v2
 * selalu jadi sumber kebenaran formulir — meski tanpa pertanyaan kustom,
 * konfigurasi bagian bawaan tetap berlaku).
 */
export function isFormSchemaActive(position: { formSchema: FormSchema | null }): boolean {
  return (
    position.formSchema !== null &&
    (position.formSchema.fields.length > 0 || position.formSchema.version >= FORM_SCHEMA_VERSION)
  );
}

/** Format jawaban menjadi satu baris teks (untuk CSV, print, dan prompt AI). */
export function formatAnswerValue(value: FormAnswerValue | undefined): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.join("; ");
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return value.filename || "";
}

/** Label tipe field untuk UI admin (Indonesia). */
export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: "Teks Pendek",
  textarea: "Paragraf",
  radio: "Pilihan Ganda",
  checkbox: "Kotak Centang",
  dropdown: "Dropdown",
  date: "Tanggal",
  number: "Angka",
  rating: "Rating Bintang",
  file: "Unggah Berkas",
  url: "Tautan URL",
};
