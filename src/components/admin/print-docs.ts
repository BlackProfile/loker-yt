// Generator dokumen cetak untuk panel admin (print-window, TANPA dependensi).
// buildProfileHtml — profil lengkap pelamar dalam satu halaman A4.
// buildOfferHtml — surat penawaran kerja (kop surat + blok tanda tangan) A4.
// Semua nilai pelamar di-escape lewat esc() agar aman disisipkan ke HTML.

import {
  AI_RECOMMENDATION_LABELS,
  type Application,
  type ScreeningQuestion,
} from "@/lib/types";
import { stageLabel } from "@/lib/stages";

/* --------------------------------- Util dasar -------------------------------- */

/** Escape nilai apa pun agar aman dirender di dalam HTML (teks maupun atribut). */
function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format detik menjadi "MM:SS" (mis. 92 → "01:32"). Dipakai juga chip di dialog. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

const longDateFmt = new Intl.DateTimeFormat("id-ID", { dateStyle: "long" });

function fmtLongDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return longDateFmt.format(d);
}

/** URL absolut untuk berkas /api/files/{id} — origin diambil dari jendela saat ini. */
function absFileUrl(fileId: string): string {
  const path = `/api/files/${encodeURIComponent(fileId)}`;
  if (typeof window === "undefined") return path;
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

/* ------------------------------- Kerangka dokumen ----------------------------- */

const DOC_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #f4f4f5; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Helvetica Neue", Arial, sans-serif;
    color: #18181b; font-size: 12px; line-height: 1.55;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page {
    width: 210mm; min-height: 297mm; margin: 24px auto; padding: 16mm 15mm;
    background: #ffffff; box-shadow: 0 1px 8px rgba(24, 24, 27, 0.14);
  }
  h1 { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; color: #18181b; }
  .brand { font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.18em; color: #9f1239; margin-bottom: 2px; }
  .muted { color: #71717a; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .header { border-bottom: 3px solid #9f1239; padding-bottom: 12px; margin-bottom: 18px; }
  .header .meta { display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 5px; font-size: 11px; color: #71717a; }
  .section { margin-bottom: 16px; }
  .section > h2 {
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
    color: #9f1239; border-bottom: 1px solid #e4e4e7; padding-bottom: 3px; margin-bottom: 8px;
  }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 20px; }
  .info-item .label { font-size: 9.5px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.06em; color: #a1a1aa; }
  .info-item .value { font-size: 12px; word-break: break-word; }
  a { color: #9f1239; text-decoration: none; word-break: break-all; }
  .pre { white-space: pre-wrap; word-break: break-word; }
  .qa { margin-bottom: 8px; padding-left: 10px; border-left: 2px solid #f4f4f5; }
  .qa .q { font-weight: 600; }
  .qa .a { color: #3f3f46; }
  .stars { color: #b45309; letter-spacing: 2px; font-size: 13px; }
  .tag { display: inline-block; border: 1px solid #e4e4e7; background: #fafafa;
    border-radius: 999px; padding: 1px 9px; margin: 0 4px 4px 0; font-size: 11px; color: #3f3f46; }
  .vnote { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; }
  .vnote .ts { flex: none; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10.5px; font-weight: 700; color: #9f1239; background: #fff1f2;
    border: 1px solid #fecdd3; border-radius: 4px; padding: 0 5px; }
  ul.files { list-style: none; }
  ul.files li { padding: 3px 0; border-bottom: 1px dashed #f4f4f5; }
  ul.files .label { color: #71717a; }
  .footnote { margin-top: 22px; padding-top: 8px; border-top: 1px solid #f4f4f5;
    font-size: 10px; color: #a1a1aa; }
  /* Surat penawaran */
  .letter-title { text-align: center; margin: 10px 0 2px; font-size: 15px; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase; color: #18181b; }
  .letter-rule { border: none; border-top: 2px solid #9f1239; margin-bottom: 18px; }
  .letter-date { text-align: right; margin-bottom: 14px; color: #3f3f46; }
  .letter-recipient { margin-bottom: 14px; line-height: 1.6; }
  .letter p { margin-bottom: 10px; text-align: justify; }
  .terms { width: 100%; border-collapse: collapse; margin: 10px 0 14px; }
  .terms td { border: 1px solid #e4e4e7; padding: 6px 10px; vertical-align: top; }
  .terms td.k { width: 32%; background: #fafafa; font-weight: 600; color: #52525b; }
  .signature { display: flex; justify-content: space-between; gap: 40px; margin-top: 30px; }
  .signature .col { flex: 1; text-align: center; }
  .signature .role { margin-bottom: 52px; }
  .signature .line { border-top: 1px solid #18181b; padding-top: 4px; font-weight: 600; }
  .signature .sub { font-weight: 400; font-size: 11px; color: #71717a; }
  @page { size: A4; margin: 0; }
  @media print {
    html, body { background: #ffffff; }
    .page { width: auto; min-height: auto; margin: 0; box-shadow: none; padding: 14mm 13mm; }
  }
`;

function wrapDocument(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${DOC_CSS}</style>
</head>
<body>
<div class="page">
${bodyHtml}
</div>
</body>
</html>`;
}

function section(title: string, innerHtml: string): string {
  return `<div class="section"><h2>${esc(title)}</h2>${innerHtml}</div>`;
}

function infoItem(label: string, value: string): string {
  return `<div class="info-item"><div class="label">${esc(label)}</div><div class="value">${
    value || '<span class="muted">-</span>'
  }</div></div>`;
}

/* ------------------------------- Profil pelamar ------------------------------- */

export function buildProfileHtml(
  app: Application,
  siteName: string,
  screeningQuestions?: ScreeningQuestion[]
): string {
  const parts: string[] = [];

  // Header: nama + kode tracking + posisi + tanggal
  parts.push(`<div class="header">
    <div class="brand">${esc(siteName)}</div>
    <h1>${esc(app.name)}</h1>
    <div class="meta">
      <span class="mono">${esc(app.trackingCode)}</span>
      <span>&middot;</span>
      <span>${esc(app.positionTitle ?? "Posisi tidak ditentukan")}</span>
      <span>&middot;</span>
      <span>Diterima ${esc(fmtLongDate(app.createdAt))}</span>
    </div>
  </div>`);

  // Info kontak
  const portfolio = app.portfolioUrl
    ? `<a href="${esc(absFileUrlSafeLink(app.portfolioUrl))}">${esc(app.portfolioUrl)}</a>`
    : "";
  const social = app.socialLinks
    ? `<a href="${esc(absFileUrlSafeLink(app.socialLinks))}">${esc(app.socialLinks)}</a>`
    : "";
  parts.push(
    section(
      "Informasi Kontak",
      `<div class="info-grid">
        ${infoItem("Email", esc(app.email))}
        ${infoItem("Telepon / WhatsApp", esc(app.phone))}
        ${infoItem("Portofolio", portfolio)}
        ${infoItem("Sosial Media", social)}
      </div>`
    )
  );

  // Status & tahap
  const stageChanged = fmtLongDate(app.stageUpdatedAt ?? null);
  parts.push(
    section(
      "Status &amp; Tahap",
      `<div class="info-grid">
        ${infoItem("Tahap Saat Ini", esc(stageLabel(app.status)))}
        ${infoItem("Tanggal Daftar", esc(fmtLongDate(app.createdAt)))}
        ${infoItem("Terakhir Berubah Tahap", stageChanged ? esc(stageChanged) : '<span class="muted">-</span>')}
        ${infoItem(
          "Jadwal Wawancara",
          app.interviewAt ? esc(fmtLongDate(app.interviewAt)) : '<span class="muted">-</span>'
        )}
      </div>`
    )
  );

  // Skor AI + ringkasan AI (bila ada)
  if (app.aiScore != null || app.aiSummary || app.aiRecommendation) {
    const aiBits: string[] = [];
    if (app.aiScore != null) {
      aiBits.push(
        infoItem(
          "Skor AI",
          `<strong>${esc(app.aiScore)}</strong><span class="muted">/100</span>`
        )
      );
    }
    if (app.aiRecommendation) {
      aiBits.push(
        infoItem("Rekomendasi AI", esc(AI_RECOMMENDATION_LABELS[app.aiRecommendation] ?? app.aiRecommendation))
      );
    }
    if (app.aiSummary) {
      aiBits.push(infoItem("Ringkasan AI", `<span class="pre">${esc(app.aiSummary)}</span>`));
    }
    parts.push(section("Evaluasi AI", `<div class="info-grid">${aiBits.join("")}</div>`));
  }

  // Rating bintang (teks) + tags
  const ratingText =
    app.rating > 0
      ? `<span class="stars">${"&#9733;".repeat(app.rating)}${"&#9734;".repeat(Math.max(0, 5 - app.rating))}</span> <span class="muted">(${app.rating}/5)</span>`
      : '<span class="muted">Belum dinilai</span>';
  const tagsHtml =
    app.tags.length > 0
      ? app.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")
      : '<span class="muted">Tidak ada tag</span>';
  parts.push(
    section(
      "Penilaian Admin",
      `<div class="info-grid">
        ${infoItem("Rating", ratingText)}
        ${infoItem("Tags", tagsHtml)}
      </div>`
    )
  );

  // Jawaban screening
  const answerEntries = Object.entries(app.screeningAnswers ?? {});
  if (answerEntries.length > 0) {
    const qaHtml = answerEntries
      .map(([qid, answer], i) => {
        const label = screeningQuestions?.find((q) => q.id === qid)?.label ?? `Pertanyaan ${i + 1}`;
        return `<div class="qa"><div class="q">${esc(label)}</div><div class="a">${
          answer && answer.trim() ? esc(answer) : '<span class="muted">Tidak dijawab</span>'
        }</div></div>`;
      })
      .join("");
    parts.push(section("Jawaban Screening", qaHtml));
  }

  // Pengalaman & motivasi
  parts.push(
    section(
      "Pengalaman &amp; Motivasi",
      `<div class="qa"><div class="q">Pengalaman</div><div class="a pre">${esc(
        app.experience || "-"
      )}</div></div>
      <div class="qa"><div class="q">Alasan Bergabung</div><div class="a pre">${esc(
        app.motivation || "-"
      )}</div></div>`
    )
  );

  // Daftar berkas (nama file + URL absolut)
  const files: { label: string; name: string; fileId: string }[] = [];
  if (app.cvFileId) {
    files.push({ label: "CV", name: app.cvFileName ?? "CV Pelamar", fileId: app.cvFileId });
  }
  if (app.introFileId) {
    files.push({
      label: "Audio/Video Intro",
      name: app.introFileName ?? "Video Perkenalan",
      fileId: app.introFileId,
    });
  }
  for (const doc of app.extraDocs) {
    files.push({ label: doc.label, name: doc.filename || doc.label, fileId: doc.fileId });
  }
  if (files.length > 0) {
    const listHtml = files
      .map(
        (f) =>
          `<li><a href="${esc(absFileUrl(f.fileId))}">${esc(f.name)}</a> <span class="label">&mdash; ${esc(
            f.label
          )}</span></li>`
      )
      .join("");
    parts.push(section("Berkas Pelamar", `<ul class="files">${listHtml}</ul>`));
  }

  // Catatan admin
  parts.push(
    section(
      "Catatan Admin",
      app.adminNotes
        ? `<p class="pre">${esc(app.adminNotes)}</p>`
        : '<p class="muted">Tidak ada catatan admin.</p>'
    )
  );

  // Catatan video (bila ada)
  const videoNotes = [...(app.videoNotes ?? [])].sort((a, b) => a.t - b.t);
  if (videoNotes.length > 0) {
    const notesHtml = videoNotes
      .map(
        (n) =>
          `<div class="vnote"><span class="ts">${esc(formatTimestamp(n.t))}</span><span class="pre">${esc(
            n.note
          )}</span></div>`
      )
      .join("");
    parts.push(section("Catatan Video Intro", notesHtml));
  }

  // Catatan kaki
  parts.push(
    `<div class="footnote">Dokumen dihasilkan oleh ${esc(siteName)} &mdash; dicetak ${esc(
      longDateFmt.format(new Date())
    )}. URL berkas bersifat privat (hanya admin).</div>`
  );

  return wrapDocument(`Profil Pelamar — ${app.name} (${app.trackingCode})`, parts.join("\n"));
}

/** URL absolut untuk tautan eksternal (portofolio/sosial) — fallback ke nilai asli. */
function absFileUrlSafeLink(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (typeof window === "undefined") return trimmed;
  try {
    return new URL(trimmed, window.location.origin).href;
  } catch {
    return trimmed;
  }
}

/* ------------------------------ Surat penawaran ------------------------------- */

export function buildOfferHtml(app: Application, siteName: string): string {
  const today = longDateFmt.format(new Date());
  const salary = app.offerSalary?.trim() ? esc(app.offerSalary.trim()) : "____";
  const offerType = app.offerType?.trim() ? esc(app.offerType.trim()) : "____";
  const startDate = app.offerStartDate ? esc(fmtLongDate(app.offerStartDate)) : "____";
  const deadline = app.offerDeadline ? esc(fmtLongDate(app.offerDeadline)) : "____";
  const note = app.offerNote?.trim() ? esc(app.offerNote.trim()) : "";
  const position = app.positionTitle?.trim() ? esc(app.positionTitle.trim()) : "____";

  const parts: string[] = [];

  // Kop surat
  parts.push(`<div class="header" style="text-align:center;">
    <div class="brand" style="margin-bottom:4px;">${esc(siteName)}</div>
    <div class="letter-title">Surat Penawaran Kerja</div>
    <div class="muted" style="font-size:11px;">Dokumen resmi &mdash; bukan kontrak kerja</div>
  </div>
  <hr class="letter-rule" />`);

  // Tanggal
  parts.push(`<div class="letter-date">${esc(siteName)}, ${esc(today)}</div>`);

  // Tujuan
  parts.push(`<div class="letter-recipient">
    Kepada Yth.<br />
    <strong>${esc(app.name)}</strong><br />
    <span class="muted">${esc(app.email)}${app.phone ? ` &middot; ${esc(app.phone)}` : ""}</span>
  </div>`);

  // Isi
  parts.push(`<div class="letter">
    <p>Dengan hormat,</p>
    <p>Berdasarkan hasil proses seleksi yang telah kita lakukan, dengan ini kami dari <strong>${esc(
      siteName
    )}</strong> menyampaikan penawaran kerja kepada Anda untuk bergabung bersama tim kami. Ketentuan penawaran adalah sebagai berikut:</p>
    <table class="terms">
      <tr><td class="k">Posisi</td><td>${position}</td></tr>
      <tr><td class="k">Jenis Pekerjaan</td><td>${offerType}</td></tr>
      <tr><td class="k">Gaji</td><td>${salary}</td></tr>
      <tr><td class="k">Tanggal Mulai Kerja</td><td>${startDate}</td></tr>
      ${
        note
          ? `<tr><td class="k">Catatan</td><td class="pre">${note}</td></tr>`
          : ""
      }
      <tr><td class="k">Batas Jawaban</td><td>${deadline}</td></tr>
    </table>
    <p>Mohon konfirmasi penerimaan atas penawaran ini paling lambat pada <strong>${deadline}</strong>. Apabila tidak ada jawaban hingga batas waktu tersebut, penawaran ini dinyatakan kedaluwarsa.</p>
    <p>Demikian surat penawaran ini kami sampaikan. Atas perhatian dan antusiasme Anda, kami ucapkan terima kasih. Kami menantikan kabar baik dari Anda.</p>
  </div>`);

  // Blok tanda tangan
  parts.push(`<div class="signature">
    <div class="col">
      <div class="role">Hormat kami,<br /><span class="muted">${esc(siteName)}</span></div>
      <div class="line">( ______________________ )</div>
    </div>
    <div class="col">
      <div class="role">Penerima penawaran,<br /><span class="muted">${esc(app.name)}</span></div>
      <div class="line">( ______________________ )</div>
    </div>
  </div>`);

  return wrapDocument(`Surat Penawaran — ${app.name} (${app.trackingCode})`, parts.join("\n"));
}
