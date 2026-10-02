// OG image dinamis (1200x630) untuk share sosial media.
// ?posisi=<slug> -> kartu lowongan; tanpa param / slug tak valid -> kartu default situs.
// Font memakai bawaan ImageResponse (offline-safe), tanpa emoji, semua elemen display:flex eksplisit.
import { ImageResponse } from "next/og";
import type { Position } from "@prisma/client";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const COLORS = {
  bg: "#09090b",
  rose: "#e11d48",
  roseSoft: "#fb7185",
  amber: "#fbbf24",
  white: "#fafafa",
  gray: "#a1a1aa",
  grayMuted: "#71717a",
  border: "rgba(255,255,255,0.10)",
};

async function loadPosition(slug: string): Promise<Position | null> {
  try {
    return await db.position.findUnique({ where: { slug } });
  } catch {
    return null;
  }
}

function isPublishable(position: Position | null): position is Position {
  return Boolean(position && position.isActive && position.deletedAt === null);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// Blob gradient rose transparan: div background radial + borderRadius besar.
function RoseBlob() {
  return (
    <div
      style={{
        position: "absolute",
        top: -240,
        right: -180,
        width: 680,
        height: 680,
        borderRadius: 9999,
        display: "flex",
        background:
          "radial-gradient(circle at center, rgba(225,29,72,0.38) 0%, rgba(225,29,72,0.14) 45%, rgba(225,29,72,0) 72%)",
      }}
    />
  );
}

// Bingkai tipis di dalam kartu agar terasa premium.
function Frame() {
  return (
    <div
      style={{
        position: "absolute",
        top: 24,
        left: 24,
        bottom: 24,
        right: 24,
        borderRadius: 20,
        border: `1px solid ${COLORS.border}`,
        display: "flex",
      }}
    />
  );
}

function Footer({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        borderTop: `1px solid ${COLORS.border}`,
        paddingTop: 30,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 12,
          height: 12,
          borderRadius: 9999,
          backgroundColor: COLORS.rose,
        }}
      />
      <div style={{ display: "flex", fontSize: 26, color: COLORS.grayMuted }}>{label}</div>
    </div>
  );
}

function Dot() {
  return (
    <div
      style={{
        display: "flex",
        width: 8,
        height: 8,
        borderRadius: 9999,
        backgroundColor: COLORS.rose,
      }}
    />
  );
}

function DefaultCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 76,
        backgroundColor: COLORS.bg,
        position: "relative",
      }}
    >
      <RoseBlob />
      <Frame />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: `1.5px solid ${COLORS.rose}`,
            color: COLORS.roseSoft,
            fontSize: 24,
            padding: "10px 26px",
            borderRadius: 9999,
            letterSpacing: 3,
          }}
        >
          REKRUTMEN TIM KREATIF
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 22,
        }}
      >
        <div style={{ display: "flex", fontSize: 104, color: COLORS.white, letterSpacing: -2 }}>
          Lumina Studio
        </div>
        <div style={{ display: "flex", fontSize: 38, color: COLORS.gray }}>
          Tim Kreatif Konten Digital
        </div>
      </div>
      <Footer label="Posisi terbuka & pendaftaran online" />
    </div>
  );
}

function PositionCard({ position }: { position: Position }) {
  const showSalary = position.salaryVisible && Boolean(position.salaryText?.trim());
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 76,
        backgroundColor: COLORS.bg,
        position: "relative",
      }}
    >
      <RoseBlob />
      <Frame />
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: COLORS.rose,
            color: COLORS.white,
            fontSize: 24,
            padding: "10px 24px",
            borderRadius: 9999,
            letterSpacing: 3,
          }}
        >
          LOWONGAN
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            border: `1.5px solid ${COLORS.border}`,
            color: "#d4d4d8",
            fontSize: 24,
            padding: "10px 24px",
            borderRadius: 9999,
          }}
        >
          {truncate(position.department, 40)}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 26,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 78,
            color: COLORS.white,
            letterSpacing: -1,
            lineClamp: 2,
          }}
        >
          {truncate(position.title, 90)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", fontSize: 30, color: COLORS.gray }}>
            {truncate(position.type, 30)}
          </div>
          <Dot />
          <div style={{ display: "flex", fontSize: 30, color: COLORS.gray }}>
            {truncate(position.location, 30)}
          </div>
          {showSalary ? (
            <>
              <Dot />
              <div style={{ display: "flex", fontSize: 30, color: COLORS.amber }}>
                {truncate((position.salaryText ?? "").trim(), 40)}
              </div>
            </>
          ) : null}
        </div>
      </div>
      <Footer label="Lumina Studio — Tim Kreatif Konten Digital" />
    </div>
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get("posisi") ?? "").trim();

  let position: Position | null = null;
  if (slug.length > 0) {
    position = await loadPosition(slug);
    if (!isPublishable(position)) position = null;
  }

  const card = new ImageResponse(position ? <PositionCard position={position} /> : <DefaultCard />, {
    width: 1200,
    height: 630,
  });

  return new Response(card.body, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, s-maxage=3600",
    },
  });
}
