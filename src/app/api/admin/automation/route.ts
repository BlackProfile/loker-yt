// GET/PUT /api/admin/automation — pengaturan mesin aturan otomatis (Task 4-a).
//   GET  (OWNER/HR) : baca Setting "automation" dinormalisasi (hilang/rusak -> default).
//   PUT  (OWNER)    : validasi + simpan { triageAlertThreshold, rules }.
//     - triageAlertThreshold: bulat 0-100 (default 80).
//     - rules: array MAKS 20; tiap rule { id, type, enabled, params }.
//       type: STAGE_AGING | AUTO_REJECT | SCORE_TAG.
//       params: { stage? (<=40 char), days? (1-365), threshold? (0-100), sendEmail? (boolean) }.
//       Field di luar daftar dibuang; lastFiredAt dikelola engine (nilai masukan diabaikan,
//       nilai lama dipertahankan bila id rule sama).
// Pola auth mengikuti route admin lain (getSession dari src/lib/server-auth.ts).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import {
  AUTOMATION_RULE_TYPES,
  DEFAULT_TRIAGE_ALERT_THRESHOLD,
  getAutomationConfig,
  normalizeAutomationConfig,
  saveAutomationConfig,
  type AutomationConfig,
  type AutomationRule,
  type AutomationRuleType,
} from "@/lib/automation-rules";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const MAX_RULES = 20;

function isRuleType(value: unknown): value is AutomationRuleType {
  return typeof value === "string" && (AUTOMATION_RULE_TYPES as string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validasi payload PUT secara manual (konsisten pola route admin lain).
 * Return { config } bila valid, atau { error } dengan pesan Indonesia.
 */
function validateAutomationPayload(
  data: Record<string, unknown>,
): { config: AutomationConfig } | { error: string } {
  // triageAlertThreshold — opsional (default dipakai bila tidak dikirim).
  let triageAlertThreshold = DEFAULT_TRIAGE_ALERT_THRESHOLD;
  if (data.triageAlertThreshold !== undefined) {
    const num = Number(data.triageAlertThreshold);
    if (!Number.isInteger(num) || num < 0 || num > 100) {
      return { error: "Ambang skor alert harus angka bulat 0 sampai 100." };
    }
    triageAlertThreshold = num;
  }

  // rules — wajib array (boleh kosong) dan maksimal MAX_RULES.
  if (!Array.isArray(data.rules)) {
    return { error: "Daftar aturan (rules) harus berupa array." };
  }
  if (data.rules.length > MAX_RULES) {
    return { error: `Maksimal ${MAX_RULES} aturan.` };
  }

  const rules: AutomationRule[] = [];
  const seenIds = new Set<string>();
  for (let index = 0; index < data.rules.length; index++) {
    const raw = data.rules[index];
    if (!isRecord(raw)) return { error: `Aturan ke-${index + 1} tidak valid.` };
    if (!isRuleType(raw.type)) {
      return { error: `Aturan ke-${index + 1} punya jenis (type) yang tidak dikenal.` };
    }
    const idRaw = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!idRaw || idRaw.length > 60) {
      return { error: `Aturan ke-${index + 1} butuh id teks 1-60 karakter.` };
    }
    if (seenIds.has(idRaw)) {
      return { error: `Id aturan "${idRaw}" ganda — gunakan id unik.` };
    }
    seenIds.add(idRaw);
    if (typeof raw.enabled !== "boolean") {
      return { error: `Aturan "${idRaw}" butuh field enabled (true/false).` };
    }

    const paramsRaw = isRecord(raw.params) ? raw.params : {};
    const params: AutomationRule["params"] = {};
    if (paramsRaw.stage !== undefined && paramsRaw.stage !== null) {
      if (
        typeof paramsRaw.stage !== "string" ||
        !paramsRaw.stage.trim() ||
        paramsRaw.stage.trim().length > 40
      ) {
        return { error: `Aturan "${idRaw}": tahap (stage) harus teks 1-40 karakter.` };
      }
      params.stage = paramsRaw.stage.trim();
    }
    if (paramsRaw.days !== undefined && paramsRaw.days !== null) {
      const days = Number(paramsRaw.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return { error: `Aturan "${idRaw}": hari harus angka bulat 1 sampai 365.` };
      }
      params.days = days;
    }
    if (paramsRaw.threshold !== undefined && paramsRaw.threshold !== null) {
      const threshold = Number(paramsRaw.threshold);
      if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100) {
        return { error: `Aturan "${idRaw}": ambang skor harus angka bulat 0 sampai 100.` };
      }
      params.threshold = threshold;
    }
    if (paramsRaw.sendEmail !== undefined) {
      if (typeof paramsRaw.sendEmail !== "boolean") {
        return { error: `Aturan "${idRaw}": sendEmail harus true/false.` };
      }
      params.sendEmail = paramsRaw.sendEmail;
    }

    rules.push({ id: idRaw, type: raw.type, enabled: raw.enabled, params });
  }

  return { config: { triageAlertThreshold, rules } };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "HR") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const automation = await getAutomationConfig();
    return NextResponse.json({ automation });
  } catch (error) {
    console.error("[GET /api/admin/automation]", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan aturan otomatis." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!isRecord(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }

    const result = validateAutomationPayload(body);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Pertahankan lastFiredAt & lastRulesEvalAt milik engine untuk id rule yang sama.
    const current = await getAutomationConfig();
    const lastFiredById = new Map<string, string>();
    for (const rule of current.rules) {
      if (rule.lastFiredAt) lastFiredById.set(rule.id, rule.lastFiredAt);
    }
    const merged: AutomationConfig = {
      ...result.config,
      rules: result.config.rules.map((rule) => {
        const lastFiredAt = lastFiredById.get(rule.id);
        return lastFiredAt ? { ...rule, lastFiredAt } : rule;
      }),
      ...(current.lastRulesEvalAt ? { lastRulesEvalAt: current.lastRulesEvalAt } : {}),
    };

    await saveAutomationConfig(merged);
    const saved = normalizeAutomationConfig(merged);
    return NextResponse.json({ ok: true, automation: saved });
  } catch (error) {
    console.error("[PUT /api/admin/automation]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan pengaturan aturan otomatis." },
      { status: 500 },
    );
  }
}
