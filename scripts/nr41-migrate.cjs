/* eslint-disable @typescript-eslint/no-require-imports */
// NR-41 — Skrip migrasi data (G9/G10/G13) — dijalankan SEKALI, idempotent.
//   1. Konsolidasi kandidat: kelompokkan Application by lower(trim(email)) ->
//      buat/ambil Candidate (nama/telepon dari lamaran terbaru, firstSeenAt =
//      min createdAt, lastAppliedAt = max createdAt, doNotHire = any(lamaran)
//      dengan alasan pertama yang ada) -> set candidateId semua anggota.
//   2. Tag JSON -> model Tag + ApplicationTag (dual-write legacy TETAP ada).
//      Tag unik case-insensitive; warna default "zinc"; addedBy null; dedupe.
//   3. ReferralSource: distinct Application.source (trim, non-kosong) ->
//      buat (kind OTHER, isActive true, sortOrder urut index) bila belum ada;
//      set Application.sourceId yang cocok by name.
//   4. Cetak ringkasan jumlah.
// Pemakaian: node scripts/nr41-migrate.cjs
const { PrismaClient } = require("@prisma/client");

const db = new PrismaClient();

/** Parse JSON string[] aman dari Application.tags. */
function parseTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => typeof t === "string")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  } catch {
    return [];
  }
}

async function migrateCandidates() {
  const apps = await db.application.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      doNotHire: true,
      doNotHireReason: true,
      candidateId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Kelompokkan by email ternormalisasi (lowercase-trim); email kosong dilewati.
  const groups = new Map();
  for (const app of apps) {
    const email = (app.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) continue;
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push(app);
  }

  let created = 0;
  let linked = 0;
  for (const [email, members] of groups) {
    const sorted = [...members].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = sorted[0];
    const latest = sorted[sorted.length - 1];
    const anyDnh = sorted.find((a) => a.doNotHire);

    let candidateId = null;
    const existing = await db.candidate.findUnique({ where: { email } });
    if (existing) {
      candidateId = existing.id;
      // Lengkapi profil yang masih kosong (idempotent: tak menimpa nilai yang ada).
      await db.candidate.update({
        where: { id: candidateId },
        data: {
          firstSeenAt:
            existing.firstSeenAt.getTime() <= first.createdAt.getTime()
              ? existing.firstSeenAt
              : first.createdAt,
          lastAppliedAt:
            existing.lastAppliedAt && existing.lastAppliedAt.getTime() >= latest.createdAt.getTime()
              ? existing.lastAppliedAt
              : latest.createdAt,
          doNotHire: existing.doNotHire || Boolean(anyDnh),
          doNotHireReason: existing.doNotHireReason ?? (anyDnh ? anyDnh.doNotHireReason : null),
        },
      });
    } else {
      const made = await db.candidate.create({
        data: {
          email,
          name: (latest.name ?? "").trim() || email,
          phone: (latest.phone ?? "").trim() || null,
          firstSeenAt: first.createdAt,
          lastAppliedAt: latest.createdAt,
          doNotHire: Boolean(anyDnh),
          doNotHireReason: anyDnh ? anyDnh.doNotHireReason : null,
        },
      });
      candidateId = made.id;
      created += 1;
    }

    // Tautkan semua anggota yang belum tertaut (atau tertaut ke kandidat lain).
    const needLink = members.filter((a) => a.candidateId !== candidateId);
    if (needLink.length > 0) {
      await db.application.updateMany({
        where: { id: { in: needLink.map((a) => a.id) } },
        data: { candidateId },
      });
      linked += needLink.length;
    }
  }
  return { groups: groups.size, created, linked };
}

async function migrateTags() {
  const apps = await db.application.findMany({ select: { id: true, tags: true } });
  // Pastikan row Tag untuk setiap nama tag (unik case-insensitive).
  const tagCache = new Map(); // key: lower(name) -> {id, name}
  const allTags = await db.tag.findMany();
  for (const tag of allTags) tagCache.set(tag.name.toLowerCase(), tag);

  let tagsCreated = 0;
  let linksCreated = 0;
  let linksSkipped = 0;

  for (const app of apps) {
    const names = [...new Set(parseTags(app.tags))]; // dedupe per lamaran
    if (names.length === 0) continue;
    for (const rawName of names) {
      const name = rawName.trim().slice(0, 60);
      if (!name) continue;
      let tag = tagCache.get(name.toLowerCase());
      if (!tag) {
        tag = await db.tag.create({ data: { name, color: "zinc" } });
        tagCache.set(tag.name.toLowerCase(), tag);
        tagsCreated += 1;
      }
      const link = await db.applicationTag.findUnique({
        where: { applicationId_tagId: { applicationId: app.id, tagId: tag.id } },
      });
      if (!link) {
        await db.applicationTag.create({
          data: { applicationId: app.id, tagId: tag.id, addedBy: null },
        });
        linksCreated += 1;
      } else {
        linksSkipped += 1;
      }
    }
  }
  return { tagsTotal: tagCache.size, tagsCreated, linksCreated, linksSkipped };
}

async function migrateReferralSources() {
  const rows = await db.application.findMany({
    select: { id: true, source: true, sourceId: true },
    orderBy: { createdAt: "asc" },
  });
  // Distinct source (trim, non-kosong) — urut kemunculan pertama.
  const names = [];
  for (const row of rows) {
    const name = (row.source ?? "").trim();
    if (!name || names.includes(name)) continue;
    names.push(name);
  }

  let sourcesCreated = 0;
  const cache = new Map(); // name -> id
  const existing = await db.referralSource.findMany();
  for (const src of existing) cache.set(src.name, src.id);

  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (!cache.has(name)) {
      const made = await db.referralSource.create({
        data: { name, kind: "OTHER", isActive: true, sortOrder: i },
      });
      cache.set(name, made.id);
      sourcesCreated += 1;
    }
  }

  // Set Application.sourceId yang cocok by name (yang masih null).
  let linked = 0;
  for (const row of rows) {
    const name = (row.source ?? "").trim();
    if (!name || row.sourceId) continue;
    const id = cache.get(name);
    if (!id) continue;
    await db.application.update({ where: { id: row.id }, data: { sourceId: id } });
    linked += 1;
  }
  return { distinctSources: names.length, sourcesCreated, linked };
}

(async () => {
  console.log("[nr41-migrate] mulai...");
  const candidates = await migrateCandidates();
  console.log(
    `[nr41-migrate] kandidat: ${candidates.groups} grup email, ${candidates.created} Candidate dibuat, ${candidates.linked} lamaran ditautkan`,
  );
  const tags = await migrateTags();
  console.log(
    `[nr41-migrate] tag: ${tags.tagsTotal} Tag total (${tags.tagsCreated} baru), ${tags.linksCreated} ApplicationTag dibuat, ${tags.linksSkipped} sudah ada`,
  );
  const sources = await migrateReferralSources();
  console.log(
    `[nr41-migrate] sumber: ${sources.distinctSources} nama unik, ${sources.sourcesCreated} ReferralSource dibuat, ${sources.linked} lamaran ditautkan`,
  );
  console.log(
    `[nr41-migrate] ringkasan akhir: Candidate=${await db.candidate.count()}, Tag=${await db.tag.count()}, ApplicationTag=${await db.applicationTag.count()}, ReferralSource=${await db.referralSource.count()}`,
  );
  console.log("[nr41-migrate] selesai.");
})()
  .catch((error) => {
    console.error("[nr41-migrate] GAGAL:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
