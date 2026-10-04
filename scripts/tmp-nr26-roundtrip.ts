// Uji sekali-pakai NR-26 — round-trip core overrides di form-schema (dihapus setelah uji).
import {
  sanitizeFormSchemaInput,
  parseFormSchema,
  normalizeFormSchema,
  coreItem,
  coreItemLabel,
  isEmailRequired,
  isExperienceRequired,
  isMotivationRequired,
  isWaRequired,
  sectionHasStep,
  defaultBiodataSection,
  defaultExperienceSection,
  defaultFilesSection,
} from "../src/lib/form-schema";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass += 1;
  } else {
    fail += 1;
    console.error(`GAGAL: ${name}`);
  }
}

const draft = {
  version: 2,
  sections: [
    {
      ...defaultBiodataSection(),
      waRequired: false,
      core: {
        name: { label: "Nama Panggilan", placeholder: "cth. Rani", helpText: "Tanpa gelar" },
        email: { label: "Email Aktif", required: false },
        wa: { label: "No. WA" },
        // kunci asing yang harusnya dibuang:
        hobby: { label: "Hobi" },
      },
    },
    {
      ...defaultExperienceSection(),
      core: {
        experience: { label: "Pengalaman Bertani", required: false },
        motivation: { label: "Kenapa Studio Kami" },
      },
    },
    {
      ...defaultFilesSection(),
      cvRequired: true,
      core: { cv: { label: "CV Terbaru" }, bogus: { label: "X" } },
    },
  ],
  fields: [],
  retiredFields: [],
};

// 1) sanitize menerima draft dengan core
const sanitized = sanitizeFormSchemaInput(draft, { previousSchemaRaw: null });
check("sanitize ok", sanitized.ok === true);
if (!sanitized.ok || !sanitized.value) {
  console.error("sanitize gagal, berhenti");
  process.exit(1);
}
const json = JSON.parse(sanitized.value);

// 2) kunci asing dibuang
check("biodata core tanpa kunci asing", !("hobby" in json.sections[0].core));
check("files core tanpa bogus", !("bogus" in json.sections[2].core));

// 3) name tidak pernah opsional
check("name tanpa required=false", json.sections[0].core.name.required === undefined);

// 4) required=false tersimpan, label ramping
check("email required false tersimpan", json.sections[0].core.email.required === false);
check("wa required tidak tersimpan (default wajib)", !("required" in json.sections[0].core.wa));
check("experience required false tersimpan", json.sections[1].core.experience.required === false);
check("motivation tanpa required", !("required" in json.sections[1].core.motivation));
check("cv hanya label", Object.keys(json.sections[2].core.cv).join(",") === "label");

// 5) parse kembali → getter benar
const parsed = parseFormSchema(sanitized.value);
check("parse ok", parsed != null);
if (parsed) {
  const norm = normalizeFormSchema(parsed);
  if (norm) {
    const bio = norm.sections.find((s) => s.kind === "biodata")!;
    const exp = norm.sections.find((s) => s.kind === "experience")!;
    const fil = norm.sections.find((s) => s.kind === "files")!;
    check("label name terbaca", coreItemLabel(bio, "name") === "Nama Panggilan");
    check("label email terbaca", coreItemLabel(bio, "email") === "Email Aktif");
    check("label wa terbaca", coreItemLabel(bio, "wa") === "No. WA");
    check("fallback label cv bawaan", coreItemLabel(fil, "cv") === "CV Terbaru");
    check("fallback label portfolio bawaan", coreItemLabel(fil, "portfolio") === "Link Portofolio / Video");
    check("email opsional", isEmailRequired(bio) === false);
    check("wa opsional via flag", isWaRequired(bio) === false);
    check("experience opsional", isExperienceRequired(exp) === false);
    check("motivation tetap wajib", isMotivationRequired(exp) === true);
    check("placeholder name", coreItem(bio, "name").placeholder === "cth. Rani");
    check("helpText name", coreItem(bio, "name").helpText === "Tanpa gelar");
    check("langkah biodata tetap ada", sectionHasStep(norm, bio) === true);

    // 6) core kosong → hilang dari JSON (ramping)
    const emptyDraft = {
      version: 2,
      sections: [defaultBiodataSection(), defaultExperienceSection(), defaultFilesSection()],
      fields: [],
      retiredFields: [],
    };
    const s2 = sanitizeFormSchemaInput(emptyDraft);
    if (s2.ok && s2.value) {
      const j2 = JSON.parse(s2.value);
      check("tanpa core → JSON tanpa kunci core", !("core" in j2.sections[0]));
      // core dengan objek kosong → dibuang
      const s3 = sanitizeFormSchemaInput({
        ...emptyDraft,
        sections: [{ ...defaultBiodataSection(), core: {} }, defaultExperienceSection(), defaultFilesSection()],
      });
      check("core kosong diterima", s3.ok === true);
      if (s3.ok && s3.value) {
        const j3 = JSON.parse(s3.value);
        check("core {} dibuang", !("core" in j3.sections[0]));
      }
    }
  }
}

// 7) skema rusak: core berupa array/number → diabaikan
const s4 = sanitizeFormSchemaInput({
  version: 2,
  sections: [{ ...defaultBiodataSection(), core: ["x"] }, defaultExperienceSection(), defaultFilesSection()],
  fields: [],
  retiredFields: [],
});
check("core array ditolak dengan aman (dibuang)", s4.ok === true);

console.log(`\nHASIL: ${pass} lulus, ${fail} gagal`);
process.exit(fail > 0 ? 1 : 0);
