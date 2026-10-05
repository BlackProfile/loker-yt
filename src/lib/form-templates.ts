// NR-32 — Template pertanyaan "Data Diri Lengkap" untuk Form Builder.
// File CLIENT-SAFE: hanya tipe & konstanta dari form-schema.ts (tanpa db/prisma).
//
// Model mental:
// - Setiap template adalah PAKET pertanyaan siap pakai yang disuntikkan admin ke
//   satu bagian (biodata atau bagian kustom) lewat tombol "Tambah dari template".
// - `key` field bersifat stabil untuk referensi antar-field (showIfKey) tapi ID
//   final dibangun saat injeksi (newFormId("tpl_<key>")) agar unik per posisi.
// - Semua label dua bahasa (ID wajib, EN menyertai). Grup menghasilkan
//   sub-header kecil di wizard (mis. "Kontak Darurat").
// - Template "data-diri-lengkap" juga menyalakan item inti NIK & Tanggal Lahir
//   (enablesCore) — keduanya tersimpan sebagai kolom tersendiri Application.

import type { FormFieldType } from "@/lib/form-schema";

export type FormTemplateField = {
  /** Kunci stabil template — dirujuk showIfKey antar-field dalam template. */
  key: string;
  type: FormFieldType;
  label: string;
  labelEn: string;
  placeholder?: string;
  helpText?: string;
  options?: string[];
  required: boolean;
  group: string;
  groupEn: string;
  autocomplete?: string;
  /** Kunci field sumber syarat tampil (harus field pilihan sebelum field ini). */
  showIfKey?: string;
  showIfValues?: string[];
};

export type FormTemplate = {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  /** Item inti biodata yang ikut dinyalakan saat template diterapkan. */
  enablesCore?: { nik?: boolean; birthDate?: boolean };
  fields: FormTemplateField[];
};

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: "data-diri-lengkap",
    name: "Data Diri Lengkap",
    nameEn: "Complete Personal Details",
    description:
      "9 pertanyaan standar rekrutmen Indonesia: lahir, alamat, pendidikan, kontak darurat, hingga ukuran seragam. Juga menyalakan NIK & Tanggal Lahir terstruktur.",
    descriptionEn:
      "9 standard Indonesian recruitment questions: birth, address, education, emergency contact, uniform size. Also enables structured NIK & Birth Date.",
    enablesCore: { nik: true, birthDate: true },
    fields: [
      {
        key: "tempat_lahir",
        type: "text",
        label: "Tempat Lahir",
        labelEn: "Place of Birth",
        placeholder: "cth. Bandung",
        required: false,
        group: "Identitas",
        groupEn: "Identity",
        autocomplete: "off",
      },
      {
        key: "jenis_kelamin",
        type: "dropdown",
        label: "Jenis Kelamin",
        labelEn: "Gender",
        options: ["Laki-laki", "Perempuan", "Tidak ingin menyebutkan"],
        required: false,
        group: "Identitas",
        groupEn: "Identity",
        autocomplete: "sex",
      },
      {
        key: "alamat_domisili",
        type: "textarea",
        label: "Alamat Domisili",
        labelEn: "Home Address",
        placeholder: "Nama jalan, no. rumah, RT/RW, kelurahan, kecamatan, kota",
        required: true,
        group: "Domisili",
        groupEn: "Address",
        autocomplete: "street-address",
      },
      {
        key: "pendidikan_terakhir",
        type: "dropdown",
        label: "Pendidikan Terakhir",
        labelEn: "Highest Education",
        options: ["SMP", "SMA/SMK", "D3", "S1", "S2", "Lainnya"],
        required: false,
        group: "Pendidikan",
        groupEn: "Education",
      },
      {
        key: "nama_sekolah",
        type: "text",
        label: "Nama Sekolah/Kampus Terakhir",
        labelEn: "Last School/University",
        placeholder: "cth. SMK Negeri 2 Surabaya",
        required: false,
        group: "Pendidikan",
        groupEn: "Education",
      },
      {
        key: "status_pernikahan",
        type: "dropdown",
        label: "Status Pernikahan",
        labelEn: "Marital Status",
        options: ["Belum menikah", "Menikah", "Cerai"],
        required: false,
        group: "Identitas",
        groupEn: "Identity",
      },
      {
        key: "kd_nama",
        type: "text",
        label: "Nama Kontak Darurat",
        labelEn: "Emergency Contact Name",
        placeholder: "cth. Rina (kakak)",
        required: true,
        group: "Kontak Darurat",
        groupEn: "Emergency Contact",
      },
      {
        key: "kd_hubungan",
        type: "dropdown",
        label: "Hubungan dengan Kontak Darurat",
        labelEn: "Relationship to Emergency Contact",
        options: ["Orang tua", "Saudara", "Pasangan", "Teman", "Lainnya"],
        required: false,
        group: "Kontak Darurat",
        groupEn: "Emergency Contact",
      },
      {
        key: "kd_hp",
        type: "text",
        label: "Nomor HP Kontak Darurat",
        labelEn: "Emergency Contact Phone",
        placeholder: "cth. 0812xxxxxxx",
        required: true,
        group: "Kontak Darurat",
        groupEn: "Emergency Contact",
        autocomplete: "tel",
      },
      {
        key: "sosmed_aktif",
        type: "url",
        label: "Media Sosial Aktif (Instagram/TikTok)",
        labelEn: "Active Social Media (Instagram/TikTok)",
        placeholder: "https://instagram.com/...",
        required: false,
        group: "Lainnya",
        groupEn: "Others",
        autocomplete: "url",
      },
      {
        key: "mulai_bekerja",
        type: "date",
        label: "Kapan Bisa Mulai Bekerja",
        labelEn: "Available Start Date",
        required: false,
        group: "Lainnya",
        groupEn: "Others",
      },
      {
        key: "ukuran_seragam",
        type: "dropdown",
        label: "Ukuran Seragam",
        labelEn: "Uniform Size",
        options: ["S", "M", "L", "XL", "XXL"],
        required: false,
        group: "Lainnya",
        groupEn: "Others",
      },
    ],
  },
  {
    id: "supir-operasional",
    name: "Paket Supir & Operasional",
    nameEn: "Driver & Operations Pack",
    description:
      "Pertanyaan untuk posisi yang butuh SIM & kendaraan: jenis SIM, masa berlaku, kendaraan sendiri, kesiapan OT/menginap saat syuting.",
    descriptionEn:
      "Questions for roles needing a driving license: license type, expiry, own vehicle, readiness for overtime/overnight shoots.",
    fields: [
      {
        key: "punya_sim",
        type: "radio",
        label: "Punya SIM yang masih berlaku?",
        labelEn: "Do you hold a valid driving license?",
        options: ["Ya", "Tidak"],
        required: true,
        group: "Berkendara",
        groupEn: "Driving",
      },
      {
        key: "jenis_sim",
        type: "checkbox",
        label: "Jenis SIM yang dimiliki",
        labelEn: "License types you hold",
        options: ["SIM A", "SIM B1", "SIM B2", "SIM C"],
        required: false,
        group: "Berkendara",
        groupEn: "Driving",
        showIfKey: "punya_sim",
        showIfValues: ["Ya"],
      },
      {
        key: "sim_berlaku",
        type: "date",
        label: "SIM berlaku sampai",
        labelEn: "License valid until",
        required: false,
        group: "Berkendara",
        groupEn: "Driving",
        showIfKey: "punya_sim",
        showIfValues: ["Ya"],
      },
      {
        key: "kendaraan_sendiri",
        type: "radio",
        label: "Punya kendaraan sendiri?",
        labelEn: "Do you own a vehicle?",
        options: ["Motor sendiri", "Mobil sendiri", "Motor & mobil", "Tidak punya"],
        required: false,
        group: "Berkendara",
        groupEn: "Driving",
      },
      {
        key: "ot_menginap",
        type: "radio",
        label: "Bersedia lembur/menginap saat syuting?",
        labelEn: "Willing to work overtime/overnight during shoots?",
        options: ["Nyaman", "Bisa jika perlu", "Tidak nyaman"],
        required: true,
        group: "Kesiapan",
        groupEn: "Availability",
      },
      {
        key: "angkat_beban",
        type: "radio",
        label: "Mampu mengangkat peralatan berat (10-20 kg)?",
        labelEn: "Able to lift heavy equipment (10-20 kg)?",
        options: ["Ya", "Tidak"],
        required: false,
        group: "Kesiapan",
        groupEn: "Availability",
      },
    ],
  },
  {
    id: "kreator-konten",
    name: "Paket Kreator Konten",
    nameEn: "Content Creator Pack",
    description:
      "Pertanyaan untuk posisi produksi/kreatif: peralatan yang dikuasai, pengalaman, dan tautan karya/media sosial.",
    descriptionEn:
      "Questions for production/creative roles: equipment skills, experience, and portfolio/social links.",
    fields: [
      {
        key: "alat_dikuasai",
        type: "checkbox",
        label: "Peralatan yang bisa kamu operasikan",
        labelEn: "Equipment you can operate",
        options: [
          "Kamera DSLR/Mirrorless",
          "Lighting",
          "Audio/Mic",
          "Gimbal",
          "Drone",
          "Editing (Premiere/CapCut)",
          "Belum ada",
        ],
        required: false,
        group: "Keahlian",
        groupEn: "Skills",
      },
      {
        key: "lama_pengalaman",
        type: "radio",
        label: "Berapa lama pengalaman produksi kamu?",
        labelEn: "How long is your production experience?",
        options: ["Kurang dari 1 tahun", "1-3 tahun", "3-5 tahun", "Lebih dari 5 tahun"],
        required: false,
        group: "Keahlian",
        groupEn: "Skills",
      },
      {
        key: "link_karya",
        type: "url",
        label: "Tautan Karya/Reel Terbaik",
        labelEn: "Link to Your Best Work/Reel",
        placeholder: "https://...",
        required: false,
        group: "Karya",
        groupEn: "Portfolio",
        autocomplete: "url",
      },
      {
        key: "handle_ig",
        type: "url",
        label: "Instagram yang kamu kelola",
        labelEn: "Instagram account you manage",
        placeholder: "https://instagram.com/...",
        required: false,
        group: "Karya",
        groupEn: "Portfolio",
        autocomplete: "url",
      },
      {
        key: "handle_tiktok",
        type: "url",
        label: "TikTok yang kamu kelola",
        labelEn: "TikTok account you manage",
        placeholder: "https://tiktok.com/@...",
        required: false,
        group: "Karya",
        groupEn: "Portfolio",
        autocomplete: "url",
      },
    ],
  },
];

/**
 * NR-32 — konversi satu template menjadi draf FormField siap injeksi builder.
 * ID dibangun dari key template + suffix acak agar unik per posisi (kunci
 * jawaban stabil), showIfKey dipetakan ke id final field sumber.
 */
export function expandTemplateFields(
  template: FormTemplate,
  newId: (key: string) => string,
): {
  id: string;
  type: FormFieldType;
  label: string;
  labelEn: string;
  required: boolean;
  options: string[];
  allowOther: boolean;
  placeholder?: string;
  helpText?: string;
  group: string;
  groupEn: string;
  autocomplete?: string;
  showIf?: { fieldId: string; values: string[] };
}[] {
  const idByKey = new Map<string, string>();
  for (const f of template.fields) idByKey.set(f.key, newId(f.key));
  return template.fields.map((f) => {
    const out = {
      id: idByKey.get(f.key) ?? f.key,
      type: f.type,
      label: f.label,
      labelEn: f.labelEn,
      required: f.required,
      options: f.options ? [...f.options] : [],
      allowOther: false,
      placeholder: f.placeholder,
      helpText: f.helpText,
      group: f.group,
      groupEn: f.groupEn,
      autocomplete: f.autocomplete,
      showIf: undefined as { fieldId: string; values: string[] } | undefined,
    };
    if (f.showIfKey && f.showIfValues && f.showIfValues.length > 0) {
      const srcId = idByKey.get(f.showIfKey);
      if (srcId) out.showIf = { fieldId: srcId, values: [...f.showIfValues] };
    }
    return out;
  });
}
