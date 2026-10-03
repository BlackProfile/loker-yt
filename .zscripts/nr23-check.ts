// NR-23 sanity check — kontrak form-schema tanpa bagian bawaan + label kustom.
// Jalankan: bun .zscripts/nr23-check.ts
import {
  FORM_SCHEMA_VERSION,
  buildDefaultSchema,
  coreItemLabel,
  isExperienceRequired,
  isMotivationRequired,
  normalizeFormSchema,
  sanitizeFormSchemaInput,
  parseFormSchema,
} from "../src/lib/form-schema";

let failed = 0;
function ok(cond: boolean, label: string) {
  if (cond) console.log(`  OK  ${label}`);
  else {
    failed += 1;
    console.error(`  FAIL ${label}`);
  }
}

console.log("== sanitize: bagian inti boleh absen ==");
const noFiles = {
  version: 2,
  sections: [
    { id: "sec_biodata", kind: "biodata", title: "Data Diri", waRequired: false, nameLabel: "Nama Karyawan", emailLabel: "Email Aktif" },
    { id: "sec_custom1", kind: "custom", title: "Pertanyaan" },
  ],
  fields: [{ id: "fld_1", sectionId: "sec_custom1", type: "text", label: "Siapa namamu?", required: true, options: [], allowOther: false }],
  retiredFields: [],
};
const s1 = sanitizeFormSchemaInput(noFiles);
ok(s1.ok && s1.value != null, "sanitize sukses");
const p1 = s1.ok && s1.value ? parseFormSchema(s1.value) : null;
ok(p1 != null && p1.sections.length === 2, `bagian files TIDAK disisipkan paksa (dapat ${p1?.sections.length ?? -1})`);
ok(p1?.sections.some((s) => s.id === "sec_biodata" && s.waRequired === false) ?? false, "waRequired=false tersimpan");
ok(p1?.sections.find((s) => s.id === "sec_biodata")?.nameLabel === "Nama Karyawan", "nameLabel kustom tersimpan");
ok(p1?.retiredFields.length === 0, "retired kosong untuk skema baru");

console.log("== normalize: v2 dipercaya apa adanya ==");
const n1 = normalizeFormSchema(p1);
ok(n1 === p1, "v2 tanpa biodata/files tidak diubah normalize");
const n2 = normalizeFormSchema({ version: 1, sections: [], fields: [], retiredFields: [] });
ok(n2 != null && n2.sections.length === 3, "v1 remnant tetap dirakit ulang jadi 3 bagian inti");

console.log("== label kosong = label bawaan ==");
const biodata = p1?.sections.find((s) => s.kind === "biodata");
ok(coreItemLabel(biodata!, "name") === "Nama Karyawan", "coreItemLabel pakai kustom");
ok(coreItemLabel(biodata!, "wa") === "Nomor WhatsApp", "coreItemLabel fallback bawaan");

console.log("== flag wajib pengalaman/motivasi ==");
const withExp = {
  version: 2,
  sections: [
    { id: "sec_biodata", kind: "biodata", title: "Data Diri" },
    { id: "sec_exp", kind: "experience", title: "Pengalaman", experienceEnabled: true, experienceRequired: false, motivationEnabled: true },
  ],
  fields: [],
  retiredFields: [],
};
const s2 = sanitizeFormSchemaInput(withExp);
const p2 = s2.ok && s2.value ? parseFormSchema(s2.value) : null;
const exp = p2?.sections.find((s) => s.kind === "experience");
ok(exp != null && exp.experienceRequired === false, "experienceRequired=false tersimpan");
ok(isExperienceRequired(exp!) === false, "isExperienceRequired false");
ok(isMotivationRequired(exp!) === true, "isMotivationRequired default true");
// enabled=false memaksa required=false
const s3 = sanitizeFormSchemaInput({ ...withExp, sections: [{ id: "sec_biodata", kind: "biodata", title: "D" }, { id: "sec_exp", kind: "experience", title: "P", experienceEnabled: false, experienceRequired: true }] });
const p3 = s3.ok && s3.value ? parseFormSchema(s3.value) : null;
const exp3 = p3?.sections.find((s) => s.kind === "experience");
ok(exp3?.experienceRequired === false, "enabled=false memaksa required=false");

console.log("== validasi label kustom ==");
const badLabel = sanitizeFormSchemaInput({
  version: 2,
  sections: [{ id: "sec_biodata", kind: "biodata", title: "D", nameLabel: "x".repeat(61) }],
  fields: [],
  retiredFields: [],
});
ok(!badLabel.ok, `label >60 karakter ditolak (${badLabel.ok ? "lolos" : badLabel.error})`);

console.log("== hapus bagian berisi field -> retired otomatis ==");
const prevSchema = buildDefaultSchema({ screeningQuestions: [{ id: "1", label: "Domisili?", required: true }], customDocs: [] });
const prevStr = sanitizeFormSchemaInput(prevSchema);
const next = {
  version: 2,
  sections: [{ id: "sec_biodata", kind: "biodata", title: "Data Diri" }],
  fields: [],
  retiredFields: [],
};
const s4 = sanitizeFormSchemaInput(next, { previousSchemaRaw: prevStr.ok ? prevStr.value : null });
const p4 = s4.ok && s4.value ? parseFormSchema(s4.value) : null;
ok(p4?.retiredFields.some((r) => r.label === "Domisili?") ?? false, "field bagian yang dihapus masuk retiredFields");

console.log("== skema kosong total masih valid (identitas dari wizard) ==");
const s5 = sanitizeFormSchemaInput({ version: 2, sections: [], fields: [], retiredFields: [] });
ok(s5.ok, "sections=[] diterima server");

console.log(failed === 0 ? "\nSEMUA CEK LULUS" : `\n${failed} CEK GAGAL`);
process.exit(failed === 0 ? 0 : 1);
