// /api/admin/applications/[id]/onboarding-pack — paket onboarding hasil AI (NR49 Paket D).
// GET    — baca Application.onboardingPack (JSON) → { pack } atau { pack: null }.
// POST   — hasilkan paket dengan AI; hanya untuk kandidat yang sudah diterima (hiredAt).
// PATCH  — simpan hasil suntingan admin { pack: { checklist, welcomeEmail, equipment } }.
// OWNER/HR (VIEWER 403). AI mengusulkan; admin selalu bisa menyunting sebelum dipakai.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject, asTrimmedString } from "@/lib/ai-json";
import { withAiGate, AiGateError } from "@/lib/ai-control";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };
const NOT_HIRED = { error: "Onboarding hanya untuk kandidat yang sudah diterima." };

const AI_TIMEOUT_MS = 120_000;

export type OnboardingPackData = {
  checklist: string[];
  welcomeEmail: string;
  equipment: string[];
  generatedAt?: string;
  editedAt?: string;
};

function workModeLabel(mode: string): string {
  if (mode === "ONSITE") return "tatap muka di kantor";
  if (mode === "HYBRID") return "hibrida (kantor & remote)";
  return "remote";
}

function parseFacilities(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Normalisasi array string dari nilai LLM/input: buang kosong, unik, batasi jumlah & panjang. */
function sanitizeStringList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => asTrimmedString(item, maxLen))
    .filter((item) => item.length > 0)
    .filter((item, index, all) => all.indexOf(item) === index);
  return items.slice(0, maxItems);
}

function parsePack(raw: string | null): OnboardingPackData | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const data = parsed as Record<string, unknown>;
    const checklist = sanitizeStringList(data.checklist, 12, 200);
    const equipment = sanitizeStringList(data.equipment, 10, 160);
    const welcomeEmail = asTrimmedString(data.welcomeEmail, 4000);
    if (checklist.length === 0 && equipment.length === 0 && !welcomeEmail) return null;
    return {
      checklist,
      welcomeEmail,
      equipment,
      generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : undefined,
      editedAt: typeof data.editedAt === "string" ? data.editedAt : undefined,
    };
  } catch {
    return null;
  }
}

async function loadHiredApplication(id: string) {
  return db.application.findUnique({
    where: { id },
    include: { position: { select: { title: true, workMode: true, city: true, facilities: true } } },
  });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { id } = await params;
    const application = await db.application.findUnique({
      where: { id },
      select: { onboardingPack: true },
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    return NextResponse.json({ pack: parsePack(application.onboardingPack) });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/onboarding-pack]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal memuat paket onboarding. Coba lagi nanti." },
      { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { id } = await params;
    const application = await loadHiredApplication(id);
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (!application.hiredAt) {
      return NextResponse.json(NOT_HIRED, { status: 400 });
    }

    const position = application.position;
    const facilities = position ? parseFacilities(position.facilities).slice(0, 6) : [];
    const startDate = application.offerStartDate
      ? application.offerStartDate.toLocaleDateString("id-ID", { dateStyle: "long" })
      : null;

    const pack = await withAiGate(
      "onboarding",
      { actor: session.name, detailOk: `Onboarding ${application.name}` },
      async () => {
        const systemPrompt =
          "Kamu adalah koordinator onboarding studio konten kreator Lumina Studio. Susun paket " +
          "onboarding praktis berbahasa Indonesia formal, tanpa emoji, tanpa markdown. " +
          "Gunakan HANYA data yang diberikan; jangan mengarang kebijakan atau angka gaji. Jawab HANYA JSON valid.";
        const userPrompt = [
          "Susun paket onboarding untuk karyawan baru berikut.",
          "",
          `Nama karyawan: ${application.name}`,
          `Posisi: ${position?.title ?? "Tanpa posisi"}`,
          application.offerType ? `Jenis kontrak: ${application.offerType}` : "",
          startDate ? `Tanggal mulai: ${startDate}` : "",
          position
            ? `Mode kerja: ${workModeLabel(position.workMode)}${position.city ? ` — ${position.city}` : ""}`
            : "",
          facilities.length ? `Fasilitas kantor: ${facilities.join(", ")}` : "",
          "",
          "Aturan output:",
          "- checklist: 6-8 item kalimat pendek untuk hari pertama & minggu pertama (orientasi, akses, perkenalan tim, target belajar).",
          "- welcomeEmail: email sambutan minimal 80 karakter, sapa memakai nama karyawan, jelaskan rangkaian awal, tutup dengan tanda tangan Tim Lumina Studio.",
          "- equipment: 3-6 item kebutuhan peralatan/akses yang perlu disiapkan.",
          'Balas HANYA JSON valid satu baris: {"checklist": ["..."], "welcomeEmail": "...", "equipment": ["..."]}',
        ]
          .filter(Boolean)
          .join("\n");

        const completion = await withTimeout(
          withZaiRetry((zai) =>
            zai.chat.completions.create({
              messages: [
                { role: "assistant", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              thinking: { type: "disabled" },
            }),
          ),
          "Penyusunan paket onboarding",
          AI_TIMEOUT_MS,
        );
        const raw = completion?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJsonObject(raw);
        if (!parsed) {
          throw new Error("AI tidak menghasilkan paket yang valid.");
        }
        const checklist = sanitizeStringList(parsed.checklist, 8, 200);
        const equipment = sanitizeStringList(parsed.equipment, 6, 160);
        const welcomeEmail = asTrimmedString(parsed.welcomeEmail, 4000);
        if (checklist.length < 3 || !welcomeEmail) {
          throw new Error("AI tidak menghasilkan paket yang lengkap.");
        }
        return { checklist, welcomeEmail, equipment };
      },
    );

    const stored: OnboardingPackData = {
      ...pack,
      generatedAt: new Date().toISOString(),
    };
    await db.application.update({
      where: { id },
      data: { onboardingPack: JSON.stringify(stored) },
    });

    return NextResponse.json({ pack: stored });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/applications/[id]/onboarding-pack]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal menyusun paket onboarding. Coba lagi sebentar." },
      { status: 502 },
    );
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const rawPack = (body as Record<string, unknown>).pack;
    if (!rawPack || typeof rawPack !== "object" || Array.isArray(rawPack)) {
      return NextResponse.json({ error: "Data paket tidak valid." }, { status: 400 });
    }
    const data = rawPack as Record<string, unknown>;

    const checklist = sanitizeStringList(data.checklist, 12, 200);
    const equipment = sanitizeStringList(data.equipment, 10, 160);
    const welcomeEmail = asTrimmedString(data.welcomeEmail, 4000);
    if (checklist.length === 0) {
      return NextResponse.json({ error: "Checklist wajib berisi minimal satu item." }, { status: 400 });
    }
    if (!welcomeEmail) {
      return NextResponse.json({ error: "Email sambutan wajib diisi." }, { status: 400 });
    }

    const application = await db.application.findUnique({
      where: { id },
      select: { onboardingPack: true },
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const previous = parsePack(application.onboardingPack);
    const stored: OnboardingPackData = {
      checklist,
      welcomeEmail,
      equipment,
      generatedAt: previous?.generatedAt ?? new Date().toISOString(),
      editedAt: new Date().toISOString(),
    };
    await db.application.update({
      where: { id },
      data: { onboardingPack: JSON.stringify(stored) },
    });

    return NextResponse.json({ pack: stored });
  } catch (error) {
    console.error("[PATCH /api/admin/applications/[id]/onboarding-pack]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal menyimpan paket onboarding. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
