// Sanitasi input field posisi v3 — SERVER-ONLY (dipakai POST & PATCH /api/admin/positions).
// Satu sumber kebenaran agar kedua route tidak menduplikasi aturan validasi.
// Prinsip: undefined = field tidak dikirim (diabaikan pada PATCH), null = dikirim untuk dikosongkan.
// Melebihi batas karakter pada input admin = error 400 (sanitasi ketat).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureUniqueSlug, parseRequirements, slugifyTitle } from "@/lib/seed";
import { stagesForPosition, isBuiltInStage } from "@/lib/stages";
import {
  INTERVIEW_MODES,
  INTERVIEW_PLATFORMS,
  POSITION_TYPES,
  STAGE_CATEGORIES,
  type StageCategory,
  type StageKey,
} from "@/lib/types";

export type Sanitized<T> = { ok: true; value: T } | { ok: false; error: string };

function err(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/**
 * Field posisi hasil sanitasi. Semua properti opsional:
 * - tidak ada pada objek = tidak dikirim (PATCH mengabaikannya)
 * - null = dikirim untuk mengosongkan nilai
 * - array = daftar teks yang sudah bersih (route yang meng-JSON.stringify saat simpan)
 * - screeningQuestions & stages = string JSON siap simpan
 */
export type PositionFields = {
  title?: string;
  department?: string;
  type?: string;
  location?: string;
  description?: string;
  requirements?: string[];
  isActive?: boolean;
  closesAt?: Date | null;
  order?: number;
  slug?: string | null;
  salaryText?: string | null;
  salaryVisible?: boolean;
  benefits?: string[];
  examples?: string[];
  urgent?: boolean;
  featured?: boolean;
  screeningQuestions?: string; // JSON string {id,label,required}[]
  requireCv?: boolean;
  requireIntro?: boolean;
  requirePortfolio?: boolean;
  maxApplicants?: number | null;
  publishAt?: Date | null;
  stages?: string; // JSON string[]; "[]" = pakai pipeline bawaan
  stageCategories?: string; // JSON Record<tahap kustom, StageCategory>; "{}" = pakai heuristik bawaan
  aiCriteria?: string | null;
  autoShortlistScore?: number | null;
  autoShortlistStage?: string | null;
  applyTemplate?: string | null;
  acceptTemplate?: string | null;
  rejectTemplate?: string | null;
  assignmentTitle?: string | null;
  assignmentUrl?: string | null;
  assignmentNote?: string | null;
  rubricCriteria?: string[];
  checklistTemplate?: string[];
  noteTemplates?: string[];
  coverFileId?: string | null;
  // Wawancara per lowongan
  interviewMode?: string; // ONLINE | ONSITE
  interviewPlatform?: string; // GOOGLE_MEET | ...
  interviewDuration?: number;
  interviewCriteria?: string[];
  interviewInviteTemplate?: string | null;
  // Offer & onboarding per lowongan
  offerTemplate?: string | null;
  welcomeTemplate?: string | null;
  probationMonths?: number;
  onboardingDocs?: string[]; // label dokumen wajib
  reapplyCooldownDays?: number;
  autoCloseOnHired?: boolean;
  // Konten dua bahasa (opsional)
  titleEn?: string | null;
  descriptionEn?: string | null;
  requirementsEn?: string[];
};

/* ------------------------------- Field sederhana ------------------------------- */

function sanitizeTitle(value: unknown, required: boolean): Sanitized<string | undefined> {
  if (value === undefined && !required) return ok(undefined);
  const title = typeof value === "string" ? value.trim() : "";
  if (title.length < 3) return err("Judul posisi minimal 3 karakter.");
  return ok(title);
}

function sanitizeDepartment(value: unknown, required: boolean): Sanitized<string | undefined> {
  if (value === undefined && !required) return ok(undefined);
  const department = typeof value === "string" ? value.trim() : "";
  if (!department) return err("Departemen wajib diisi.");
  return ok(department);
}

function sanitizeDescription(value: unknown, required: boolean): Sanitized<string | undefined> {
  if (value === undefined && !required) return ok(undefined);
  const description = typeof value === "string" ? value.trim() : "";
  if (description.length < 10) return err("Deskripsi minimal 10 karakter.");
  return ok(description);
}

function sanitizeLocation(value: unknown, mode: "create" | "update"): Sanitized<string | undefined> {
  if (value === undefined) return ok(mode === "create" ? "Remote" : undefined);
  const location = typeof value === "string" ? value.trim() : "";
  if (!location) {
    return mode === "create" ? ok("Remote") : err("Lokasi wajib diisi.");
  }
  return ok(location);
}

function sanitizeType(value: unknown, mode: "create" | "update"): Sanitized<string | undefined> {
  if (value === undefined) return ok(mode === "create" ? "Full-time" : undefined);
  if (typeof value !== "string" || !(POSITION_TYPES as readonly string[]).includes(value.trim())) {
    return err("Jenis pekerjaan tidak valid.");
  }
  return ok(value.trim());
}

function sanitizeRequirements(value: unknown): Sanitized<string[] | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok([]);
  if (!Array.isArray(value)) return err("Requirements harus berupa array teks.");
  return ok(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
}

function sanitizeBoolean(value: unknown, name: string): Sanitized<boolean | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "boolean") return err(`${name} harus berupa boolean.`);
  return ok(value);
}

function sanitizeOrder(value: unknown): Sanitized<number | undefined> {
  if (value === undefined) return ok(undefined);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return err("Order harus berupa bilangan bulat.");
  }
  return ok(value);
}

function sanitizeDate(value: unknown, label: string): Sanitized<Date | null | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok(null);
  if (typeof value !== "string") return err(`${label} tidak valid.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return err(`${label} tidak valid.`);
  return ok(parsed);
}

/** Teks opsional yang bisa dikosongkan (null): trim, kosong -> null, batasi panjang. */
function sanitizeNullableText(
  value: unknown,
  name: string,
  maxLen: number,
): Sanitized<string | null | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok(null);
  if (typeof value !== "string") return err(`${name} harus berupa teks.`);
  const trimmed = value.trim();
  if (!trimmed) return ok(null);
  if (trimmed.length > maxLen) return err(`${name} maksimal ${maxLen} karakter.`);
  return ok(trimmed);
}

/** URL opsional: bila diisi harus diawali http:// atau https://. */
function sanitizeNullableUrl(
  value: unknown,
  name: string,
  maxLen: number,
): Sanitized<string | null | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok(null);
  if (typeof value !== "string") return err(`${name} harus berupa teks.`);
  const trimmed = value.trim();
  if (!trimmed) return ok(null);
  if (trimmed.length > maxLen) return err(`${name} maksimal ${maxLen} karakter.`);
  if (!/^https?:\/\//i.test(trimmed)) {
    return err(`${name} harus diawali http:// atau https://.`);
  }
  return ok(trimmed);
}

/** Integer opsional yang bisa null dengan rentang tertentu. */
function sanitizeNullableInt(
  value: unknown,
  name: string,
  min: number,
  max: number,
): Sanitized<number | null | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok(null);
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return err(`${name} harus angka bulat ${min}-${max} atau dikosongkan.`);
  }
  if (value < min || value > max) return err(`${name} harus angka bulat ${min}-${max}.`);
  return ok(value);
}

/* --------------------------------- Field daftar --------------------------------- */

type ListOptions = { name: string; maxItems: number; minLen: number; maxLen: number; urlOnly?: boolean };

function sanitizeStringList(value: unknown, opts: ListOptions): Sanitized<string[] | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok([]); // null = kosongkan daftar
  if (!Array.isArray(value)) return err(`${opts.name} harus berupa array teks.`);
  if (value.length > opts.maxItems) return err(`${opts.name} maksimal ${opts.maxItems} item.`);
  const items: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return err(`${opts.name} harus berupa array teks.`);
    const item = raw.trim();
    if (!item) continue;
    if (item.length < opts.minLen || item.length > opts.maxLen) {
      return err(`Tiap item ${opts.name} harus ${opts.minLen}-${opts.maxLen} karakter.`);
    }
    if (opts.urlOnly && !/^https?:\/\//i.test(item)) {
      return err(`Tiap item ${opts.name} harus diawali http:// atau https://.`);
    }
    items.push(item);
  }
  return ok(items);
}

/** Pipeline tahap kustom: bersih, unik, maks 12, tiap tahap 1..40, tanpa "__". */
function sanitizeStages(value: unknown): Sanitized<string[] | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok([]);
  if (!Array.isArray(value)) return err("Pipeline tahap harus berupa array teks.");
  const cleaned: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") return err("Pipeline tahap harus berupa array teks.");
    const stage = raw.trim();
    if (!stage) continue;
    if (stage.length > 40) return err("Tiap tahap maksimal 40 karakter.");
    if (stage.includes("__")) return err("Nama tahap tidak boleh mengandung karakter '__'.");
    if (!cleaned.includes(stage)) cleaned.push(stage);
  }
  if (cleaned.length > 12) return err("Pipeline tahap maksimal 12 tahap.");
  return ok(cleaned);
}

/** Kategori fitur per tahap kustom: objek {tahap: kategori}, hanya tahap kustom yang boleh. */
function sanitizeStageCategories(
  value: unknown,
  effectiveStages: StageKey[],
): Sanitized<string | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok("{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return err("Kategori tahap harus berupa objek {tahap: kategori}.");
  }
  const customStages = effectiveStages.filter((s) => !isBuiltInStage(s));
  const out: Record<string, StageCategory> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const stage = typeof key === "string" ? key.trim().slice(0, 40) : "";
    if (!stage) continue;
    // Khusus tahap kustom — kategori tahap bawaan bersifat tetap.
    if (!customStages.includes(stage)) continue;
    if (typeof raw !== "string" || !(STAGE_CATEGORIES as readonly string[]).includes(raw)) {
      return err(`Kategori tahap "${stage}" tidak valid.`);
    }
    out[stage] = raw as StageCategory;
  }
  return ok(JSON.stringify(out));
}

/** Pertanyaan screening: maks 10, label 3..200, id stabil berdasarkan urutan (q1, q2, ...). */
function sanitizeScreeningQuestions(value: unknown): Sanitized<string | undefined> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok("[]");
  if (!Array.isArray(value)) return err("Pertanyaan screening harus berupa array.");
  if (value.length > 10) return err("Pertanyaan screening maksimal 10.");
  const result: { id: string; label: string; required: boolean }[] = [];
  for (let i = 0; i < value.length; i++) {
    const obj = (
      value[i] && typeof value[i] === "object" && !Array.isArray(value[i]) ? value[i] : {}
    ) as Record<string, unknown>;
    const label = typeof obj.label === "string" ? obj.label.trim() : "";
    if (label.length < 3 || label.length > 200) {
      return err(`Label pertanyaan screening #${i + 1} harus 3-200 karakter.`);
    }
    const rawId = typeof obj.id === "string" ? obj.id.trim() : "";
    const id = rawId ? rawId.slice(0, 40) : `q${i + 1}`; // id stabil mengikuti urutan array
    result.push({ id, label, required: obj.required === true });
  }
  // Cegah id ganda: kemunculan pertama dipertahankan, sisanya di-generate ulang berdasar urutan.
  const seen = new Set<string>();
  for (let i = 0; i < result.length; i++) {
    if (!seen.has(result[i].id)) {
      seen.add(result[i].id);
      continue;
    }
    let candidate = `q${i + 1}`;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `q${i + 1}-${suffix}`;
      suffix += 1;
    }
    result[i].id = candidate;
    seen.add(candidate);
  }
  return ok(JSON.stringify(result));
}

/* ------------------------------- Field async (DB) ------------------------------- */

/** Slug eksplisit: slugify (maks 60) + unik kecuali posisi itu sendiri. */
async function sanitizeSlug(value: unknown, excludeId?: string): Promise<Sanitized<string | null | undefined>> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok(null);
  if (typeof value !== "string") return err("Slug tidak valid.");
  const trimmed = value.trim();
  if (!trimmed) return ok(null); // string kosong = kosongkan slug
  const slug = slugifyTitle(trimmed);
  const existing = await db.position.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== excludeId) return err("Slug sudah dipakai posisi lain.");
  return ok(slug);
}

/** coverFileId harus menunjuk FileAsset yang benar-benar ada. */
async function sanitizeCoverFileId(value: unknown): Promise<Sanitized<string | null | undefined>> {
  if (value === undefined) return ok(undefined);
  if (value === null) return ok(null);
  if (typeof value !== "string") return err("coverFileId tidak valid.");
  const trimmed = value.trim();
  if (!trimmed) return ok(null);
  const asset = await db.fileAsset.findUnique({ where: { id: trimmed }, select: { id: true } });
  if (!asset) return err("File cover tidak ditemukan.");
  return ok(trimmed);
}

/* ------------------------------ Fungsi sanitasi utama ------------------------------ */

export type SanitizePositionOptions = {
  mode: "create" | "update";
  /** id posisi yang sedang diedit (untuk pengecualian keunikan slug) */
  excludeId?: string;
  /** record posisi saat ini (untuk validasi autoShortlistStage & perubahan judul) */
  current?: { title: string; stages: string; autoShortlistStage: string | null } | null;
};

/**
 * Sanitasi seluruh field posisi v3 dari body request.
 * Field bawaan (title/department/description) wajib pada mode create.
 */
export async function sanitizePositionInput(
  data: Record<string, unknown>,
  opts: SanitizePositionOptions,
): Promise<Sanitized<PositionFields>> {
  const create = opts.mode === "create";
  const f: PositionFields = {};

  // Field inti
  const title = sanitizeTitle(data.title, create);
  if (!title.ok) return title;
  if (title.value !== undefined) f.title = title.value;

  const department = sanitizeDepartment(data.department, create);
  if (!department.ok) return department;
  if (department.value !== undefined) f.department = department.value;

  const description = sanitizeDescription(data.description, create);
  if (!description.ok) return description;
  if (description.value !== undefined) f.description = description.value;

  const location = sanitizeLocation(data.location, opts.mode);
  if (!location.ok) return location;
  if (location.value !== undefined) f.location = location.value;

  const type = sanitizeType(data.type, opts.mode);
  if (!type.ok) return type;
  if (type.value !== undefined) f.type = type.value;

  const requirements = sanitizeRequirements(data.requirements);
  if (!requirements.ok) return requirements;
  if (requirements.value !== undefined) f.requirements = requirements.value;

  // Boolean
  const booleans: [keyof PositionFields, string][] = [
    ["isActive", "isActive"],
    ["salaryVisible", "salaryVisible"],
    ["urgent", "urgent"],
    ["featured", "featured"],
    ["requireCv", "requireCv"],
    ["requireIntro", "requireIntro"],
    ["requirePortfolio", "requirePortfolio"],
  ];
  for (const [key, name] of booleans) {
    const parsed = sanitizeBoolean(data[key as string], name);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined) (f as Record<string, unknown>)[key] = parsed.value;
  }

  const order = sanitizeOrder(data.order);
  if (!order.ok) return order;
  if (order.value !== undefined) f.order = order.value;

  const closesAt = sanitizeDate(data.closesAt, "Tanggal penutupan");
  if (!closesAt.ok) return closesAt;
  if (closesAt.value !== undefined) f.closesAt = closesAt.value;

  const publishAt = sanitizeDate(data.publishAt, "Tanggal publikasi");
  if (!publishAt.ok) return publishAt;
  if (publishAt.value !== undefined) f.publishAt = publishAt.value;

  // Tampilan & konten
  const salaryText = sanitizeNullableText(data.salaryText, "Teks gaji", 80);
  if (!salaryText.ok) return salaryText;
  if (salaryText.value !== undefined) f.salaryText = salaryText.value;

  const benefits = sanitizeStringList(data.benefits, {
    name: "Benefit", maxItems: 10, minLen: 1, maxLen: 120,
  });
  if (!benefits.ok) return benefits;
  if (benefits.value !== undefined) f.benefits = benefits.value;

  const examples = sanitizeStringList(data.examples, {
    name: "Contoh karya", maxItems: 6, minLen: 1, maxLen: 300, urlOnly: true,
  });
  if (!examples.ok) return examples;
  if (examples.value !== undefined) f.examples = examples.value;

  // Formulir & screening
  const screening = sanitizeScreeningQuestions(data.screeningQuestions);
  if (!screening.ok) return screening;
  if (screening.value !== undefined) f.screeningQuestions = screening.value;

  const maxApplicants = sanitizeNullableInt(data.maxApplicants, "Kuota pelamar", 1, 10000);
  if (!maxApplicants.ok) return maxApplicants;
  if (maxApplicants.value !== undefined) f.maxApplicants = maxApplicants.value;

  // Pipeline & otomasi
  const stages = sanitizeStages(data.stages);
  if (!stages.ok) return stages;

  // Tahap efektif untuk validasi autoShortlistStage: stages baru (atau bawaan bila kosong),
  // selain itu stages milik record lama.
  const effectiveStages: StageKey[] =
    stages.value !== undefined
      ? stagesForPosition(stages.value)
      : stagesForPosition(opts.current ? parseRequirements(opts.current.stages) : null);

  if (stages.value !== undefined) f.stages = JSON.stringify(stages.value);

  const stageCategories = sanitizeStageCategories(data.stageCategories, effectiveStages);
  if (!stageCategories.ok) return stageCategories;
  if (stageCategories.value !== undefined) f.stageCategories = stageCategories.value;

  const aiCriteria = sanitizeNullableText(data.aiCriteria, "Kriteria AI", 600);
  if (!aiCriteria.ok) return aiCriteria;
  if (aiCriteria.value !== undefined) f.aiCriteria = aiCriteria.value;

  const autoShortlistScore = sanitizeNullableInt(data.autoShortlistScore, "Skor auto-shortlist", 0, 100);
  if (!autoShortlistScore.ok) return autoShortlistScore;
  if (autoShortlistScore.value !== undefined) f.autoShortlistScore = autoShortlistScore.value;

  if (data.autoShortlistStage !== undefined) {
    if (data.autoShortlistStage === null) {
      f.autoShortlistStage = null;
    } else if (typeof data.autoShortlistStage === "string") {
      const stage = data.autoShortlistStage.trim();
      if (!stage) {
        f.autoShortlistStage = null;
      } else if (stage.length > 40) {
        return err("Tahap auto-shortlist maksimal 40 karakter.");
      } else if (!effectiveStages.includes(stage)) {
        return err("Tahap auto-shortlist harus ada di daftar tahap posisi.");
      } else {
        f.autoShortlistStage = stage;
      }
    } else {
      return err("Tahap auto-shortlist tidak valid.");
    }
  }

  // Template balasan
  const applyTemplate = sanitizeNullableText(data.applyTemplate, "Template konfirmasi lamaran", 500);
  if (!applyTemplate.ok) return applyTemplate;
  if (applyTemplate.value !== undefined) f.applyTemplate = applyTemplate.value;

  const acceptTemplate = sanitizeNullableText(data.acceptTemplate, "Template diterima", 500);
  if (!acceptTemplate.ok) return acceptTemplate;
  if (acceptTemplate.value !== undefined) f.acceptTemplate = acceptTemplate.value;

  const rejectTemplate = sanitizeNullableText(data.rejectTemplate, "Template ditolak", 500);
  if (!rejectTemplate.ok) return rejectTemplate;
  if (rejectTemplate.value !== undefined) f.rejectTemplate = rejectTemplate.value;

  // Tes/assignment
  const assignmentTitle = sanitizeNullableText(data.assignmentTitle, "Judul tes/assignment", 120);
  if (!assignmentTitle.ok) return assignmentTitle;
  if (assignmentTitle.value !== undefined) f.assignmentTitle = assignmentTitle.value;

  const assignmentUrl = sanitizeNullableUrl(data.assignmentUrl, "URL tes/assignment", 300);
  if (!assignmentUrl.ok) return assignmentUrl;
  if (assignmentUrl.value !== undefined) f.assignmentUrl = assignmentUrl.value;

  const assignmentNote = sanitizeNullableText(data.assignmentNote, "Catatan tes/assignment", 400);
  if (!assignmentNote.ok) return assignmentNote;
  if (assignmentNote.value !== undefined) f.assignmentNote = assignmentNote.value;

  // Evaluasi & kolaborasi
  const rubricCriteria = sanitizeStringList(data.rubricCriteria, {
    name: "Kriteria rubrik", maxItems: 8, minLen: 1, maxLen: 60,
  });
  if (!rubricCriteria.ok) return rubricCriteria;
  if (rubricCriteria.value !== undefined) f.rubricCriteria = rubricCriteria.value;

  const checklistTemplate = sanitizeStringList(data.checklistTemplate, {
    name: "Template checklist", maxItems: 8, minLen: 1, maxLen: 120,
  });
  if (!checklistTemplate.ok) return checklistTemplate;
  if (checklistTemplate.value !== undefined) f.checklistTemplate = checklistTemplate.value;

  const noteTemplates = sanitizeStringList(data.noteTemplates, {
    name: "Template catatan", maxItems: 8, minLen: 1, maxLen: 200,
  });
  if (!noteTemplates.ok) return noteTemplates;
  if (noteTemplates.value !== undefined) f.noteTemplates = noteTemplates.value;

  const coverFileId = await sanitizeCoverFileId(data.coverFileId);
  if (!coverFileId.ok) return coverFileId;
  if (coverFileId.value !== undefined) f.coverFileId = coverFileId.value;

  // Wawancara per lowongan
  if (data.interviewMode !== undefined) {
    const mode = typeof data.interviewMode === "string" ? data.interviewMode.trim() : "";
    if (!(INTERVIEW_MODES as string[]).includes(mode)) {
      return err("Mode wawancara tidak valid.");
    }
    f.interviewMode = mode;
  }

  if (data.interviewPlatform !== undefined) {
    const platform = typeof data.interviewPlatform === "string" ? data.interviewPlatform.trim() : "";
    if (!(INTERVIEW_PLATFORMS as string[]).includes(platform)) {
      return err("Platform wawancara tidak valid.");
    }
    f.interviewPlatform = platform;
  }

  const interviewDuration = sanitizeNullableInt(data.interviewDuration, "Durasi wawancara", 10, 480);
  if (!interviewDuration.ok) return interviewDuration;
  if (interviewDuration.value != null) f.interviewDuration = interviewDuration.value;

  const interviewCriteria = sanitizeStringList(data.interviewCriteria, {
    name: "Kriteria scorecard", maxItems: 8, minLen: 1, maxLen: 60,
  });
  if (!interviewCriteria.ok) return interviewCriteria;
  if (interviewCriteria.value !== undefined) f.interviewCriteria = interviewCriteria.value;

  const interviewInviteTemplate = sanitizeNullableText(
    data.interviewInviteTemplate, "Template undangan wawancara", 800,
  );
  if (!interviewInviteTemplate.ok) return interviewInviteTemplate;
  if (interviewInviteTemplate.value !== undefined) f.interviewInviteTemplate = interviewInviteTemplate.value;

  // Offer & onboarding per lowongan
  const offerTemplate = sanitizeNullableText(data.offerTemplate, "Template penawaran", 800);
  if (!offerTemplate.ok) return offerTemplate;
  if (offerTemplate.value !== undefined) f.offerTemplate = offerTemplate.value;

  const welcomeTemplate = sanitizeNullableText(data.welcomeTemplate, "Template sambutan", 800);
  if (!welcomeTemplate.ok) return welcomeTemplate;
  if (welcomeTemplate.value !== undefined) f.welcomeTemplate = welcomeTemplate.value;

  const probationMonths = sanitizeNullableInt(data.probationMonths, "Masa percobaan (bulan)", 0, 12);
  if (!probationMonths.ok) return probationMonths;
  if (probationMonths.value != null) f.probationMonths = probationMonths.value;

  const onboardingDocs = sanitizeStringList(data.onboardingDocs, {
    name: "Dokumen onboarding", maxItems: 10, minLen: 1, maxLen: 120,
  });
  if (!onboardingDocs.ok) return onboardingDocs;
  if (onboardingDocs.value !== undefined) f.onboardingDocs = onboardingDocs.value;

  const reapplyCooldownDays = sanitizeNullableInt(data.reapplyCooldownDays, "Jeda lamar ulang (hari)", 0, 365);
  if (!reapplyCooldownDays.ok) return reapplyCooldownDays;
  if (reapplyCooldownDays.value != null) f.reapplyCooldownDays = reapplyCooldownDays.value;

  const autoCloseOnHired = sanitizeBoolean(data.autoCloseOnHired, "autoCloseOnHired");
  if (!autoCloseOnHired.ok) return autoCloseOnHired;
  if (autoCloseOnHired.value !== undefined) f.autoCloseOnHired = autoCloseOnHired.value;

  // Konten dua bahasa (opsional): kosong = null (fallback ke versi Indonesia).
  const titleEn = sanitizeNullableText(data.titleEn, "Judul bahasa Inggris", 120);
  if (!titleEn.ok) return titleEn;
  if (titleEn.value !== undefined) f.titleEn = titleEn.value;

  const descriptionEn = sanitizeNullableText(data.descriptionEn, "Deskripsi bahasa Inggris", 5000);
  if (!descriptionEn.ok) return descriptionEn;
  if (descriptionEn.value !== undefined) f.descriptionEn = descriptionEn.value;

  const requirementsEn = sanitizeStringList(data.requirementsEn, {
    name: "Persyaratan bahasa Inggris", maxItems: 20, minLen: 1, maxLen: 200,
  });
  if (!requirementsEn.ok) return requirementsEn;
  if (requirementsEn.value !== undefined) f.requirementsEn = requirementsEn.value;

  // Slug: eksplisit divalidasi; bila tidak dikirim tapi judul BERUBA -> regenerate dari judul.
  const slug = await sanitizeSlug(data.slug, opts.excludeId);
  if (!slug.ok) return slug;
  if (slug.value !== undefined) {
    f.slug = slug.value;
  } else if (f.title !== undefined) {
    const titleChanged = !opts.current || f.title !== opts.current.title;
    if (titleChanged) {
      f.slug = await ensureUniqueSlug(f.title, opts.excludeId);
    }
  }

  return ok(f);
}

/** Ubah PositionFields menjadi data Prisma (list di-JSON.stringify). */
export function positionFieldsToDb(f: PositionFields): Prisma.PositionUpdateInput {
  const out: Prisma.PositionUpdateInput = {};
  if (f.title !== undefined) out.title = f.title;
  if (f.slug !== undefined) out.slug = f.slug;
  if (f.department !== undefined) out.department = f.department;
  if (f.type !== undefined) out.type = f.type;
  if (f.location !== undefined) out.location = f.location;
  if (f.description !== undefined) out.description = f.description;
  if (f.requirements !== undefined) out.requirements = JSON.stringify(f.requirements);
  if (f.isActive !== undefined) out.isActive = f.isActive;
  if (f.closesAt !== undefined) out.closesAt = f.closesAt;
  if (f.order !== undefined) out.order = f.order;
  if (f.salaryText !== undefined) out.salaryText = f.salaryText;
  if (f.salaryVisible !== undefined) out.salaryVisible = f.salaryVisible;
  if (f.benefits !== undefined) out.benefits = JSON.stringify(f.benefits);
  if (f.examples !== undefined) out.examples = JSON.stringify(f.examples);
  if (f.urgent !== undefined) out.urgent = f.urgent;
  if (f.featured !== undefined) out.featured = f.featured;
  if (f.screeningQuestions !== undefined) out.screeningQuestions = f.screeningQuestions;
  if (f.requireCv !== undefined) out.requireCv = f.requireCv;
  if (f.requireIntro !== undefined) out.requireIntro = f.requireIntro;
  if (f.requirePortfolio !== undefined) out.requirePortfolio = f.requirePortfolio;
  if (f.maxApplicants !== undefined) out.maxApplicants = f.maxApplicants;
  if (f.publishAt !== undefined) out.publishAt = f.publishAt;
  if (f.stages !== undefined) out.stages = f.stages;
  if (f.stageCategories !== undefined) out.stageCategories = f.stageCategories;
  if (f.aiCriteria !== undefined) out.aiCriteria = f.aiCriteria;
  if (f.autoShortlistScore !== undefined) out.autoShortlistScore = f.autoShortlistScore;
  if (f.autoShortlistStage !== undefined) out.autoShortlistStage = f.autoShortlistStage;
  if (f.applyTemplate !== undefined) out.applyTemplate = f.applyTemplate;
  if (f.acceptTemplate !== undefined) out.acceptTemplate = f.acceptTemplate;
  if (f.rejectTemplate !== undefined) out.rejectTemplate = f.rejectTemplate;
  if (f.assignmentTitle !== undefined) out.assignmentTitle = f.assignmentTitle;
  if (f.assignmentUrl !== undefined) out.assignmentUrl = f.assignmentUrl;
  if (f.assignmentNote !== undefined) out.assignmentNote = f.assignmentNote;
  if (f.rubricCriteria !== undefined) out.rubricCriteria = JSON.stringify(f.rubricCriteria);
  if (f.checklistTemplate !== undefined) out.checklistTemplate = JSON.stringify(f.checklistTemplate);
  if (f.noteTemplates !== undefined) out.noteTemplates = JSON.stringify(f.noteTemplates);
  // Wawancara per lowongan
  if (f.interviewMode !== undefined) out.interviewMode = f.interviewMode;
  if (f.interviewPlatform !== undefined) out.interviewPlatform = f.interviewPlatform;
  if (f.interviewDuration !== undefined) out.interviewDuration = f.interviewDuration;
  if (f.interviewCriteria !== undefined) out.interviewCriteria = JSON.stringify(f.interviewCriteria);
  if (f.interviewInviteTemplate !== undefined) out.interviewInviteTemplate = f.interviewInviteTemplate;
  // Offer & onboarding per lowongan
  if (f.offerTemplate !== undefined) out.offerTemplate = f.offerTemplate;
  if (f.welcomeTemplate !== undefined) out.welcomeTemplate = f.welcomeTemplate;
  if (f.probationMonths !== undefined) out.probationMonths = f.probationMonths;
  if (f.onboardingDocs !== undefined) out.onboardingDocs = JSON.stringify(f.onboardingDocs);
  if (f.reapplyCooldownDays !== undefined) out.reapplyCooldownDays = f.reapplyCooldownDays;
  if (f.autoCloseOnHired !== undefined) out.autoCloseOnHired = f.autoCloseOnHired;
  // Konten dua bahasa (opsional)
  if (f.titleEn !== undefined) out.titleEn = f.titleEn;
  if (f.descriptionEn !== undefined) out.descriptionEn = f.descriptionEn;
  if (f.requirementsEn !== undefined) out.requirementsEn = JSON.stringify(f.requirementsEn);
  // coverFileId hanya tersedia lewat relasi pada input update.
  if (f.coverFileId === null) out.coverFile = { disconnect: true };
  else if (f.coverFileId !== undefined) out.coverFile = { connect: { id: f.coverFileId } };
  return out;
}
