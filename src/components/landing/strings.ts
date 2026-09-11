// Kamus label UI statis untuk landing page (ID/EN).
// Konten dinamis dari admin (siteName, hero*, benefit, faq, teamMembers, deadline)
// TIDAK diterjemahkan — tetap memakai bahasa aslinya.

export const LANGS = ["id", "en"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_STORAGE_KEY = "lumina-lang";

const id = {
  aria: {
    langToggle: "Ganti bahasa",
    themeToggle: "Ganti tema",
  },
  nav: {
    positions: "Posisi",
    benefits: "Benefit",
    howToApply: "Cara Lamar",
    faq: "FAQ",
    status: "Cek Status",
    applyNow: "Lamar Sekarang",
    openMenu: "Buka menu",
    mainNav: "Navigasi utama",
    mobileNav: "Menu seluler",
  },
  hero: {
    viewPositions: "Lihat Posisi",
    statsOpen: "Posisi Terbuka",
    statsApps: "Pelamar Masuk",
    statsRemote: "Tim Remote",
    deadlinePrefix: "Pendaftaran ditutup:",
    countdown: {
      days: "Hari",
      hours: "Jam",
      minutes: "Menit",
      seconds: "Detik",
      aria: "Hitung mundur penutupan pendaftaran",
    },
    share: {
      trigger: "Bagikan halaman ini",
      copy: "Salin Link",
      whatsapp: "WhatsApp",
      twitter: "X/Twitter",
      qr: "QR Code",
      qrTitle: "QR Code Halaman",
      qrCaption: "Scan untuk membuka halaman rekrutmen",
      qrAlt: "Kode QR halaman rekrutmen",
      copied: "Link disalin ke clipboard",
      copyFailed: "Gagal menyalin link",
      shareText: "Yuk gabung tim kreator",
    },
  },
  positions: {
    badge: "Lowongan",
    title: "Posisi yang Dibutuhkan",
    desc: "Semua peran bersifat remote dan fleksibel. Temukan yang paling sesuai dengan keahlianmu.",
    all: "Semua",
    deptLabel: "Filter departemen",
    typeLabel: "Filter jenis pekerjaan",
    requirementsCount: "persyaratan",
    detail: "Detail",
    detailAria: "Lihat detail & lamar",
    apply: "Lamar Posisi Ini",
    closesPrefix: "Ditutup",
    dialogDescTitle: "Deskripsi",
    dialogReqTitle: "Persyaratan",
    dialogShare: "Tanya via WhatsApp",
    dialogShareText: "Halo! Saya tertarik dengan posisi",
    reqFallback: "Detail kebutuhan menyusul.",
    emptyTitle: "Belum ada posisi yang dibuka.",
    emptyBody: "Pantau terus halaman ini.",
    filterEmptyTitle: "Tidak ada posisi yang cocok.",
    filterEmptyBody: "Coba ubah atau hapus filter yang aktif.",
    featured: "Unggulan",
    urgent: "Urgent",
    baru: "Baru",
    segeraDitutup: "Segera Ditutup",
    kuotaPenuh: "Kuota Penuh",
    sisaKuota: "Sisa {n} Kuota",
    chipMore: "+{n}",
    gaji: "Gaji",
    benefitLainnya: "+{n} lainnya",
    dialogBenefitTitle: "Benefit",
    contohKarya: "Contoh Karya",
    adaTes: "Ada tes seleksi",
    bukaTautan: "Buka Tautan",
    bagikan: "Bagikan Posisi",
    bagikanWa: "WhatsApp",
    bagikanSalin: "Salin Link",
    bagikanQr: "QR Code",
    qrTitle: "QR Code Posisi",
    qrCaption: "Scan untuk membuka detail lowongan ini",
    qrAlt: "Kode QR lowongan",
    salinBerhasil: "Link posisi disalin ke clipboard",
    salinGagal: "Gagal menyalin link",
    waCaption: "Lowongan {title} di {siteName}",
    waDaftar: "Daftar:",
    lamarDitutup: "Ditutup",
    tutup: "Tutup",
    coverAlt: "Sampul lowongan {title}",
  },
  about: {
    badge: "Tentang Kami",
    cardTitle: "Berkarya bersama, tumbuh bersama.",
    cardBody:
      "Kami membangun rumah kreatif tempat ide-ide liar dieksekusi dengan rapi.",
    statActive: "Posisi Aktif",
    statApps: "Lamaran Masuk",
    statCommunity: "Komunitas",
  },
  benefits: {
    badge: "Benefit",
    title: "Kenapa Bergabung dengan Kami?",
    desc: "Lebih dari sekadar pekerjaan — kami bantu kamu bertumbuh jadi kreator profesional.",
    empty: "Benefit akan segera diumumkan.",
  },
  howTo: {
    badge: "Alur",
    title: "Cara Melamar",
    desc: "Empat langkah sederhana dari menemukan posisi hingga menjadi bagian dari tim.",
    steps: [
      {
        title: "Pilih Posisi",
        description:
          "Telusuri lowongan yang tersedia dan temukan yang paling cocok dengan keahlianmu.",
      },
      {
        title: "Isi Formulir",
        description:
          "Lengkapi data diri dan tautan karyamu. Hanya butuh 3 menit.",
      },
      {
        title: "Wawancara Online",
        description:
          "Tim kami akan menghubungimu via WhatsApp atau email untuk sesi tanya jawab.",
      },
      {
        title: "Gabung Tim",
        description:
          "Ikuti onboarding singkat dan mulai proyek pertamamu bersama kami.",
      },
    ],
  },
  apply: {
    badge: "Formulir",
    title: "Siap Bergabung dengan Kami?",
    desc: "Isi formulir dengan data terbaikmu. Semakin jelas portofolio dan pengalamanmu, semakin besar peluangmu untuk diterima.",
    trust: [
      "Data kamu aman dan hanya dipakai untuk seleksi",
      "Respons dalam 1-3 hari kerja",
      "Pertanyaan? Hubungi kami",
    ],
    contactTitle: "Kontak",
    contactWhatsapp: "WhatsApp",
    formTitle: "Formulir Lamaran",
    requiredBefore: "Kolom bertanda",
    requiredAfter: "wajib diisi.",
    stepOf: "Langkah",
    steps: ["Data Diri", "Pengalaman", "Berkas", "Pratinjau & Kirim"],
    fields: {
      name: "Nama Lengkap",
      namePh: "cth. Rani Putri",
      email: "Email",
      emailPh: "nama@email.com",
      phone: "No. WhatsApp",
      phonePh: "6281234567890",
      position: "Posisi yang Dilamar",
      positionPh: "Pilih posisi",
      positionEmpty: "Belum ada posisi tersedia",
      portfolio: "Link Portofolio / Video",
      social: "Link Sosial Media",
      experience: "Pengalaman Kamu",
      experiencePh:
        "Contoh: Selama 2 tahun saya membuat video pendek di TikTok dan mengelola akun dengan 50 ribu pengikut.",
      motivation: "Alasan Bergabung",
      motivationPh:
        "Contoh: Saya ingin bertumbuh bersama tim kreatif dan berkontribusi pada konten yang bermanfaat bagi banyak orang.",
      source: "Dari mana kamu tahu lowongan ini?",
      sourcePh: "Pilih sumber (opsional)",
    },
    errors: {
      name: "Nama lengkap wajib diisi.",
      emailRequired: "Email wajib diisi.",
      emailInvalid: "Format email tidak valid.",
      phoneRequired: "No. WhatsApp wajib diisi.",
      phoneMin: "No. WhatsApp minimal 8 digit.",
      position: "Pilih posisi yang dilamar.",
      experience: "Ceritakan pengalamanmu minimal 10 karakter.",
      motivation: "Tulis alasanmu minimal 10 karakter.",
      screeningRequired: "Jawaban \"{label}\" wajib diisi.",
      portfolioRequired: "Portofolio atau link sosial media wajib untuk posisi ini.",
      cvRequired: "CV wajib diunggah untuk posisi ini.",
      introRequired: "Audio/video perkenalan wajib diunggah untuk posisi ini.",
      cvType: "CV harus berupa file PDF.",
      cvSize: "Ukuran CV maksimal 5 MB.",
      introType: "File harus berupa audio (mp3, wav, atau m4a).",
      introSize: "Ukuran audio maksimal 10 MB.",
      submitFailed: "Gagal mengirim lamaran. Coba lagi ya.",
    },
    draft: {
      title: "Draft ditemukan",
      body: "Lanjutkan mengisi formulir dari simpanan terakhir?",
      restore: "Pulihkan",
      discard: "Hapus",
      savedPrefix: "Disimpan",
    },
    summary: {
      title: "Ringkasan Lamaran",
      name: "Nama",
      position: "Posisi",
      email: "Email",
      phone: "WhatsApp",
      notChosen: "Belum dipilih",
    },
    preview: {
      badge: "Langkah Terakhir",
      title: "Pratinjau Lamaran",
      desc: "Periksa kembali seluruh data di bawah ini sebelum dikirim. Pastikan semuanya sudah benar dan tidak ada salah ketik.",
      sectionPersonal: "Data Diri",
      sectionAnswers: "Pengalaman & Jawaban",
      sectionFiles: "Berkas Terlampir",
      sectionScreening: "Jawaban Screening",
      edit: "Ubah",
      notFilled: "Tidak diisi",
      noFile: "Tidak diunggah",
      notAnswered: "Tidak dijawab",
      agreeLabel:
        "Saya menyatakan bahwa data di atas benar, akurat, dan dapat dipertanggungjawabkan.",
      agreeRequired:
        "Centang pernyataan kebenaran data sebelum mengirim lamaran.",
      confirmTitle: "Kirim lamaran sekarang?",
      confirmDesc:
        "Setelah terkirim, isi lamaran tidak bisa diubah lagi. Kamu akan menerima kode pelacakan untuk memantau status seleksi.",
      confirmYes: "Ya, Kirim Lamaran",
      confirmCancel: "Periksa Lagi",
      privacyNote:
        "Lamaran baru benar-benar dikirim setelah kamu konfirmasi — tidak ada data yang terkirim otomatis.",
    },
    uploads: {
      cvLabel: "CV (PDF, maks 5 MB)",
      introLabel:
        "Video/Audio perkenalan singkat (maks 10 MB) — membantu peluang lolos",
      dropHint: "Klik atau seret file ke sini",
      remove: "Hapus file",
      optional: "Opsional",
      required: "Wajib",
      cvRequiredHint: "Posisi ini mewajibkan CV",
      introRequiredHint: "Posisi ini mewajibkan audio/video perkenalan",
    },
    screening: {
      sectionTitle: "Pertanyaan untuk Posisi Ini",
      requiredMark: "(wajib)",
      answerPh: "Tulis jawabanmu di sini...",
    },
    buttons: {
      back: "Kembali",
      next: "Lanjut",
      review: "Pratinjau Lamaran",
      submit: "Kirim Lamaran",
      submitting: "Mengirim...",
    },
    success: {
      title: "Lamaran Terkirim!",
      thanksTo: "Terima kasih,",
      body: "Lamaranmu sudah kami terima. Tim kami akan menghubungimu via email atau WhatsApp dalam 1-3 hari kerja.",
      trackingLabel: "Kode Pelacakan",
      copy: "Salin kode",
      copied: "Kode disalin",
      saveNote:
        "Simpan kode ini untuk memantau status lamaranmu di bagian Cek Status.",
      checkStatus: "Cek Status Sekarang",
      another: "Kirim Lamaran Lain",
      autoReplyTitle: "Pesan dari Tim",
      nextStepsTitle: "Langkah Selanjutnya",
      openBrief: "Buka Brief Tes",
      assignmentFallback: "Tes Seleksi",
    },
  },
  status: {
    badge: "Pelacakan",
    title: "Cek Status Lamaran",
    desc: "Masukkan kode pelacakan yang kamu terima setelah mengirim lamaran untuk melihat progres seleksi.",
    codeLabel: "Kode Pelacakan",
    codePh: "LM-XXXXXX",
    track: "Lacak",
    tracking: "Melacak...",
    notFound: "Kode tidak ditemukan. Periksa kembali kode kamu.",
    resultTitle: "Progres Lamaran",
    positionLabel: "Posisi",
    submittedLabel: "Dikirim",
    accepted: "Diterima",
    rejected: "Tidak Lolos",
    assignmentTitle: "Tes Seleksi",
    openBrief: "Buka Brief Tes",
  },
  voices: {
    badge: "Suara Tim",
    title: "Apa Kata Tim Kami",
    desc: "Beberapa orang yang sudah lebih dulu berkarya di sini.",
  },
  subscribe: {
    title: "Tidak menemukan posisi yang cocok?",
    body: "Daftarkan emailmu dan kami beri tahu begitu ada lowongan baru yang dibuka.",
    emailPh: "nama@email.com",
    button: "Beri Tahu Saya",
    loading: "Mendaftarkan...",
    emailInvalid: "Masukkan email yang valid.",
    success: "Terima kasih! Kami akan mengabari kamu saat ada posisi baru.",
    failed: "Gagal mendaftar. Coba lagi ya.",
  },
  faq: {
    badge: "FAQ",
    title: "Pertanyaan yang Sering Diajukan",
    desc: "Belum menemukan jawaban? Hubungi kami via WhatsApp.",
    empty: "Belum ada pertanyaan yang terdaftar.",
  },
  cta: {
    title: "Masih ragu untuk mulai?",
    desc: "Ngobrol dulu santai dengan tim kami. Siapkan portofolio terbaikmu, sisanya kita bantu.",
    apply: "Lamar Sekarang",
    whatsapp: "Chat via WhatsApp",
  },
  footer: {
    nav: "Navigasi",
    contact: "Kontak",
    whatsapp: "WhatsApp",
  },
  chat: {
    open: "Buka obrolan",
    close: "Tutup obrolan",
    title: "Lumina Bot",
    online: "Online",
    welcome:
      "Halo! Aku Lumina Bot. Tanyakan apa saja seputar rekrutmen di sini.",
    inputPh: "Tulis pertanyaanmu...",
    send: "Kirim pesan",
    error: "Maaf, terjadi kesalahan. Coba lagi ya.",
    chips: [
      "Apakah masih ada posisi terbuka?",
      "Sistem kerjanya seperti apa?",
      "Boleh remote dari kota lain?",
    ],
  },
  embed: {
    applyButton: "Lamar di Situs Utama",
  },
  detail: {
    back: "Kembali ke Daftar Lowongan",
    badge: "Detail Lowongan",
    posted: "Dipublikasikan",
    live: "Pembaruan langsung",
    notFoundTitle: "Lowongan tidak ditemukan",
    notFoundDesc: "Lowongan ini sudah ditutup, diarsipkan, atau tautannya tidak valid.",
    browseOthers: "Lihat lowongan lain",
    badgeClosed: "Ditutup",
    badgeNew: "Baru",
    badgeSoon: "Segera Ditutup",
    badgeUrgent: "Urgent",
    badgeFeatured: "Unggulan",
    sectionDesc: "Deskripsi Posisi",
    sectionReq: "Persyaratan",
    sectionTerms: "Ketentuan Lamaran",
    sectionBenefit: "Benefit",
    sectionWorks: "Contoh Karya",
    termsFiles: "Berkas wajib",
    termsFilesCv: "CV (PDF)",
    termsFilesIntro: "Audio/video perkenalan",
    termsFilesPortfolio: "Tautan portofolio",
    termsFilesNone: "Tanpa berkas khusus — cukup isi formulir.",
    termsDeadline: "Batas waktu",
    termsDeadlineNone: "Dibuka sampai kuota penuh",
    termsQuota: "Kuota pelamar",
    termsQuotaValue: "{used}/{max} terisi — sisa {left} tempat",
    termsQuotaFull: "Kuota sudah penuh",
    termsQuotaUnlimited: "Tanpa kuota",
    termsProcess: "Proses seleksi",
    termsTest: "Tes seleksi",
    termsScreening: "Pertanyaan screening",
    termsScreeningCount: "{n} pertanyaan diisi saat melamar",
    termsScreeningNone: "Tanpa pertanyaan screening",
    shareLabel: "Bagikan lowongan ini",
    shareCopied: "Tautan lowongan disalin",
    shareCopy: "Salin Tautan",
    applyClosedTitle: "Pendaftaran Ditutup",
    applyClosedDesc: "Formulir online untuk lowongan ini sudah ditutup. Silakan hubungi kami untuk info lebih lanjut.",
    applyDisabledDesc: "Pendaftaran online sedang dinonaktifkan. Silakan hubungi kami melalui kontak berikut.",
  },
};

export type Dict = idDictShape;
type idDictShape = {
  aria: { langToggle: string; themeToggle: string };
  nav: {
    positions: string;
    benefits: string;
    howToApply: string;
    faq: string;
    status: string;
    applyNow: string;
    openMenu: string;
    mainNav: string;
    mobileNav: string;
  };
  hero: {
    viewPositions: string;
    statsOpen: string;
    statsApps: string;
    statsRemote: string;
    deadlinePrefix: string;
    countdown: {
      days: string;
      hours: string;
      minutes: string;
      seconds: string;
      aria: string;
    };
    share: {
      trigger: string;
      copy: string;
      whatsapp: string;
      twitter: string;
      qr: string;
      qrTitle: string;
      qrCaption: string;
      qrAlt: string;
      copied: string;
      copyFailed: string;
      shareText: string;
    };
  };
  positions: {
    badge: string;
    title: string;
    desc: string;
    all: string;
    deptLabel: string;
    typeLabel: string;
    requirementsCount: string;
    detail: string;
    detailAria: string;
    apply: string;
    closesPrefix: string;
    dialogDescTitle: string;
    dialogReqTitle: string;
    dialogShare: string;
    dialogShareText: string;
    reqFallback: string;
    emptyTitle: string;
    emptyBody: string;
    filterEmptyTitle: string;
    filterEmptyBody: string;
    featured: string;
    urgent: string;
    baru: string;
    segeraDitutup: string;
    kuotaPenuh: string;
    sisaKuota: string;
    chipMore: string;
    gaji: string;
    benefitLainnya: string;
    dialogBenefitTitle: string;
    contohKarya: string;
    adaTes: string;
    bukaTautan: string;
    bagikan: string;
    bagikanWa: string;
    bagikanSalin: string;
    bagikanQr: string;
    qrTitle: string;
    qrCaption: string;
    qrAlt: string;
    salinBerhasil: string;
    salinGagal: string;
    waCaption: string;
    waDaftar: string;
    lamarDitutup: string;
    tutup: string;
    coverAlt: string;
  };
  about: {
    badge: string;
    cardTitle: string;
    cardBody: string;
    statActive: string;
    statApps: string;
    statCommunity: string;
  };
  benefits: { badge: string; title: string; desc: string; empty: string };
  howTo: {
    badge: string;
    title: string;
    desc: string;
    steps: { title: string; description: string }[];
  };
  apply: {
    badge: string;
    title: string;
    desc: string;
    trust: string[];
    contactTitle: string;
    contactWhatsapp: string;
    formTitle: string;
    requiredBefore: string;
    requiredAfter: string;
    stepOf: string;
    steps: string[];
    fields: {
      name: string;
      namePh: string;
      email: string;
      emailPh: string;
      phone: string;
      phonePh: string;
      position: string;
      positionPh: string;
      positionEmpty: string;
      portfolio: string;
      social: string;
      experience: string;
      experiencePh: string;
      motivation: string;
      motivationPh: string;
      source: string;
      sourcePh: string;
    };
    errors: {
      name: string;
      emailRequired: string;
      emailInvalid: string;
      phoneRequired: string;
      phoneMin: string;
      position: string;
      experience: string;
      motivation: string;
      screeningRequired: string;
      portfolioRequired: string;
      cvRequired: string;
      introRequired: string;
      cvType: string;
      cvSize: string;
      introType: string;
      introSize: string;
      submitFailed: string;
    };
    draft: {
      title: string;
      body: string;
      restore: string;
      discard: string;
      savedPrefix: string;
    };
    summary: {
      title: string;
      name: string;
      position: string;
      email: string;
      phone: string;
      notChosen: string;
    };
    preview: {
      badge: string;
      title: string;
      desc: string;
      sectionPersonal: string;
      sectionAnswers: string;
      sectionFiles: string;
      sectionScreening: string;
      edit: string;
      notFilled: string;
      noFile: string;
      notAnswered: string;
      agreeLabel: string;
      agreeRequired: string;
      confirmTitle: string;
      confirmDesc: string;
      confirmYes: string;
      confirmCancel: string;
      privacyNote: string;
    };
    uploads: {
      cvLabel: string;
      introLabel: string;
      dropHint: string;
      remove: string;
      optional: string;
      required: string;
      cvRequiredHint: string;
      introRequiredHint: string;
    };
    screening: {
      sectionTitle: string;
      requiredMark: string;
      answerPh: string;
    };
    buttons: {
      back: string;
      next: string;
      review: string;
      submit: string;
      submitting: string;
    };
    success: {
      title: string;
      thanksTo: string;
      body: string;
      trackingLabel: string;
      copy: string;
      copied: string;
      saveNote: string;
      checkStatus: string;
      another: string;
      autoReplyTitle: string;
      nextStepsTitle: string;
      openBrief: string;
      assignmentFallback: string;
    };
  };
  status: {
    badge: string;
    title: string;
    desc: string;
    codeLabel: string;
    codePh: string;
    track: string;
    tracking: string;
    notFound: string;
    resultTitle: string;
    positionLabel: string;
    submittedLabel: string;
    accepted: string;
    rejected: string;
    assignmentTitle: string;
    openBrief: string;
  };
  voices: { badge: string; title: string; desc: string };
  subscribe: {
    title: string;
    body: string;
    emailPh: string;
    button: string;
    loading: string;
    emailInvalid: string;
    success: string;
    failed: string;
  };
  faq: { badge: string; title: string; desc: string; empty: string };
  cta: {
    title: string;
    desc: string;
    apply: string;
    whatsapp: string;
  };
  footer: {
    nav: string;
    contact: string;
    whatsapp: string;
  };
  chat: {
    open: string;
    close: string;
    title: string;
    online: string;
    welcome: string;
    inputPh: string;
    send: string;
    error: string;
    chips: string[];
  };
  embed: { applyButton: string };
  detail: {
    back: string;
    badge: string;
    posted: string;
    live: string;
    notFoundTitle: string;
    notFoundDesc: string;
    browseOthers: string;
    badgeClosed: string;
    badgeNew: string;
    badgeSoon: string;
    badgeUrgent: string;
    badgeFeatured: string;
    sectionDesc: string;
    sectionReq: string;
    sectionTerms: string;
    sectionBenefit: string;
    sectionWorks: string;
    termsFiles: string;
    termsFilesCv: string;
    termsFilesIntro: string;
    termsFilesPortfolio: string;
    termsFilesNone: string;
    termsDeadline: string;
    termsDeadlineNone: string;
    termsQuota: string;
    termsQuotaValue: string;
    termsQuotaFull: string;
    termsQuotaUnlimited: string;
    termsProcess: string;
    termsTest: string;
    termsScreening: string;
    termsScreeningCount: string;
    termsScreeningNone: string;
    shareLabel: string;
    shareCopied: string;
    shareCopy: string;
    applyClosedTitle: string;
    applyClosedDesc: string;
    applyDisabledDesc: string;
  };
};

const en: Dict = {
  aria: {
    langToggle: "Switch language",
    themeToggle: "Toggle theme",
  },
  nav: {
    positions: "Positions",
    benefits: "Benefits",
    howToApply: "How to Apply",
    faq: "FAQ",
    status: "Track Status",
    applyNow: "Apply Now",
    openMenu: "Open menu",
    mainNav: "Main navigation",
    mobileNav: "Mobile menu",
  },
  hero: {
    viewPositions: "View Positions",
    statsOpen: "Open Roles",
    statsApps: "Applications",
    statsRemote: "Remote Team",
    deadlinePrefix: "Applications close:",
    countdown: {
      days: "Days",
      hours: "Hours",
      minutes: "Minutes",
      seconds: "Seconds",
      aria: "Countdown to application deadline",
    },
    share: {
      trigger: "Share this page",
      copy: "Copy Link",
      whatsapp: "WhatsApp",
      twitter: "X/Twitter",
      qr: "QR Code",
      qrTitle: "Page QR Code",
      qrCaption: "Scan to open the recruitment page",
      qrAlt: "QR code of the recruitment page",
      copied: "Link copied to clipboard",
      copyFailed: "Failed to copy link",
      shareText: "Join our creator team",
    },
  },
  positions: {
    badge: "Openings",
    title: "Positions We Need",
    desc: "All roles are remote and flexible. Find the one that fits your skills best.",
    all: "All",
    deptLabel: "Filter by department",
    typeLabel: "Filter by job type",
    requirementsCount: "requirements",
    detail: "Details",
    detailAria: "View details & apply",
    apply: "Apply for This Role",
    closesPrefix: "Closes",
    dialogDescTitle: "Description",
    dialogReqTitle: "Requirements",
    dialogShare: "Ask via WhatsApp",
    dialogShareText: "Hello! I am interested in the position",
    reqFallback: "Detailed requirements to follow.",
    emptyTitle: "No positions are open yet.",
    emptyBody: "Keep an eye on this page.",
    filterEmptyTitle: "No matching positions.",
    filterEmptyBody: "Try changing or clearing the active filters.",
    featured: "Featured",
    urgent: "Urgent",
    baru: "New",
    segeraDitutup: "Closing Soon",
    kuotaPenuh: "Quota Full",
    sisaKuota: "{n} Spots Left",
    chipMore: "+{n}",
    gaji: "Salary",
    benefitLainnya: "+{n} more",
    dialogBenefitTitle: "Benefits",
    contohKarya: "Sample Work",
    adaTes: "Selection test required",
    bukaTautan: "Open Link",
    bagikan: "Share Position",
    bagikanWa: "WhatsApp",
    bagikanSalin: "Copy Link",
    bagikanQr: "QR Code",
    qrTitle: "Position QR Code",
    qrCaption: "Scan to open this position's details",
    qrAlt: "Position QR code",
    salinBerhasil: "Position link copied to clipboard",
    salinGagal: "Failed to copy link",
    waCaption: "Opening: {title} at {siteName}",
    waDaftar: "Apply:",
    lamarDitutup: "Closed",
    tutup: "Close",
    coverAlt: "Cover for {title}",
  },
  about: {
    badge: "About Us",
    cardTitle: "Create together, grow together.",
    cardBody:
      "We build a creative home where wild ideas are executed beautifully.",
    statActive: "Active Roles",
    statApps: "Applications",
    statCommunity: "Community",
  },
  benefits: {
    badge: "Benefits",
    title: "Why Join Us?",
    desc: "More than just a job — we help you grow into a professional creator.",
    empty: "Benefits will be announced soon.",
  },
  howTo: {
    badge: "Process",
    title: "How to Apply",
    desc: "Four simple steps from finding a position to becoming part of the team.",
    steps: [
      {
        title: "Pick a Position",
        description:
          "Browse the available openings and find the one that fits your skills.",
      },
      {
        title: "Fill the Form",
        description:
          "Complete your details and links to your work. It only takes 3 minutes.",
      },
      {
        title: "Online Interview",
        description:
          "Our team will reach out via WhatsApp or email for a short Q&A session.",
      },
      {
        title: "Join the Team",
        description:
          "Follow a quick onboarding and start your first project with us.",
      },
    ],
  },
  apply: {
    badge: "Application",
    title: "Ready to Join Us?",
    desc: "Fill in the form with your best data. The clearer your portfolio and experience, the bigger your chance to be accepted.",
    trust: [
      "Your data is safe and only used for selection",
      "Response within 1-3 business days",
      "Questions? Contact us",
    ],
    contactTitle: "Contact",
    contactWhatsapp: "WhatsApp",
    formTitle: "Application Form",
    requiredBefore: "Fields marked with",
    requiredAfter: "are required.",
    stepOf: "Step",
    steps: ["Personal Data", "Experience", "Files", "Review & Submit"],
    fields: {
      name: "Full Name",
      namePh: "e.g. Rani Putri",
      email: "Email",
      emailPh: "name@email.com",
      phone: "WhatsApp Number",
      phonePh: "6281234567890",
      position: "Position Applying For",
      positionPh: "Choose a position",
      positionEmpty: "No positions available",
      portfolio: "Portfolio / Video Link",
      social: "Social Media Link",
      experience: "Your Experience",
      experiencePh:
        "Example: For 2 years I made short videos on TikTok and managed an account with 50 thousand followers.",
      motivation: "Why You Want to Join",
      motivationPh:
        "Example: I want to grow with the creative team and contribute to content that benefits many people.",
      source: "How did you hear about this opening?",
      sourcePh: "Choose a source (optional)",
    },
    errors: {
      name: "Full name is required.",
      emailRequired: "Email is required.",
      emailInvalid: "Invalid email format.",
      phoneRequired: "WhatsApp number is required.",
      phoneMin: "WhatsApp number must be at least 8 digits.",
      position: "Choose the position you are applying for.",
      experience: "Describe your experience with at least 10 characters.",
      motivation: "Write your reason with at least 10 characters.",
      screeningRequired: "The answer to \"{label}\" is required.",
      portfolioRequired: "A portfolio or social media link is required for this position.",
      cvRequired: "A CV is required for this position.",
      introRequired: "An intro audio/video is required for this position.",
      cvType: "CV must be a PDF file.",
      cvSize: "CV size must be at most 5 MB.",
      introType: "File must be audio (mp3, wav, or m4a).",
      introSize: "Audio size must be at most 10 MB.",
      submitFailed: "Failed to submit application. Please try again.",
    },
    draft: {
      title: "Draft found",
      body: "Continue filling the form from your last save?",
      restore: "Restore",
      discard: "Discard",
      savedPrefix: "Saved",
    },
    summary: {
      title: "Application Summary",
      name: "Name",
      position: "Position",
      email: "Email",
      phone: "WhatsApp",
      notChosen: "Not chosen yet",
    },
    preview: {
      badge: "Final Step",
      title: "Review Your Application",
      desc: "Check all the details below before sending. Make sure everything is correct and typo-free.",
      sectionPersonal: "Personal Data",
      sectionAnswers: "Experience & Answers",
      sectionFiles: "Attached Files",
      sectionScreening: "Screening Answers",
      edit: "Edit",
      notFilled: "Not filled in",
      noFile: "Not uploaded",
      notAnswered: "Not answered",
      agreeLabel:
        "I declare that the information above is true, accurate, and verifiable.",
      agreeRequired:
        "Tick the accuracy statement before submitting your application.",
      confirmTitle: "Send application now?",
      confirmDesc:
        "Once sent, the application cannot be edited. You will receive a tracking code to monitor your selection status.",
      confirmYes: "Yes, Submit Application",
      confirmCancel: "Check Again",
      privacyNote:
        "Your application is only sent after you confirm — nothing is submitted automatically.",
    },
    uploads: {
      cvLabel: "CV (PDF, max 5 MB)",
      introLabel:
        "Short intro video/audio (max 10 MB) — boosts your chances",
      dropHint: "Click or drag a file here",
      remove: "Remove file",
      optional: "Optional",
      required: "Required",
      cvRequiredHint: "This position requires a CV",
      introRequiredHint: "This position requires an intro audio/video",
    },
    screening: {
      sectionTitle: "Questions for This Position",
      requiredMark: "(required)",
      answerPh: "Write your answer here...",
    },
    buttons: {
      back: "Back",
      next: "Next",
      review: "Review Application",
      submit: "Submit Application",
      submitting: "Sending...",
    },
    success: {
      title: "Application Sent!",
      thanksTo: "Thank you,",
      body: "We have received your application. Our team will contact you via email or WhatsApp within 1-3 business days.",
      trackingLabel: "Tracking Code",
      copy: "Copy code",
      copied: "Code copied",
      saveNote:
        "Save this code to monitor your application status in the Track Status section.",
      checkStatus: "Track Status Now",
      another: "Send Another Application",
      autoReplyTitle: "Message from the Team",
      nextStepsTitle: "Next Steps",
      openBrief: "Open Test Brief",
      assignmentFallback: "Selection Test",
    },
  },
  status: {
    badge: "Tracking",
    title: "Check Application Status",
    desc: "Enter the tracking code you received after submitting your application to see your selection progress.",
    codeLabel: "Tracking Code",
    codePh: "LM-XXXXXX",
    track: "Track",
    tracking: "Tracking...",
    notFound: "Code not found. Please double-check your code.",
    resultTitle: "Application Progress",
    positionLabel: "Position",
    submittedLabel: "Submitted",
    accepted: "Accepted",
    rejected: "Not Selected",
    assignmentTitle: "Selection Test",
    openBrief: "Open Test Brief",
  },
  voices: {
    badge: "Team Voices",
    title: "What Our Team Says",
    desc: "A few people who have been creating here a bit longer.",
  },
  subscribe: {
    title: "No position that fits you yet?",
    body: "Leave your email and we will notify you as soon as a new opening is published.",
    emailPh: "name@email.com",
    button: "Notify Me",
    loading: "Subscribing...",
    emailInvalid: "Please enter a valid email.",
    success: "Thank you! We will let you know when a new position opens.",
    failed: "Failed to subscribe. Please try again.",
  },
  faq: {
    badge: "FAQ",
    title: "Frequently Asked Questions",
    desc: "Still looking for an answer? Reach us on WhatsApp.",
    empty: "No questions listed yet.",
  },
  cta: {
    title: "Still unsure to start?",
    desc: "Have a casual chat with our team first. Prepare your best portfolio, we will handle the rest.",
    apply: "Apply Now",
    whatsapp: "Chat via WhatsApp",
  },
  footer: {
    nav: "Navigation",
    contact: "Contact",
    whatsapp: "WhatsApp",
  },
  chat: {
    open: "Open chat",
    close: "Close chat",
    title: "Lumina Bot",
    online: "Online",
    welcome:
      "Hi! I am Lumina Bot. Ask me anything about the recruitment process.",
    inputPh: "Type your question...",
    send: "Send message",
    error: "Sorry, something went wrong. Please try again.",
    chips: [
      "Are there still open positions?",
      "How does the work system look?",
      "Can I work remotely from another city?",
    ],
  },
  embed: {
    applyButton: "Apply on Main Site",
  },
  detail: {
    back: "Back to Job List",
    badge: "Job Detail",
    posted: "Published",
    live: "Live updates",
    notFoundTitle: "Job not found",
    notFoundDesc: "This position has been closed, archived, or the link is invalid.",
    browseOthers: "Browse other openings",
    badgeClosed: "Closed",
    badgeNew: "New",
    badgeSoon: "Closing Soon",
    badgeUrgent: "Urgent",
    badgeFeatured: "Featured",
    sectionDesc: "About the Role",
    sectionReq: "Requirements",
    sectionTerms: "Terms & Conditions",
    sectionBenefit: "Benefits",
    sectionWorks: "Sample Works",
    termsFiles: "Required documents",
    termsFilesCv: "CV (PDF)",
    termsFilesIntro: "Intro audio/video",
    termsFilesPortfolio: "Portfolio link",
    termsFilesNone: "No special documents — just fill in the form.",
    termsDeadline: "Deadline",
    termsDeadlineNone: "Open until quota is filled",
    termsQuota: "Applicant quota",
    termsQuotaValue: "{used}/{max} filled — {left} spots left",
    termsQuotaFull: "Quota is full",
    termsQuotaUnlimited: "Unlimited",
    termsProcess: "Selection process",
    termsTest: "Selection test",
    termsScreening: "Screening questions",
    termsScreeningCount: "{n} questions to answer when applying",
    termsScreeningNone: "No screening questions",
    shareLabel: "Share this job",
    shareCopied: "Job link copied",
    shareCopy: "Copy Link",
    applyClosedTitle: "Applications Closed",
    applyClosedDesc: "The online form for this position is closed. Please contact us for more information.",
    applyDisabledDesc: "Online applications are currently disabled. Please reach us through the contacts below.",
  },
};

export const dictionaries: Record<Lang, Dict> = { id, en };
