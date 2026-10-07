// NR-41 K27 — pembuat tautan "Tambahkan ke Google Calendar" (template link resmi,
// tanpa OAuth). Dipakai di Cek Status (publik) dan dialog wawancara admin.

export type GcalEventInput = {
  title: string;
  startAt: Date | string;
  durationMin?: number; // default 60
  details?: string;
  location?: string; // link Meet/Zoom atau alamat on-site
};

function fmtUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** URL template Google Calendar — buka di tab baru oleh pemanggil. */
export function buildGcalUrl(input: GcalEventInput): string {
  const start = typeof input.startAt === "string" ? new Date(input.startAt) : input.startAt;
  const end = new Date(start.getTime() + (input.durationMin ?? 60) * 60 * 1000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${fmtUtc(start)}/${fmtUtc(end)}`,
  });
  if (input.details) params.set("details", input.details);
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
