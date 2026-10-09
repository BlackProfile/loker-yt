// Mesin aturan otomatis (JIKA-MALA) — Task 4-a. SERVER-ONLY.
// Evaluasi aturan admin atas lamaran:
//   STAGE_AGING : lamaran menginap > N hari di satu tahap -> alert Telegram (dedupe per tahap).
//   SCORE_TAG   : aiScore >= ambang -> tambah tag "High-Potential" (legacy JSON + ApplicationTag).
//   AUTO_REJECT : lamaran macet > N hari di satu tahap -> status REJECTED otomatis (default MATI,
//                 dengan pengaman: tidak pernah menyentuh lamaran ber-interview terjadwal,
//                 offer PENDING/ACCEPTED, approval offer PENDING, atau soft-deleted).
// Konfigurasi disimpan di Setting key "automation" (JSON, toleran rusak/kosong -> default).
// Semua eksekusi aturan tercatat sebagai ActivityLog action "RULE_FIRE" dengan actor "Sistem".
// Fungsi apa pun di file ini TIDAK PERNAH melempar error ke pemanggil (pipeline aman).
import { db } from "@/lib/db";
import { queueEmail, sendTelegramAlert } from "@/lib/notify";
import { appendStageHistory } from "@/lib/stage-history";
import { stageLabel } from "@/lib/stages";

export const AUTOMATION_SETTING_KEY = "automation";
/** Nama tag yang dipasang aturan SCORE_TAG. */
export const HIGH_POTENTIAL_TAG_NAME = "High-Potential";
export const DEFAULT_TRIAGE_ALERT_THRESHOLD = 80;
/** Throttle internal evaluasi (dipanggil cron per jam + akhir processing). */
const EVAL_THROTTLE_MS = 20 * 60 * 1000; // 20 menit
/** Batas aman jumlah lamaran yang diproses per rule per eksekusi. */
const MAX_APPS_PER_RULE = 100;

export type AutomationRuleType = "STAGE_AGING" | "AUTO_REJECT" | "SCORE_TAG";

export const AUTOMATION_RULE_TYPES: AutomationRuleType[] = [
  "STAGE_AGING",
  "AUTO_REJECT",
  "SCORE_TAG",
];

export type AutomationRuleParams = {
  /** Tahap target (STAGE_AGING/AUTO_REJECT) — status bawaan atau tahap kustom. */
  stage?: string;
  /** Ambang hari menginap (STAGE_AGING/AUTO_REJECT) — 1-365. */
  days?: number;
  /** Ambang skor AI (SCORE_TAG) — 0-100. */
  threshold?: number;
  /** Kirim email penolakan (AUTO_REJECT). */
  sendEmail?: boolean;
};

export type AutomationRule = {
  id: string;
  type: AutomationRuleType;
  enabled: boolean;
  params: AutomationRuleParams;
  /** ISO waktu terakhir rule ini benar-benar mengeksekusi (dedupe/throttle). */
  lastFiredAt?: string;
};

export type AutomationConfig = {
  /** Ambang skor alert "kandidat menarik" (notifyHighScore). 0-100. */
  triageAlertThreshold: number;
  rules: AutomationRule[];
  /** ISO evaluasi terakhir — throttle internal 20 menit. */
  lastRulesEvalAt?: string;
};

export type AutomationEvalSummary = {
  /** Jumlah lamaran yang dieksekusi per rule id, mis. { "stage-aging": 2 }. */
  fired: Record<string, number>;
  skippedReason?: string;
  ranAt: string;
};

/** Aturan bawaan saat Setting belum ada: hanya SCORE_TAG aktif, AUTO_REJECT mati (aman). */
export const DEFAULT_AUTOMATION_RULES: AutomationRule[] = [
  {
    id: "stage-aging",
    type: "STAGE_AGING",
    enabled: false,
    params: { stage: "NEW", days: 7 },
  },
  {
    id: "auto-reject",
    type: "AUTO_REJECT",
    enabled: false, // default disabled — berisiko menolak tanpa review manusia
    params: { stage: "NEW", days: 30, sendEmail: false },
  },
  {
    id: "score-tag",
    type: "SCORE_TAG",
    enabled: true,
    params: { threshold: DEFAULT_TRIAGE_ALERT_THRESHOLD },
  },
];

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  triageAlertThreshold: DEFAULT_TRIAGE_ALERT_THRESHOLD,
  rules: DEFAULT_AUTOMATION_RULES.map((rule) => ({ ...rule, params: { ...rule.params } })),
};

/* ------------------------------- Reader/writer ------------------------------- */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.round(num)));
}

function isRuleType(value: unknown): value is AutomationRuleType {
  return typeof value === "string" && (AUTOMATION_RULE_TYPES as string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Normalisasi satu rule dari input bebas (DB rusak / payload admin) — toleran, tidak throw. */
function normalizeRule(raw: unknown, index: number): AutomationRule | null {
  if (!isRecord(raw)) return null;
  if (!isRuleType(raw.type)) return null;
  const idRaw = typeof raw.id === "string" ? raw.id.trim().slice(0, 60) : "";
  const id = idRaw || `rule-${index + 1}`;
  const enabled = raw.enabled === true;
  const paramsRaw = isRecord(raw.params) ? raw.params : {};
  const params: AutomationRuleParams = {};
  if (typeof paramsRaw.stage === "string" && paramsRaw.stage.trim()) {
    params.stage = paramsRaw.stage.trim().slice(0, 40);
  }
  if (paramsRaw.days !== undefined && paramsRaw.days !== null && paramsRaw.days !== "") {
    const days = Number(paramsRaw.days);
    if (Number.isFinite(days)) params.days = clampInt(days, 1, 365, 7);
  }
  if (paramsRaw.threshold !== undefined && paramsRaw.threshold !== null && paramsRaw.threshold !== "") {
    const threshold = Number(paramsRaw.threshold);
    if (Number.isFinite(threshold)) params.threshold = clampInt(threshold, 0, 100, DEFAULT_TRIAGE_ALERT_THRESHOLD);
  }
  if (typeof paramsRaw.sendEmail === "boolean") params.sendEmail = paramsRaw.sendEmail;
  const rule: AutomationRule = { id, type: raw.type, enabled, params };
  if (typeof raw.lastFiredAt === "string" && !Number.isNaN(Date.parse(raw.lastFiredAt))) {
    rule.lastFiredAt = raw.lastFiredAt;
  }
  return rule;
}

/** Reader toleran: Setting hilang/JSON rusak -> default, tidak pernah throw. */
export function normalizeAutomationConfig(raw: unknown): AutomationConfig {
  const config: AutomationConfig = {
    triageAlertThreshold: DEFAULT_TRIAGE_ALERT_THRESHOLD,
    rules: DEFAULT_AUTOMATION_RULES.map((rule) => ({ ...rule, params: { ...rule.params } })),
  };
  if (!isRecord(raw)) return config;
  const threshold = Number(raw.triageAlertThreshold);
  if (Number.isFinite(threshold)) {
    config.triageAlertThreshold = clampInt(threshold, 0, 100, DEFAULT_TRIAGE_ALERT_THRESHOLD);
  }
  if (Array.isArray(raw.rules)) {
    const rules: AutomationRule[] = [];
    for (const item of raw.rules.slice(0, 20)) {
      const rule = normalizeRule(item, rules.length);
      if (rule) rules.push(rule);
    }
    if (rules.length > 0) config.rules = rules;
  }
  if (typeof raw.lastRulesEvalAt === "string" && !Number.isNaN(Date.parse(raw.lastRulesEvalAt))) {
    config.lastRulesEvalAt = raw.lastRulesEvalAt;
  }
  return config;
}

/** Baca Setting "automation" + normalisasi (hilang/rusak -> default). */
export async function getAutomationConfig(): Promise<AutomationConfig> {
  try {
    const row = await db.setting.findUnique({ where: { key: AUTOMATION_SETTING_KEY } });
    if (!row) return { ...DEFAULT_AUTOMATION_CONFIG, rules: DEFAULT_AUTOMATION_RULES.map((r) => ({ ...r, params: { ...r.params } })) };
    const parsed: unknown = JSON.parse(row.value);
    return normalizeAutomationConfig(parsed);
  } catch {
    return { ...DEFAULT_AUTOMATION_CONFIG, rules: DEFAULT_AUTOMATION_RULES.map((r) => ({ ...r, params: { ...r.params } })) };
  }
}

/** Simpan konfigurasi (sudah dinormalisasi) ke Setting "automation". Tidak throw. */
export async function saveAutomationConfig(config: AutomationConfig): Promise<void> {
  try {
    const normalized = normalizeAutomationConfig(config);
    const value = JSON.stringify({
      triageAlertThreshold: normalized.triageAlertThreshold,
      rules: normalized.rules,
      ...(normalized.lastRulesEvalAt ? { lastRulesEvalAt: normalized.lastRulesEvalAt } : {}),
    });
    await db.setting.upsert({
      where: { key: AUTOMATION_SETTING_KEY },
      update: { value },
      create: { key: AUTOMATION_SETTING_KEY, value },
    });
  } catch (error) {
    console.error(
      "[automation-rules] saveAutomationConfig gagal:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/* ------------------------------ Tag (pola tags-sync) ------------------------------ */

/**
 * Tambah SATU tag ke lamaran mengikuti pola dual-write tags-sync: Tag dibuat bila belum ada,
 * ApplicationTag link dibuat bila belum ada, dan legacy Application.tags (JSON string[]) di-append.
 * Idempoten dan tidak pernah melempar error.
 */
export async function addApplicationTag(
  applicationId: string,
  name: string,
  addedBy?: string,
): Promise<void> {
  try {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    let tag = await db.tag.findUnique({ where: { name: clean } });
    if (!tag) {
      tag = await db.tag.create({ data: { name: clean, color: "amber" } });
    }
    const app = await db.application.findUnique({
      where: { id: applicationId },
      select: { tags: true },
    });
    if (!app) return;
    let names: string[] = [];
    try {
      const parsed: unknown = JSON.parse(app.tags);
      if (Array.isArray(parsed)) {
        names = parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      names = [];
    }
    if (!names.includes(clean)) {
      names.push(clean);
      await db.application.update({
        where: { id: applicationId },
        data: { tags: JSON.stringify(names) },
      });
    }
    const link = await db.applicationTag.findUnique({
      where: { applicationId_tagId: { applicationId, tagId: tag.id } },
      select: { applicationId: true },
    });
    if (!link) {
      await db.applicationTag.create({
        data: { applicationId, tagId: tag.id, addedBy: addedBy?.trim() || null },
      });
    }
  } catch (error) {
    console.error(
      "[automation-rules] addApplicationTag gagal:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** True bila lamaran sudah punya tag tertentu (cek legacy JSON ATAU ApplicationTag link). */
async function applicationHasTag(applicationId: string, legacyTagsJson: string, name: string): Promise<boolean> {
  try {
    const parsed: unknown = JSON.parse(legacyTagsJson);
    if (Array.isArray(parsed) && parsed.includes(name)) return true;
  } catch {
    // legacy rusak — lanjut cek ApplicationTag
  }
  const tag = await db.tag.findUnique({ where: { name }, select: { id: true } });
  if (!tag) return false;
  const link = await db.applicationTag.findUnique({
    where: { applicationId_tagId: { applicationId, tagId: tag.id } },
    select: { applicationId: true },
  });
  return Boolean(link);
}

/* ------------------------------- Rule: SCORE_TAG ------------------------------- */

/**
 * Terapkan rule SCORE_TAG ke satu lamaran (dipakai batch maupun akhir processing).
 * Return true bila tag benar-benar baru dipasang (fired).
 */
async function applyScoreTagToApplication(
  applicationId: string,
  legacyTagsJson: string,
  aiScore: number,
  rule: AutomationRule,
  threshold: number,
): Promise<boolean> {
  if (aiScore < threshold) return false;
  if (await applicationHasTag(applicationId, legacyTagsJson, HIGH_POTENTIAL_TAG_NAME)) return false;
  await addApplicationTag(applicationId, HIGH_POTENTIAL_TAG_NAME, "Sistem");
  await db.activityLog
    .create({
      data: {
        applicationId,
        actor: "Sistem",
        action: "RULE_FIRE",
        detail: `Aturan otomatis ${rule.id} (SCORE_TAG): skor AI ${aiScore} >= ${threshold} — tag "${HIGH_POTENTIAL_TAG_NAME}" ditambahkan.`,
      },
    })
    .catch(() => undefined);
  return true;
}

/** Evaluasi rule SCORE_TAG untuk SATU lamaran (dipanggil dari processing.ts). Tidak pernah throw. */
export async function evaluateScoreTagForApplication(applicationId: string): Promise<void> {
  try {
    const config = await getAutomationConfig();
    const app = await db.application.findUnique({
      where: { id: applicationId },
      select: { id: true, aiScore: true, tags: true, deletedAt: true },
    });
    if (!app || app.deletedAt || app.aiScore === null) return;
    for (const rule of config.rules) {
      if (rule.type !== "SCORE_TAG" || !rule.enabled) continue;
      const threshold =
        rule.params.threshold ?? config.triageAlertThreshold ?? DEFAULT_TRIAGE_ALERT_THRESHOLD;
      await applyScoreTagToApplication(app.id, app.tags, app.aiScore, rule, threshold);
    }
  } catch (error) {
    console.error(
      "[automation-rules] evaluateScoreTagForApplication gagal:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/** Batch SCORE_TAG: semua lamaran aktif dengan aiScore >= ambang yang belum bertag. */
async function evaluateScoreTagRule(
  rule: AutomationRule,
  fallbackThreshold: number,
): Promise<number> {
  const threshold = rule.params.threshold ?? fallbackThreshold;
  const apps = await db.application.findMany({
    where: { deletedAt: null, aiScore: { gte: threshold } },
    select: { id: true, tags: true, aiScore: true },
    orderBy: { aiScore: "desc" },
    take: MAX_APPS_PER_RULE,
  });
  let fired = 0;
  for (const app of apps) {
    const done = await applyScoreTagToApplication(
      app.id,
      app.tags,
      app.aiScore ?? 0,
      rule,
      threshold,
    );
    if (done) fired += 1;
  }
  return fired;
}

/* ------------------------------ Rule: STAGE_AGING ------------------------------ */

/** Dedupe STAGE_AGING: true bila rule ini sudah pernah menyala untuk lamaran tsb SEJAK terakhir masuk tahap ini. */
async function stageAgingAlreadyFired(
  applicationId: string,
  ruleId: string,
  since: Date,
): Promise<boolean> {
  const existing = await db.activityLog.findFirst({
    where: {
      applicationId,
      action: "RULE_FIRE",
      detail: { contains: ruleId },
      createdAt: { gt: since },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function evaluateStageAgingRule(rule: AutomationRule): Promise<number> {
  const stage = (rule.params.stage ?? "").trim();
  const days = rule.params.days ?? 7;
  if (!stage) return 0;
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const apps = await db.application.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      status: stage,
      OR: [
        { stageUpdatedAt: { lt: cutoff } },
        { stageUpdatedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      name: true,
      trackingCode: true,
      stageUpdatedAt: true,
      updatedAt: true,
      position: { select: { title: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_APPS_PER_RULE,
  });

  const eligible: {
    id: string;
    name: string;
    trackingCode: string | null;
    positionTitle: string | null;
    waitingSince: Date;
  }[] = [];
  for (const app of apps) {
    const waitingSince = app.stageUpdatedAt ?? app.updatedAt;
    if (await stageAgingAlreadyFired(app.id, rule.id, waitingSince)) continue;
    eligible.push({
      id: app.id,
      name: app.name,
      trackingCode: app.trackingCode,
      positionTitle: app.position?.title ?? null,
      waitingSince,
    });
  }
  if (eligible.length === 0) return 0;

  // Telegram: daftar kandidat, tracking code, lama menunggu.
  const waitDaysOf = (since: Date) =>
    Math.max(1, Math.floor((now.getTime() - since.getTime()) / (24 * 60 * 60 * 1000)));
  const listText = eligible
    .slice(0, 15)
    .map(
      (app) =>
        `- ${app.name} (${app.trackingCode ?? "-"}) — posisi ${app.positionTitle ?? "-"}, menunggu ${waitDaysOf(app.waitingSince)} hari di tahap ${stageLabel(stage)}`,
    )
    .join("\n");
  const suffix = eligible.length > 15 ? `\n... dan ${eligible.length - 15} lainnya` : "";
  await sendTelegramAlert(
    "system",
    `Aturan Otomatis: Lamaran Menginap\nAturan ${rule.id} (STAGE_AGING): ${eligible.length} lamaran berada di tahap ${stageLabel(stage)} lebih dari ${days} hari.\n\n${listText}${suffix}`,
  );

  // ActivityLog RULE_FIRE per lamaran — dedupe mengacu pada baris ini.
  await db.activityLog
    .createMany({
      data: eligible.map((app) => ({
        applicationId: app.id,
        actor: "Sistem",
        action: "RULE_FIRE",
        detail: `Aturan otomatis ${rule.id} (STAGE_AGING): lamaran menginap lebih dari ${days} hari di tahap ${stageLabel(stage)} — alert Telegram terkirim.`,
      })),
    })
    .catch(() => undefined);
  return eligible.length;
}

/* ------------------------------ Rule: AUTO_REJECT ------------------------------ */

async function getSiteName(): Promise<string> {
  try {
    const row = await db.setting.findUnique({ where: { key: "site" } });
    if (!row) return "Lumina Studio";
    const parsed: unknown = JSON.parse(row.value);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).siteName === "string" &&
      ((parsed as Record<string, unknown>).siteName as string).trim()
    ) {
      return ((parsed as Record<string, unknown>).siteName as string).trim();
    }
  } catch {
    // diam — fallback nama default
  }
  return "Lumina Studio";
}

async function evaluateAutoRejectRule(rule: AutomationRule): Promise<number> {
  const stage = (rule.params.stage ?? "NEW").trim() || "NEW";
  const days = rule.params.days ?? 30;
  const sendEmail = rule.params.sendEmail === true;
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const apps = await db.application.findMany({
    where: {
      deletedAt: null,
      status: stage,
      OR: [
        { stageUpdatedAt: { lt: cutoff } },
        { stageUpdatedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      trackingCode: true,
      stageHistory: true,
      deletedAt: true,
      offerStatus: true,
      offerApprovalState: true,
      position: { select: { title: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_APPS_PER_RULE,
  });

  let fired = 0;
  for (const app of apps) {
    // PENGAMAN WAJIB — lamaran berikut ini TIDAK PERNAH disentuh aturan otomatis:
    // (1) punya Interview terjadwal/ajuan-ubah-jadwal di masa depan;
    // (2) offerStatus PENDING/ACCEPTED;
    // (3) persetujuan offer dua lapis sedang menunggu OWNER;
    // (4) soft-deleted (sudah difilter where, guard eksplisit di sini).
    if (app.deletedAt) continue;
    if (app.offerStatus === "PENDING" || app.offerStatus === "ACCEPTED") continue;
    if (app.offerApprovalState === "PENDING") continue;
    const futureInterview = await db.interview.findFirst({
      where: {
        applicationId: app.id,
        scheduledAt: { gte: now },
        status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"] },
      },
      select: { id: true },
    });
    if (futureInterview) continue;

    await db.application.update({
      where: { id: app.id },
      data: {
        status: "REJECTED",
        rejectionReason: "LAINNYA",
        rejectionNote: `Ditolak otomatis oleh aturan ${rule.id} (AUTO_REJECT): lamaran tidak bergerak dari tahap ${stageLabel(stage)} selama lebih dari ${days} hari.`,
        rejectedAt: now,
        stageUpdatedAt: now,
        stageHistory: appendStageHistory(app.stageHistory, "REJECTED", stage),
      },
    });
    await db.activityLog
      .create({
        data: {
          applicationId: app.id,
          actor: "Sistem",
          action: "RULE_FIRE",
          detail: `Aturan otomatis ${rule.id} (AUTO_REJECT): lamaran macet lebih dari ${days} hari di tahap ${stageLabel(stage)} — status diubah menjadi REJECTED (alasan: LAINNYA).`,
        },
      })
      .catch(() => undefined);

    if (sendEmail) {
      // Pola candidate-emails: antre ke EmailOutbox — aman bila SMTP belum ada (tetap QUEUED).
      const siteName = await getSiteName();
      const positionTitle = app.position?.title?.trim() || "posisi umum";
      const trackingCode = app.trackingCode?.trim() || "-";
      await queueEmail({
        toEmail: app.email,
        subject: `Kabar terbaru untuk lamaran kamu — ${positionTitle}`,
        body:
          `Halo ${app.name},\n\n` +
          `Terima kasih sudah melamar posisi ${positionTitle} di ${siteName}. ` +
          `Setelah lamaran kamu (${trackingCode}) tidak bergerak dari tahap ${stageLabel(stage)} selama lebih dari ${days} hari, ` +
          `sesuai ketentuan proses seleksi lamaran ini kami tutup secara otomatis pada ${now.toLocaleDateString("id-ID", { dateStyle: "long" })}.\n\n` +
          `Keputusan ini bukan akhir dari perjalanan kamu — kamu dipersilakan melamar lagi di kesempatan berikutnya.\n\n` +
          `Salam hangat,\nTim Rekrutmen ${siteName}`,
        kind: "REJECT",
        applicationId: app.id,
      });
    }
    fired += 1;
  }
  return fired;
}

/* ------------------------------ Orkestrasi evaluasi ------------------------------ */

/**
 * Evaluasi semua rule enabled. Dipanggil dari cron /api/cron/maintenance.
 * Throttle internal 20 menit (lastRulesEvalAt di Setting "automation") — bila dipanggil
 * lebih cepat dari itu, evaluasi dilewati (skippedReason "throttle").
 * Tidak pernah melempar error.
 */
export async function evaluateAutomationRules(): Promise<AutomationEvalSummary> {
  const ranAt = new Date().toISOString();
  const fired: Record<string, number> = {};
  try {
    const config = await getAutomationConfig();

    // Throttle internal: eval di-skip bila < 20 menit sejak terakhir.
    if (config.lastRulesEvalAt) {
      const last = Date.parse(config.lastRulesEvalAt);
      if (Number.isFinite(last) && Date.now() - last < EVAL_THROTTLE_MS) {
        return { fired, skippedReason: "throttle", ranAt };
      }
    }

    const enabledRules = config.rules.filter((rule) => rule.enabled);
    for (const rule of enabledRules) {
      let count = 0;
      try {
        if (rule.type === "STAGE_AGING") {
          count = await evaluateStageAgingRule(rule);
        } else if (rule.type === "SCORE_TAG") {
          count = await evaluateScoreTagRule(rule, config.triageAlertThreshold);
        } else if (rule.type === "AUTO_REJECT") {
          count = await evaluateAutoRejectRule(rule);
        }
      } catch (error) {
        // Satu rule gagal tidak boleh menghentikan rule lain.
        console.error(
          `[automation-rules] rule ${rule.id} (${rule.type}) gagal:`,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
      if (count > 0) {
        fired[rule.id] = count;
        rule.lastFiredAt = new Date().toISOString();
      }
    }

    // Simpan throttle + lastFiredAt per rule yang menyala.
    await saveAutomationConfig({ ...config, lastRulesEvalAt: ranAt });
    return { fired, ranAt };
  } catch (error) {
    console.error(
      "[automation-rules] evaluateAutomationRules gagal:",
      error instanceof Error ? error.message : String(error),
    );
    return { fired, skippedReason: "error", ranAt };
  }
}

/* --------------------------- Alert kandidat menarik --------------------------- */

/**
 * Alert "kandidat menarik baru": dipanggil dari processing.ts SETELAH AI screening selesai.
 * Bila aiScore >= triageAlertThreshold -> kirim Telegram format khusus + ActivityLog
 * HIGH_SCORE_ALERT. Selalu try/catch — tidak pernah menggagalkan pipeline.
 */
export async function notifyHighScore(applicationId: string): Promise<void> {
  try {
    const app = await db.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        name: true,
        trackingCode: true,
        aiScore: true,
        aiSummary: true,
        deletedAt: true,
        position: { select: { title: true } },
      },
    });
    if (!app || app.deletedAt || app.aiScore === null) return;

    const config = await getAutomationConfig();
    const threshold = config.triageAlertThreshold ?? DEFAULT_TRIAGE_ALERT_THRESHOLD;
    if (app.aiScore < threshold) return;

    const summary = (app.aiSummary ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    const positionTitle = app.position?.title?.trim() || "posisi umum";
    const text =
      `Kandidat menarik baru (skor ${app.aiScore}/100)\n` +
      `${app.name} — posisi ${positionTitle}\n` +
      `Kode: ${app.trackingCode ?? "-"}` +
      (summary ? `\nRingkasan AI: ${summary}` : "");
    await sendTelegramAlert("system", text);

    await db.activityLog
      .create({
        data: {
          applicationId: app.id,
          actor: "Sistem",
          action: "HIGH_SCORE_ALERT",
          detail: `Skor AI ${app.aiScore}/100 >= ambang ${threshold} — alert "kandidat menarik baru" dikirim ke Telegram.`,
        },
      })
      .catch(() => undefined);
  } catch (error) {
    console.error(
      "[automation-rules] notifyHighScore gagal:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
