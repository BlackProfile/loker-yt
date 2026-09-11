// GET /api/public/interview/ics?code=LM-XXX&id=<interviewId>
// Unduh undangan kalender (.ics) untuk satu sesi wawancara — kompatibel Google Calendar/Apple/Outlook.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { INTERVIEW_PLATFORM_LABELS, type InterviewPlatform } from "@/lib/types";

export const dynamic = "force-dynamic";

function icsEscape(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

function toIcsStamp(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}00Z`;
}

function unfold(line: string): string {
  // Batasi baris 75 oktet sesuai RFC 5545 (fold sederhana per 64 karakter aman).
  if (line.length <= 72) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 72) {
    chunks.push(rest.slice(0, 72));
    rest = rest.slice(72);
  }
  chunks.push(rest);
  return chunks.join("\r\n ");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = (searchParams.get("code") ?? "").trim().toUpperCase();
    const id = (searchParams.get("id") ?? "").trim();
    if (!code || !id) {
      return NextResponse.json({ error: "Parameter tidak lengkap." }, { status: 400 });
    }

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: { id: true, name: true, position: { select: { title: true } } },
    });
    if (!application) {
      return NextResponse.json({ error: "Kode tidak ditemukan." }, { status: 404 });
    }

    const interview = await db.interview.findFirst({
      where: { id, applicationId: application.id },
    });
    if (!interview) {
      return NextResponse.json({ error: "Sesi wawancara tidak ditemukan." }, { status: 404 });
    }
    if (interview.status === "CANCELLED") {
      return NextResponse.json({ error: "Sesi ini sudah dibatalkan." }, { status: 400 });
    }

    const start = interview.scheduledAt;
    const end = new Date(start.getTime() + interview.durationMin * 60 * 1000);
    const platformLabel =
      interview.mode === "ONSITE"
        ? "Datang ke lokasi"
        : (INTERVIEW_PLATFORM_LABELS[interview.platform as InterviewPlatform] ?? interview.platform);
    const interviewers = JSON.parse(interview.interviewers || "[]") as string[];
    const description = [
      `Wawancara ronde ${interview.round} untuk posisi ${application.position?.title ?? "-"}.`,
      `Format: ${platformLabel}`,
      interview.meetingLink ? `Link: ${interview.meetingLink}` : null,
      interviewers.length > 0 ? `Pewawancara: ${interviewers.join(", ")}` : null,
      "Lumina Studio",
    ]
      .filter(Boolean)
      .join("\n");

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lumina Studio//Interview//ID",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${interview.id}@lumina-studio`,
      `DTSTAMP:${toIcsStamp(new Date())}`,
      `DTSTART:${toIcsStamp(start)}`,
      `DTEND:${toIcsStamp(end)}`,
      `SUMMARY:${icsEscape(`Wawancara ${application.position?.title ?? ""} — Lumina Studio`)}`,
      `DESCRIPTION:${icsEscape(description)}`,
      `LOCATION:${icsEscape(interview.mode === "ONSITE" ? (interview.address ?? "Lumina Studio") : (interview.meetingLink ?? platformLabel))}`,
      "BEGIN:VALARM",
      "TRIGGER:-PT60M",
      "ACTION:DISPLAY",
      "DESCRIPTION:Pengingat wawancara 1 jam lagi",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    const ics = lines.map(unfold).join("\r\n");
    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="wawancara-lumina-${interview.round}.ics"`,
      },
    });
  } catch (error) {
    console.error("[GET /api/public/interview/ics]", error);
    return NextResponse.json({ error: "Gagal membuat undangan kalender." }, { status: 500 });
  }
}
