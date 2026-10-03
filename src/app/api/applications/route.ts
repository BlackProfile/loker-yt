// POST /api/applications — kirim lamaran dari form publik.
// Menerima multipart/form-data (dengan file CV/audio intro) ATAU application/json (kompatibilitas).
// Mendukung fitur per posisi v3: kuota pelamar, berkas wajib, pertanyaan screening,
// sumber pelamar + UTM, auto-reply template, dan info tes/assignment.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateTrackingCode, generateUniqueTrackingCode } from "@/lib/tracking";
import { parseScreeningQuestions, parseStringRecord, parseRequirements } from "@/lib/seed";
import {
  FORM_LIMITS,
  coreItemLabel,
  isAllowedFormFile,
  isExperienceEnabled,
  isExperienceRequired,
  isFormSchemaActive,
  isMotivationEnabled,
  isMotivationRequired,
  isWaRequired,
  normalizeFormSchema,
  parseFormSchema,
  validateFormAnswers,
  type FormAnswerValue,
} from "@/lib/form-schema";
import { CV_MAX_BYTES, INTRO_MAX_BYTES, KOMUTER_PLANS, SHIFT_PREFS, type ApplySuccessResponse } from "@/lib/types";
import { startBackgroundProcessing } from "@/lib/processing";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_AUDIO_MIMES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/webm",
];

const AUDIO_EXT_MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".mpeg": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".webm": "audio/webm",
};

const SCREENING_ANSWER_MAX = 500; // batas karakter tiap jawaban screening

// NR-4 — Info Kehadiran posisi non-remote: batas karakter pilihan teks
// (disinkronkan dengan maxLength di wizard) + nilai enum yang sah.
const DOMISILI_MAX = 80;
const START_DATE_MAX = 60;
const KOMUTER_PLAN_VALUES: readonly string[] = KOMUTER_PLANS;
const SHIFT_PREF_VALUES: readonly string[] = SHIFT_PREFS;

// Anti-spam (Task 27): rate limit submit per IP — maks 5 lamaran per jam.
// In-memory (pola rateMap di /api/public/slots): cukup untuk menahan spam
// sederhana tanpa infrastruktur tambahan.
const RATE_LIMIT_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const rateMap = new Map<string, number[]>();

// Time-trap (Task 27): submit lebih cepat dari ini dianggap bot.
const MIN_FILL_MS = 3000;

/** IP klien dari header proxy standar (fallback "unknown"). */
function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded
    ? (forwarded.split(",")[0] ?? "").trim()
    : (req.headers.get("x-real-ip") ?? "").trim();
  return ip || "unknown";
}

/** Respons sukses PALSU untuk bot (honeypot/time-trap) — tidak menyimpan apa pun. */
function fakeSuccessResponse(): ApplySuccessResponse {
  return {
    ok: true,
    id: cuidLike(),
    trackingCode: generateTrackingCode(),
    autoReply: null,
    assignment: null,
  };
}

// Batas & tipe berkas dokumen wajib tambahan (customDocs posisi).
const EXTRA_DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB per dokumen
const EXTRA_DOC_MAX_COUNT = 8;
const ALLOWED_EXTRA_DOC_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/** Tipe berkas dokumen tambahan diterima: PDF, gambar, atau dokumen Word. */
function isAllowedExtraDocType(file: File): boolean {
  if (ALLOWED_EXTRA_DOC_MIMES.includes(file.type)) return true;
  // Tanpa MIME (perangkat tertentu): izinkan lewat ekstensi yang aman.
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return [".pdf", ".jpg", ".jpeg", ".png", ".webp", ".doc", ".docx"].includes(ext);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown): string | null {
  const trimmed = asTrimmedString(value);
  return trimmed.length > 0 ? trimmed : null;
}

/** Nama file aman: buang path, simpan karakter umum, batasi panjang. */
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

/** ID mirip cuid untuk prefiks nama file tersimpan. */
function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

type SavedFile = { id: string };

async function saveUpload(file: File, fallbackMime: string): Promise<SavedFile> {
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const storedName = `${cuidLike()}-${sanitizeFilename(file.name)}`;
  const absolutePath = path.join(uploadsDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, buffer);

  const asset = await db.fileAsset.create({
    data: {
      filename: file.name,
      mimeType: file.type || fallbackMime,
      size: file.size,
      path: `uploads/${storedName}`,
    },
    select: { id: true },
  });
  return asset;
}

/** Substitusi variabel template balasan: {nama}, {posisi}, {kode}. */
function fillTemplate(template: string, name: string, positionTitle: string, code: string): string {
  return template
    .replace(/\{nama\}/g, name)
    .replace(/\{posisi\}/g, positionTitle)
    .replace(/\{kode\}/g, code);
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    const fields: Record<string, string> = {};
    let cvFile: File | null = null;
    let introFile: File | null = null;
    const extraDocFiles: File[] = [];
    // Task 30 — berkas field Form Builder: formFile_<fieldId>
    const formFieldFiles = new Map<string, File>();

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return NextResponse.json({ error: "Data lamaran tidak valid." }, { status: 400 });
      }
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") {
          fields[key] = value;
          continue;
        }
        // File kosong (tidak dipilih) diabaikan.
        if (value.size === 0 || !value.name) continue;
        if (key === "cvFile") cvFile = value;
        else if (key === "introFile") introFile = value;
        else if (/^extraDoc_\d+$/.test(key)) extraDocFiles.push(value);
        else if (key.startsWith("formFile_")) formFieldFiles.set(key.slice("formFile_".length), value);
      }
    } else {
      const body: unknown = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json({ error: "Data lamaran tidak valid." }, { status: 400 });
      }
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        fields[key] = typeof value === "string" ? value : value == null ? "" : String(value);
      }
    }

    const name = asTrimmedString(fields.name);
    const email = asTrimmedString(fields.email);
    const phone = asTrimmedString(fields.phone);
    const positionId = asTrimmedString(fields.positionId);
    const portfolioUrl = asOptionalString(fields.portfolioUrl);
    const socialLinks = asOptionalString(fields.socialLinks);
    const experience = asTrimmedString(fields.experience);
    const motivation = asTrimmedString(fields.motivation);
    // Sumber pelamar & UTM (metadata non-kritis: dipotong bila melebihi batas).
    const source = asOptionalString(fields.source)?.slice(0, 40) ?? null;
    const utmSource = asOptionalString(fields.utmSource)?.slice(0, 60) ?? null;
    const utmMedium = asOptionalString(fields.utmMedium)?.slice(0, 60) ?? null;
    const utmCampaign = asOptionalString(fields.utmCampaign)?.slice(0, 60) ?? null;
    // Referrer: URL halaman saat pelamar mengirim (dikirim client bila ada; null bila tidak).
    const referrer = asOptionalString(fields.referrer)?.slice(0, 300) ?? null;

    // Rate limit per IP (Task 27): maks 5 submit per jam — dipersona sebagai error biasa.
    const nowMs = Date.now();
    const ipKey = `apply:${clientIp(req)}`;
    const hits = (rateMap.get(ipKey) ?? []).filter((ts) => nowMs - ts < RATE_WINDOW_MS);
    if (hits.length >= RATE_LIMIT_MAX) {
      return NextResponse.json(
        { error: "Terlalu banyak percobaan. Coba lagi nanti." },
        { status: 429 },
      );
    }
    hits.push(nowMs);
    rateMap.set(ipKey, hits);
    if (rateMap.size > 500) {
      for (const [key, timestamps] of rateMap) {
        if (timestamps.every((ts) => nowMs - ts >= RATE_WINDOW_MS)) rateMap.delete(key);
      }
    }

    // Honeypot (Task 27): field "website" tersembunyi terisi = bot pengisi otomatis.
    // Balas sukses palsu (200) TANPA menyimpan apa pun, agar bot tidak mencoba lagi.
    if (asOptionalString(fields.website)) {
      return NextResponse.json(fakeSuccessResponse(), { status: 200 });
    }

    // Time-trap (Task 27): formulir terisi kurang dari 3 detik sejak dibuka = bot.
    // Dif berarti jam klien maju — jangan eksekusi salah (biarkan lewat sebagai manusia).
    const startedAt = Number(fields.formStartedAt);
    const elapsed = nowMs - startedAt;
    if (Number.isFinite(startedAt) && startedAt > 0 && elapsed >= 0 && elapsed < MIN_FILL_MS) {
      return NextResponse.json(fakeSuccessResponse(), { status: 200 });
    }

    // Persetujuan privasi (Task 27): wajib ada sebelum lamaran disimpan.
    const consent = fields.consent === "1" || fields.consent === "true";
    if (!consent) {
      return NextResponse.json(
        { error: "Mohon centang persetujuan pemrosesan data pribadi terlebih dahulu." },
        { status: 400 },
      );
    }

    if (name.length < 3) {
      return NextResponse.json({ error: "Nama minimal 3 karakter." }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    if (!positionId) {
      return NextResponse.json({ error: "Posisi wajib dipilih." }, { status: 400 });
    }
    const position = await db.position.findUnique({ where: { id: positionId } });
    const now = new Date();
    // Posisi terbuka = aktif, belum lewat closesAt, dan publishAt sudah tercapai.
    if (
      !position ||
      !position.isActive ||
      (position.closesAt && position.closesAt <= now) ||
      (position.publishAt && position.publishAt > now)
    ) {
      return NextResponse.json({ error: "Posisi tidak ditemukan atau sudah ditutup" }, { status: 400 });
    }
    // Formulir per posisi: admin dapat menutup formulir lamaran satu posisi
    // tanpa menonaktifkan posisinya (posisi tetap tayang di halaman publik).
    if (!position.applyOpen) {
      return NextResponse.json(
        { error: "Formulir lamaran untuk posisi ini sedang ditutup." },
        { status: 403 },
      );
    }

    // NR-4 — Info Kehadiran (hanya posisi ONSITE/HYBRID): domisili, rencana
    // komuter, preferensi shift, perkiraan mulai kerja. Untuk posisi REMOTE
    // atau posisi tidak dikenal, keempat field ini DIABAIKAN sepenuhnya.
    const isOnsitePosition =
      position.workMode === "ONSITE" || position.workMode === "HYBRID";
    const domisili = isOnsitePosition
      ? (asOptionalString(fields.domisili)?.slice(0, DOMISILI_MAX) ?? null)
      : null;
    const komuterPlanRaw = asTrimmedString(fields.komuterPlan);
    const komuterPlan =
      isOnsitePosition && KOMUTER_PLAN_VALUES.includes(komuterPlanRaw)
        ? komuterPlanRaw
        : null;
    const shiftPrefRaw = asTrimmedString(fields.shiftPref);
    const shiftPref =
      isOnsitePosition && SHIFT_PREF_VALUES.includes(shiftPrefRaw)
        ? shiftPrefRaw
        : null;
    const startDatePref = isOnsitePosition
      ? (asOptionalString(fields.startDatePref)?.slice(0, START_DATE_MAX) ?? null)
      : null;

    // Skema formulir v2 (Form Builder): sumber kebenaran seluruh bagian.
    // Skema lama (v1) dinormalisasi; konfigurasi berkas mengikuti kolom posisi.
    const parsedFormSchema = parseFormSchema(position.formSchema);
    const formSchema = normalizeFormSchema(parsedFormSchema, {
      requireCv: position.requireCv,
      requireIntro: position.requireIntro,
      requirePortfolio: position.requirePortfolio,
    });
    const schemaActive = isFormSchemaActive({ formSchema });
    const biodataSection = formSchema?.sections.find((s) => s.kind === "biodata");
    const waRequired = schemaActive && biodataSection ? isWaRequired(biodataSection) : true;
    const experienceSection = formSchema?.sections.find((s) => s.kind === "experience");
    // NR-23 — mode klasik (tanpa skema aktif): pengalaman/motivasi selalu ada & wajib.
    // Mode skema: flag bagian menentukan; bila bagian Pengalaman DIHAPUS admin,
    // keduanya dianggap mati (tidak ada pertanyaan → tidak ada validasi).
    const experienceEnabled = schemaActive
      ? experienceSection
        ? isExperienceEnabled(experienceSection)
        : false
      : true;
    const motivationEnabled = schemaActive
      ? experienceSection
        ? isMotivationEnabled(experienceSection)
        : false
      : true;
    // NR-23 — "Wajib" pengalaman/motivasi kini per item (default true = perilaku lama).
    const experienceRequired = schemaActive
      ? experienceSection
        ? isExperienceRequired(experienceSection)
        : false
      : true;
    const motivationRequired = schemaActive
      ? experienceSection
        ? isMotivationRequired(experienceSection)
        : false
      : true;

    // Nomor WhatsApp: wajib sesuai konfigurasi bagian Data Diri; bila diisi
    // (atau wajib), formatnya tetap divalidasi.
    const phoneDigits = phone.replace(/\D/g, "");
    if (phoneDigits.length > 0 && phoneDigits.length < 8) {
      return NextResponse.json({ error: "Nomor telepon/WhatsApp minimal 8 digit." }, { status: 400 });
    }
    if (waRequired && phoneDigits.length === 0) {
      return NextResponse.json({ error: "Nomor telepon/WhatsApp wajib diisi." }, { status: 400 });
    }
    if (experienceEnabled && experienceRequired && experience.length < 10) {
      const label = experienceSection
        ? coreItemLabel(experienceSection, "experience")
        : "Ceritakan pengalamanmu";
      return NextResponse.json({ error: `"${label}" minimal 10 karakter.` }, { status: 400 });
    }
    if (motivationEnabled && motivationRequired && motivation.length < 10) {
      const label = experienceSection
        ? coreItemLabel(experienceSection, "motivation")
        : "Alasan bergabung";
      return NextResponse.json({ error: `"${label}" minimal 10 karakter.` }, { status: 400 });
    }

    // Cek kuota pelamar (lamaran non-ditolak) bila posisi memakai kuota.
    if (position.maxApplicants != null) {
      const used = await db.application.count({
        where: { positionId: position.id, status: { not: "REJECTED" } },
      });
      if (used >= position.maxApplicants) {
        return NextResponse.json(
          { error: "Kuota pelamar untuk posisi ini sudah penuh." },
          { status: 409 },
        );
      }
    }

    // Cooldown lamar ulang: posisi dapat membatasi jeda minimal setelah melamar (mis. setelah ditolak).
    const cooldownDays = position.reapplyCooldownDays ?? 0;
    if (cooldownDays > 0) {
      const cutoff = new Date(now.getTime() - cooldownDays * 24 * 60 * 60 * 1000);
      const recent = await db.application.findFirst({
        where: { positionId: position.id, email, createdAt: { gt: cutoff } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true },
      });
      if (recent) {
        const canReapplyAt = new Date(recent.createdAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
        const dateLabel = canReapplyAt.toLocaleDateString("id-ID", { dateStyle: "long" });
        const rejectedRecently = recent.status === "REJECTED";
        return NextResponse.json(
          {
            error: rejectedRecently
              ? `Kamu baru saja ditolak untuk posisi ini. Coba lamar lagi setelah ${dateLabel}.`
              : `Kamu sudah melamar posisi ini. Lamarmu masih diproses — cek status dengan kode pelacakanmu.`,
            cooldownUntil: canReapplyAt.toISOString(),
          },
          { status: 429 },
        );
      }
    }

    // Validasi berkas wajib sesuai konfigurasi posisi.
    if (position.requireCv && !cvFile) {
      return NextResponse.json({ error: "CV wajib diunggah untuk posisi ini." }, { status: 400 });
    }
    if (position.requireIntro && !introFile) {
      return NextResponse.json({ error: "Audio perkenalan wajib diunggah untuk posisi ini." }, { status: 400 });
    }
    if (position.requirePortfolio && !portfolioUrl && !socialLinks) {
      return NextResponse.json(
        { error: "Portofolio atau link sosial media wajib untuk posisi ini." },
        { status: 400 },
      );
    }

    // Validasi file opsional
    if (cvFile) {
      if (cvFile.size > CV_MAX_BYTES) {
        return NextResponse.json({ error: "Ukuran CV maksimal 5 MB." }, { status: 400 });
      }
      const isPdf =
        cvFile.type === "application/pdf" ||
        (!cvFile.type && cvFile.name.toLowerCase().endsWith(".pdf"));
      if (!isPdf) {
        return NextResponse.json({ error: "CV harus berupa file PDF." }, { status: 400 });
      }
    }
    if (introFile) {
      if (introFile.size > INTRO_MAX_BYTES) {
        return NextResponse.json({ error: "Ukuran audio perkenalan maksimal 10 MB." }, { status: 400 });
      }
      const ext = introFile.name.slice(introFile.name.lastIndexOf(".")).toLowerCase();
      const mimeOk =
        ALLOWED_AUDIO_MIMES.includes(introFile.type) ||
        (!introFile.type && ext in AUDIO_EXT_MIME);
      if (!mimeOk) {
        return NextResponse.json(
          { error: "Audio perkenalan harus berformat MP3, WAV, M4A, atau WEBM." },
          { status: 400 },
        );
      }
    }

    // Validasi jawaban Form Builder (Task 30) — aktif bila posisi punya skema
    // aktif (ada field, atau skema v2). Saat skema aktif, pertanyaan screening
    // klasik & customDocs DILEWATI: skema adalah sumber kebenaran formulir.
    let formAnswersJson: string | null = null;
    if (formSchema && schemaActive) {
      const validated = validateFormAnswers(formSchema, fields.formAnswers ?? null);
      if (!validated.ok) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      const cleaned = validated.cleaned as Record<string, FormAnswerValue>;

      // Berkas field formulir: ukuran, format, lalu simpan sebagai FileAsset.
      for (const field of formSchema.fields) {
        if (field.type !== "file") continue;
        const file = formFieldFiles.get(field.id) ?? null;
        if (!file) {
          if (field.required) {
            return NextResponse.json(
              { error: `Berkas "${field.label}" wajib diunggah.` },
              { status: 400 },
            );
          }
          continue;
        }
        if (file.size > FORM_LIMITS.fileMaxBytes) {
          return NextResponse.json(
            { error: `Ukuran berkas "${field.label}" maksimal 20 MB.` },
            { status: 400 },
          );
        }
        if (!isAllowedFormFile({ type: file.type, name: file.name })) {
          return NextResponse.json(
            { error: `Format berkas "${field.label}" tidak didukung (PDF, gambar, Word, audio, atau video).` },
            { status: 400 },
          );
        }
        const asset = await saveUpload(file, "application/octet-stream");
        cleaned[field.id] = { fileId: asset.id, filename: file.name.slice(0, 200) };
      }
      // Berkas tak dikenal (field sudah dihapus admin) diabaikan senyap.

      formAnswersJson = JSON.stringify(cleaned);
      if (Buffer.byteLength(formAnswersJson, "utf8") > FORM_LIMITS.answersMaxBytes) {
        return NextResponse.json(
          { error: "Total jawaban formulir terlalu besar." },
          { status: 400 },
        );
      }
    }

    // Validasi jawaban pertanyaan screening posisi (jika ada) — mode klasik saja
    // (saat Form Builder aktif, pertanyaan kustom tinggal field di dalam skema).
    const questions = formAnswersJson ? [] : parseScreeningQuestions(position.screeningQuestions);
    let screeningAnswersJson: string | null = null;
    if (questions.length > 0) {
      const rawAnswers = asOptionalString(fields.screeningAnswers);
      const parsed = rawAnswers ? parseStringRecord(rawAnswers) : null;
      if (rawAnswers && !parsed) {
        return NextResponse.json({ error: "Format jawaban screening tidak valid." }, { status: 400 });
      }
      const record: Record<string, string> = {};
      for (const question of questions) {
        const answer = (parsed?.[question.id] ?? "").trim();
        if (question.required && !answer) {
          return NextResponse.json(
            { error: `Jawaban untuk pertanyaan "${question.label}" wajib diisi.` },
            { status: 400 },
          );
        }
        if (answer) {
          if (answer.length > SCREENING_ANSWER_MAX) {
            return NextResponse.json(
              { error: `Jawaban untuk pertanyaan "${question.label}" maksimal ${SCREENING_ANSWER_MAX} karakter.` },
              { status: 400 },
            );
          }
          record[question.id] = answer;
        }
      }
      screeningAnswersJson = JSON.stringify(record);
    }

    // Validasi dokumen wajib tambahan milik posisi (customDocs) — mode klasik saja.
    // Berkas dipasangkan dengan label berdasarkan urutan pengiriman (extraDoc_0, extraDoc_1, ...).
    const customDocs = formAnswersJson
      ? []
      : parseRequirements(position.customDocs).slice(0, EXTRA_DOC_MAX_COUNT);
    if (customDocs.length > 0) {
      if (extraDocFiles.length < customDocs.length) {
        const missing = customDocs[extraDocFiles.length] ?? customDocs[0];
        return NextResponse.json(
          { error: `Dokumen "${missing}" wajib diunggah untuk posisi ini.` },
          { status: 400 },
        );
      }
      for (const file of extraDocFiles.slice(0, customDocs.length)) {
        if (file.size > EXTRA_DOC_MAX_BYTES) {
          return NextResponse.json(
            { error: `Ukuran dokumen "${file.name}" maksimal 5 MB.` },
            { status: 400 },
          );
        }
        if (!isAllowedExtraDocType(file)) {
          return NextResponse.json(
            { error: `Format dokumen "${file.name}" tidak didukung. Gunakan PDF, gambar (JPG/PNG/WEBP), atau Word.` },
            { status: 400 },
          );
        }
      }
    }

    // Simpan file (opsional) ke folder uploads + catat FileAsset
    const cvAsset = cvFile ? await saveUpload(cvFile, "application/pdf") : null;
    const introAsset = introFile
      ? await saveUpload(introFile, AUDIO_EXT_MIME[introFile.name.slice(introFile.name.lastIndexOf(".")).toLowerCase()] ?? "audio/mpeg")
      : null;

    const trackingCode = await generateUniqueTrackingCode();

    // Simpan dokumen wajib tambahan (urut sesuai customDocs posisi) sebagai JSON.
    let extraDocsJson: string | null = null;
    if (customDocs.length > 0) {
      const docs: { label: string; filename: string; fileId: string }[] = [];
      for (let i = 0; i < customDocs.length; i++) {
        const file = extraDocFiles[i];
        if (!file) break; // sudah divalidasi wajib di atas
        const asset = await saveUpload(file, "application/octet-stream");
        docs.push({ label: customDocs[i], filename: file.name, fileId: asset.id });
      }
      extraDocsJson = JSON.stringify(docs);
    }

    const created = await db.application.create({
      data: {
        name,
        email,
        phone,
        positionId,
        portfolioUrl,
        socialLinks,
        experience,
        motivation,
        trackingCode,
        cvFileId: cvAsset?.id ?? null,
        introFileId: introAsset?.id ?? null,
        extraDocs: extraDocsJson ?? "[]",
        source,
        utmSource,
        utmMedium,
        utmCampaign,
        referrer,
        screeningAnswers: screeningAnswersJson,
        formAnswers: formAnswersJson,
        // NR-4 — Info Kehadiran (null untuk posisi REMOTE / tidak diisi).
        domisili,
        komuterPlan,
        shiftPref,
        startDatePref,
        // Task 27: pencatatan persetujuan privasi + penanda perubahan tahap awal.
        consentAt: consent ? now : null,
        stageUpdatedAt: now,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: created.id,
        actor: "Pelamar",
        action: "APPLICATION_SUBMITTED",
        detail: `Lamaran masuk untuk posisi ${position.title}`,
      },
    });

    // Deteksi duplikat (fitur Task 20-a): email ATAU telepon sama dengan lamaran
    // lain pada POSISI YANG SAMA dalam 90 hari terakhir -> tandai isDuplicate +
    // simpan id lamaran pertama. Dibungkus try/catch: kegagalan deteksi tidak
    // pernah menggagalkan submit.
    try {
      const dupCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      const original = await db.application.findFirst({
        where: {
          id: { not: created.id },
          positionId: created.positionId,
          createdAt: { gte: dupCutoff },
          OR: [{ email }, { phone }],
        },
        orderBy: { createdAt: "asc" },
        select: { id: true, trackingCode: true },
      });
      if (original) {
        await db.application.update({
          where: { id: created.id },
          data: { isDuplicate: true, duplicateOfId: original.id },
        });
        await db.activityLog.create({
          data: {
            applicationId: created.id,
            actor: "Sistem",
            action: "DUPLICATE_DETECTED",
            detail: `Kemungkinan lamaran ganda dari ${original.trackingCode ?? original.id} — email/telepon sama pada posisi yang sama dalam 90 hari`,
          },
        });
      }
    } catch (duplicateError) {
      console.error("[POST /api/applications] deteksi duplikat gagal:", duplicateError);
    }

    // Pipeline latar belakang: AI screening -> transkripsi ASR -> notifikasi webhook.
    // Fire-and-forget: tidak memblokir respons dan dijamin tidak melempar error.
    // AI screening mengisi aiScore/aiSummary/aiRecommendation/aiAnalyzedAt + log AI_SCREENING (actor "AI").
    void startBackgroundProcessing(created.id).catch(() => {});

    // Auto-reply dari template posisi (bila diatur) + info tes/assignment posisi.
    const autoReply = position.applyTemplate
      ? fillTemplate(position.applyTemplate, name, position.title, trackingCode)
      : null;
    const assignment =
      position.assignmentTitle || position.assignmentUrl || position.assignmentNote
        ? {
            title: position.assignmentTitle ?? null,
            url: position.assignmentUrl ?? null,
            note: position.assignmentNote ?? null,
          }
        : null;

    const body: ApplySuccessResponse = {
      ok: true,
      id: created.id,
      trackingCode,
      autoReply,
      assignment,
    };
    // Realtime: beri tahu semua client (panel admin) bahwa ada lamaran baru.
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(body, { status: 201 });
  } catch (error) {
    console.error("[POST /api/applications]", error);
    return NextResponse.json({ error: "Gagal mengirim lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
