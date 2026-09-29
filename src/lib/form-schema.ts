// Form Builder per Posisi — skema formulir lamaran yang bisa disusun admin.
// Satu sumber kebenaran untuk: admin builder, API sanitasi, renderer publik,
// validasi submit, tab Jawaban, dan ekspor CSV. File ini CLIENT-SAFE:
// tidak boleh mengimpor modul server-only (db/prisma).
//
// Model mental (Opsi hybrid):
// - Blok bawaan TERKUNCI: Data Diri (nama/email/WA), Pengalaman (experience/motivation),
//   Berkas (requireCv/requireIntro/requirePortfolio) — tetap kolom Application.
// - Zona bebas: `Position.formSchema` (JSON string) berisi sections + fields.
//   Setiap section menjadi satu langkah wizard publik (antara Pengalaman dan Berkas).
// - Jawaban pelamar tersimpan di `Application.formAnswers` (JSON string) dengan kunci
//   fieldId yang stabil — ganti label tidak pernah merusak data; field yang dihapus
//   dipindahkan ke `retiredFields` agar jawaban lama tetap bisa dirender.
//
// null pada kolom = mode klasik (wizard lama: screeningQuestions + customDocs).
// Schema aktif = fields.length > 0.

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
  maxSections: 5,
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

/** Berkas yang boleh diunggah pada field tipe file (lebih longgar dari dokumen bawaan). */
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

export function isAllowedFormFile(file: { type: string; name: string }): boolean {
  if (FORM_FILE_ALLOWED_MIMES.includes(file.type)) return true;
  if (!file.type) {
    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    return (FORM_FILE_ALLOWED_EXTS as readonly string[]).includes(ext);
  }
  return false;
}

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

export type FormSection = {
  id: string;
  title: string;
  description?: string;
  titleEn?: string;
};

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
    const section: FormSection = { id, title };
    const desc = typeof s.description === "string" ? s.description.trim().slice(0, FORM_LIMITS.sectionDescMax) : "";
    if (desc) section.description = desc;
    const titleEn = typeof s.titleEn === "string" ? s.titleEn.trim().slice(0, FORM_LIMITS.sectionTitleMax) : "";
    if (titleEn) section.titleEn = titleEn;
    sections.push(section);
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
  if (sections.length === 0 && fields.length === 0) return null;

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

  const version = typeof obj.version === "number" && Number.isFinite(obj.version) ? obj.version : 1;
  return { version, sections, fields, retiredFields };
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
 */
export function buildDefaultSchema(input: {
  screeningQuestions: SimpleQuestion[];
  customDocs: string[];
}): FormSchema {
  const sections: FormSection[] = [];
  const fields: FormField[] = [];

  const questions = input.screeningQuestions.slice(0, FORM_LIMITS.maxFields);
  const docs = input.customDocs
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, FORM_LIMITS.maxFields - questions.length);

  if (questions.length > 0) {
    const sectionId = `sec_pertanyaan_${Date.now().toString(36)}`;
    sections.push({ id: sectionId, title: "Pertanyaan Screening" });
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
    sections.push({ id: sectionId, title: "Dokumen Tambahan" });
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

  return { version: 1, sections, fields, retiredFields: [] };
}

/* --------------------------------- Sanitasi --------------------------------- */

export type FormSchemaSanitizeResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

/**
 * Sanitasi input skema dari admin (PUT /form atau PATCH posisi).
 * - null/""  -> null (kembali ke mode klasik)
 * - objek    -> JSON string yang sudah bersih
 * Retired fields otomatis digabung dari previousSchemaRaw (field lama yang hilang
 * dari skema baru dipindah ke makam, bukan dihapus, agar jawaban lama tetap terbaca).
 */
export function sanitizeFormSchemaInput(
  value: unknown,
  opts: { previousSchemaRaw?: string | null } = {},
): FormSchemaSanitizeResult {
  if (value === undefined) return { ok: true, value: undefined as unknown as string | null };
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
  if (obj.sections.length > LIMIT.maxSections) {
    return { ok: false, error: `Maksimal ${LIMIT.maxSections} bagian formulir.` };
  }
  const sections: FormSection[] = [];
  const sectionIds = new Set<string>();
  for (let i = 0; i < obj.sections.length; i++) {
    const raw = obj.sections[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `Bagian #${i + 1} tidak valid.` };
    }
    const s = raw as Record<string, unknown>;
    const id = typeof s.id === "string" && ID_RE.test(s.id) ? s.id : "";
    if (!id) return { ok: false, error: `Bagian #${i + 1} butuh ID yang valid.` };
    if (sectionIds.has(id)) return { ok: false, error: `ID bagian "${id}" ganda.` };
    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (title.length < 1 || title.length > LIMIT.sectionTitleMax) {
      return { ok: false, error: `Judul bagian #${i + 1} harus 1-${LIMIT.sectionTitleMax} karakter.` };
    }
    const section: FormSection = { id, title };
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
    sections.push(section);
  }

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
    version: typeof obj.version === "number" && Number.isFinite(obj.version) ? Math.max(1, Math.round(obj.version)) : 1,
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

/** Skema dianggap aktif bila ada minimal satu field — posisi lain tetap mode klasik. */
export function isFormSchemaActive(position: { formSchema: FormSchema | null }): boolean {
  return position.formSchema !== null && position.formSchema.fields.length > 0;
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
