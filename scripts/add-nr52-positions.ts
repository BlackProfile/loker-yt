/**
 * NR-52 — One-time script: tambahkan 7 lowongan operasional & produksi
 * pendukung ke DB saat ini (sumber data: DEFAULT_POSITIONS di src/lib/defaults).
 *
 * Idempoten: posisi yang slug-nya sudah ada dilewati (tidak diduplikasi).
 * Jalankan: bun run scripts/add-nr52-positions.ts
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_POSITIONS } from "../src/lib/defaults";

const db = new PrismaClient();

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const NR52_TITLES = [
  "Pembersih Rumah",
  "Pembantu Rumah",
  "Audio Engineer",
  "Kameramen",
  "Asisten Studio",
  "Supir",
  "Admin Media Sosial",
];

async function ensureUniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let counter = 2;
  for (;;) {
    const existing = await db.position.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
    candidate = `${base}-${counter}`;
    counter += 1;
  }
}

async function main() {
  const targets = DEFAULT_POSITIONS.filter((p) => NR52_TITLES.includes(p.title));
  if (targets.length !== NR52_TITLES.length) {
    const found = new Set(targets.map((t) => t.title));
    const missing = NR52_TITLES.filter((t) => !found.has(t));
    throw new Error(`Definisi tidak lengkap di defaults.ts: ${missing.join(", ")}`);
  }

  let created = 0;
  let skipped = 0;
  for (const p of targets) {
    const slug = await ensureUniqueSlug(slugifyTitle(p.title));
    const existsByTitle = await db.position.findFirst({ where: { title: p.title }, select: { id: true } });
    if (existsByTitle) {
      console.log(`LEWATI (judul sudah ada): ${p.title}`);
      skipped += 1;
      continue;
    }
    await db.position.create({
      data: {
        title: p.title,
        slug,
        department: p.department,
        type: p.type,
        location: p.location,
        workMode: p.workMode ?? "REMOTE",
        city: p.city ?? null,
        address: p.address ?? null,
        mapsUrl: p.mapsUrl ?? null,
        workHours: p.workHours ?? null,
        shiftSystem: p.shiftSystem ?? "NONE",
        facilities: JSON.stringify(p.facilities ?? []),
        description: p.description,
        requirements: JSON.stringify(p.requirements),
        isActive: true,
        order: p.order,
        salaryText: p.salaryText ?? null,
        salaryVisible: p.salaryVisible ?? false,
        benefits: JSON.stringify(p.benefits ?? []),
        examples: JSON.stringify(p.examples ?? []),
        urgent: p.urgent ?? false,
        featured: p.featured ?? false,
        screeningQuestions: JSON.stringify(p.screeningQuestions ?? []),
        requireCv: p.requireCv ?? false,
        requireIntro: p.requireIntro ?? false,
        requirePortfolio: p.requirePortfolio ?? false,
        customDocs: JSON.stringify(p.customDocs ?? []),
        minAge: p.minAge ?? null,
        showCvField: p.showCvField ?? true,
        showIntroField: p.showIntroField ?? true,
        showPortfolioField: p.showPortfolioField ?? true,
        showSocialField: p.showSocialField ?? true,
        showExpectedSalary: p.showExpectedSalary ?? true,
        aiCriteria: p.aiCriteria ?? null,
        applyTemplate: p.applyTemplate ?? null,
        acceptTemplate: p.acceptTemplate ?? null,
        rejectTemplate: p.rejectTemplate ?? null,
        assignmentTitle: p.assignmentTitle ?? null,
        assignmentUrl: p.assignmentUrl ?? null,
        assignmentNote: p.assignmentNote ?? null,
        rubricCriteria: JSON.stringify(p.rubricCriteria ?? []),
        checklistTemplate: JSON.stringify(p.checklistTemplate ?? []),
        noteTemplates: JSON.stringify(p.noteTemplates ?? []),
      },
    });
    console.log(`DIBUAT: ${p.title} → slug ${slug}`);
    created += 1;
  }
  console.log(`\nSelesai — dibuat: ${created}, dilewati: ${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
