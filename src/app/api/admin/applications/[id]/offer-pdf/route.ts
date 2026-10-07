// NR-41 K28 — Surat Penawaran PDF server-side (pdf-lib) + arsip permanen.
// GET /api/admin/applications/[id]/offer-pdf (OWNER/HR)
// - Membuat PDF surat penawaran dari data lamaran + posisi + setelan situs.
// - Mengarsipkan salinan sebagai FileAsset kind=OFFER_PDF (path uploads/offers/).
// - Mengirim berkas PDF sebagai unduhan (Content-Disposition attachment).
// Berbeda dari "Surat Penawaran (PDF)" cetak-jendela: PDF ini tersimpan di server
// sehingga punya arsip permanen yang bisa diakses ulang via /api/files/{id}.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const ROSE = rgb(0.882, 0.114, 0.282); // rose-600
const INK = rgb(0.09, 0.09, 0.11); // zinc-950
const MUTED = rgb(0.39, 0.39, 0.42); // zinc-600

function safePart(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? "").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-");
  return clean || fallback;
}

function fmtDate(value: Date | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "long",
    timeZone: "Asia/Jakarta",
  }).format(value);
}

function fmtRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

/** Parse "Rp 4.500.000/bulan" / "4500000" -> angka bila mungkin. */
function parseSalary(text: string | null | undefined): number | null {
  if (!text) return null;
  const digits = text.replace(/[^\d]/g, "");
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await requireRole(["OWNER", "HR"]);
  if (!session) {
    return NextResponse.json({ error: "Tidak diizinkan." }, { status: 401 });
  }

  const { id } = await ctx.params;
  const app = await db.application.findUnique({
    where: { id },
    include: {
      position: { select: { title: true, probationMonths: true, department: true } },
    },
  });
  if (!app || app.deletedAt) {
    return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
  }
  if (!app.offerStatus) {
    return NextResponse.json(
      { error: "Belum ada penawaran untuk lamaran ini." },
      { status: 400 },
    );
  }

  // Nama situs dari Setting "site" (fallback konstan).
  let siteName = "Lumina Studio";
  try {
    const siteRow = await db.setting.findUnique({ where: { key: "site" } });
    if (siteRow) {
      const parsed: unknown = JSON.parse(siteRow.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const site = parsed as Record<string, unknown>;
        if (typeof site.siteName === "string" && site.siteName.trim()) {
          siteName = site.siteName.trim();
        }
      }
    }
  } catch {
    // fallback nama bawaan
  }

  // ---------------- Bangun PDF ----------------
  const doc = await PDFDocument.create();
  doc.setTitle(`Surat Penawaran — ${app.name}`);
  doc.setAuthor(siteName);
  const page = doc.addPage([595, 842]); // A4
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 56;
  const width = page.getWidth();
  let y = 792;

  const text = (
    value: string,
    opts: { size?: number; font?: typeof regular; color?: typeof INK; x?: number } = {},
  ) => {
    const size = opts.size ?? 11;
    page.drawText(value, {
      x: opts.x ?? margin,
      y,
      size,
      font: opts.font ?? regular,
      color: opts.color ?? INK,
    });
    y -= size + 6;
  };

  // Kop surat
  page.drawRectangle({ x: margin, y: y + 4, width: width - margin * 2, height: 3, color: ROSE });
  y -= 18;
  text(siteName, { size: 18, font: bold });
  text("Surat Penawaran Kerja", { size: 12, color: MUTED });
  y -= 10;

  // Meta
  text(`Kode Pelacakan : ${app.trackingCode ?? "-"}`, { size: 10, color: MUTED });
  text(`Tanggal        : ${fmtDate(new Date())}`, { size: 10, color: MUTED });
  y -= 14;

  text(`Kepada Yth.`, { size: 11, color: MUTED });
  text(app.name, { size: 13, font: bold });
  text(`Email: ${app.email}  |  Telp: ${app.phone || "-"}`, { size: 10, color: MUTED });
  y -= 12;

  // Paragraf pembuka
  const opening =
    "Dengan ini kami menyatakan bahwa Anda telah lulus proses seleksi dan kami menawarkan Anda untuk bergabung dengan tim kami pada posisi berikut:";
  for (const line of wrap(opening, regular, 11, width - margin * 2)) {
    text(line);
  }
  y -= 4;

  // Tabel detail offer
  const rows: Array<[string, string]> = [
    ["Posisi", app.position?.title ?? "-"],
    ["Departemen", app.position?.department ?? "-"],
    ["Jenis Kerja", app.offerType ?? "-"],
    ["Gaji", app.offerSalary ?? "-"],
    [
      "Mulai Kerja",
      app.offerStartDate
        ? fmtDate(app.offerStartDate)
        : app.startConfirmedAt
          ? fmtDate(app.startConfirmedAt)
          : "Akan disepakati",
    ],
    [
      "Masa Percobaan",
      `${app.position?.probationMonths ?? 3} bulan`,
    ],
    ["Batas Jawab", app.offerDeadline ? fmtDate(app.offerDeadline) : "-"],
  ];
  const labelX = margin;
  const valueX = margin + 140;
  for (const [label, value] of rows) {
    page.drawText(label, { x: labelX, y, size: 11, font: bold, color: INK });
    for (const line of wrap(value, regular, 11, width - valueX - margin)) {
      page.drawText(line, { x: valueX, y, size: 11, font: regular, color: INK });
      y -= 17;
    }
  }
  y -= 6;

  if (app.offerNote) {
    text("Catatan tambahan:", { size: 11, font: bold });
    for (const line of wrap(app.offerNote, regular, 11, width - margin * 2)) {
      text(line);
    }
    y -= 4;
  }

  // Perbandingan ekspektasi gaji (NR-40 butir 6 — info kecil)
  const expected = app.salaryExpectation;
  const offered = parseSalary(app.offerSalary);
  if (expected && offered) {
    const diff = offered - expected;
    const note =
      diff >= 0
        ? `Gaji yang ditawarkan memenuhi ekspektasi pelamar (${fmtRupiah(expected)}/bulan).`
        : `Gaji yang ditawarkan di bawah ekspektasi pelamar (${fmtRupiah(expected)}/bulan) selisih ${fmtRupiah(Math.abs(diff))}.`;
    text(note, { size: 9, color: MUTED });
    y -= 8;
  }

  // Blok tanda tangan elektronik (NR-41 K30)
  y -= 8;
  text("Persetujuan & Tanda Tangan", { size: 12, font: bold });
  if (app.offerSignature) {
    try {
      const sig: unknown = JSON.parse(app.offerSignature);
      if (sig && typeof sig === "object" && !Array.isArray(sig)) {
        const rec = sig as Record<string, unknown>;
        const name = typeof rec.name === "string" ? rec.name : "-";
        const at = typeof rec.at === "string" ? rec.at : "-";
        const atLabel = new Intl.DateTimeFormat("id-ID", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: "Asia/Jakarta",
        }).format(new Date(at));
        text(`Ditandatangani secara elektronik (nama diketik) oleh:`, { size: 10, color: MUTED });
        text(name, { size: 12, font: bold });
        text(`Pada: ${atLabel}`, { size: 10, color: MUTED });
      }
    } catch {
      text("Tanda tangan elektronik tercatat (format tidak terbaca).", { size: 10, color: MUTED });
    }
  } else {
    text("Pelamar belum menandatangani dokumen ini secara elektronik.", {
      size: 10,
      color: MUTED,
    });
  }

  // Footer
  page.drawLine({
    start: { x: margin, y: 72 },
    end: { x: width - margin, y: 72 },
    thickness: 0.75,
    color: rgb(0.85, 0.85, 0.87),
  });
  page.drawText(
    `Dibuat otomatis oleh sistem rekrutmen ${siteName} — arsip PDF tersimpan di server.`,
    { x: margin, y: 58, size: 8.5, font: regular, color: MUTED },
  );

  const bytes = await doc.save();

  // ---------------- Arsip FileAsset (kind=OFFER_PDF) ----------------
  const offersDir = path.join(process.cwd(), "uploads", "offers");
  await mkdir(offersDir, { recursive: true });
  const storedName = `offer-${Date.now()}-${safePart(app.trackingCode, app.id)}.pdf`;
  const absolutePath = path.join(offersDir, storedName);
  await writeFile(absolutePath, bytes);
  await db.fileAsset.create({
    data: {
      filename: `surat-penawaran-${safePart(app.trackingCode, app.id)}.pdf`,
      mimeType: "application/pdf",
      size: bytes.length,
      path: `uploads/offers/${storedName}`,
      kind: "OFFER_PDF",
    },
  });
  await db.activityLog
    .create({
      data: {
        applicationId: app.id,
        actor: session.name,
        action: "OFFER_PDF_ARCHIVED",
        detail: `Surat penawaran PDF dibuat & diarsipkan (${bytes.length} bytes)`,
      },
    })
    .catch(() => undefined);

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="surat-penawaran-${safePart(app.trackingCode, app.id)}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Bungkus teks ke beberapa baris sesuai lebar maksimum (pengukuran font pdf-lib). */
function wrap(value: string, font: ReturnType<typeof Object> & { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}
