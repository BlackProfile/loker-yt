// GET /api/admin/interviews/ics — unduh kalender (.ics) SELURUH sesi wawancara
// (scheduledAt >= 7 hari yang lalu, diurut naik) untuk admin yang login.
// Format mengikuti referensi /api/public/interview/ics (kompatibel Google/Apple/Outlook).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
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
  return (
    `${date.getUTCFullYear()}` +
    `${String(date.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(date.getUTCDate()).padStart(2, "0")}T` +
    `${String(date.getUTCHours()).padStart(2, "0")}` +
    `${String(date.getUTCMinutes()).padStart(2, "0")}00Z`
  );
}

function unfold(line: string): string {
  // Batasi baris 75 oktet sesuai RFC 5545 (fold sederhana per 72 karakter).
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

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Silakan login terlebih dahulu." }, { status: 401 });
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const interviews = await db.interview.findMany({
      where: { scheduledAt: { gte: since } },
      orderBy: { scheduledAt: "asc" },
      include: {
        application: {
          select: {
            name: true,
            trackingCode: true,
            position: { select: { title: true } },
          },
        },
      },
    });

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Lumina Studio//Interview Admin//ID",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Wawancara Lumina Studio",
    ];

    for (const iv of interviews) {
      const app = iv.application;
      const start = iv.scheduledAt;
      const end = new Date(start.getTime() + iv.durationMin * 60 * 1000);
      const platformLabel =
        iv.mode === "ONSITE"
          ? "Datang ke lokasi"
          : (INTERVIEW_PLATFORM_LABELS[iv.platform as InterviewPlatform] ?? iv.platform);
      const interviewers = ((): string[] => {
        try {
          const parsed: unknown = JSON.parse(iv.interviewers || "[]");
          return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
        } catch {
          return [];
        }
      })();

      const summary = `Wawancara ${app?.name ?? "-"} — ${app?.position?.title ?? "-"}`;
      const description = [
        `Wawancara ronde ${iv.round} — ${app?.name ?? "-"} (${app?.trackingCode ?? "-"}).`,
        `Posisi: ${app?.position?.title ?? "-"}`,
        `Platform: ${platformLabel}`,
        iv.meetingLink ? `Link: ${iv.meetingLink}` : null,
        iv.mode === "ONSITE" && iv.address ? `Alamat: ${iv.address}` : null,
        interviewers.length > 0 ? `Pewawancara: ${interviewers.join(", ")}` : null,
        `Status: ${iv.status}`,
        `Panel admin: /admin (tab Wawancara)`,
      ]
        .filter(Boolean)
        .join("\n");

      lines.push(
        "BEGIN:VEVENT",
        `UID:${iv.id}@lumina-studio`,
        `DTSTAMP:${toIcsStamp(new Date())}`,
        `DTSTART:${toIcsStamp(start)}`,
        `DTEND:${toIcsStamp(end)}`,
        `SUMMARY:${icsEscape(summary)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        `LOCATION:${icsEscape(
          iv.mode === "ONSITE" ? (iv.address ?? "Lumina Studio") : (iv.meetingLink ?? platformLabel),
        )}`,
        "END:VEVENT",
      );
    }

    lines.push("END:VCALENDAR");

    const ics = lines.map(unfold).join("\r\n");
    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="lumina-wawancara.ics"',
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/interviews/ics]", error);
    return NextResponse.json({ error: "Gagal membuat berkas kalender." }, { status: 500 });
  }
}
