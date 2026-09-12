// GET /api/admin/interviews/round-plan?positionId=... — rencana ronde wawancara
// (Position.roundPlan) untuk mengisi otomatis form "Jadwalkan Ronde Berikutnya".
// Route terpisah karena serialisasi posisi standar tidak menyertakan field JSON ini.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  INTERVIEW_MODES,
  INTERVIEW_PLATFORMS,
  type RoundPlanTemplate,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

function parseRoundPlan(raw: string): RoundPlanTemplate[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: RoundPlanTemplate[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const obj = entry as Record<string, unknown>;
      const round = typeof obj.round === "number" && Number.isInteger(obj.round) ? obj.round : Number.NaN;
      const name = typeof obj.name === "string" ? obj.name.trim() : "";
      if (!Number.isInteger(round) || round < 1 || !name) continue;
      result.push({
        round,
        name: name.slice(0, 80),
        mode:
          typeof obj.mode === "string" && (INTERVIEW_MODES as string[]).includes(obj.mode)
            ? (obj.mode as RoundPlanTemplate["mode"])
            : undefined,
        platform:
          typeof obj.platform === "string" && (INTERVIEW_PLATFORMS as string[]).includes(obj.platform)
            ? (obj.platform as RoundPlanTemplate["platform"])
            : undefined,
        durationMin:
          typeof obj.durationMin === "number" && Number.isInteger(obj.durationMin)
            ? Math.min(480, Math.max(10, obj.durationMin))
            : undefined,
        interviewers: Array.isArray(obj.interviewers)
          ? obj.interviewers
              .filter((n): n is string => typeof n === "string")
              .map((n) => n.trim().slice(0, 60))
              .filter((n) => n.length > 0)
              .slice(0, 6)
          : undefined,
      });
    }
    return result.sort((a, b) => a.round - b.round).slice(0, 10);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const positionId = (req.nextUrl.searchParams.get("positionId") ?? "").trim();
    if (!positionId) {
      return NextResponse.json({ error: "positionId wajib diisi." }, { status: 400 });
    }
    const position = await db.position.findUnique({
      where: { id: positionId },
      select: { roundPlan: true },
    });
    if (!position) {
      return NextResponse.json({ error: "Posisi tidak ditemukan." }, { status: 404 });
    }
    return NextResponse.json({ roundPlan: parseRoundPlan(position.roundPlan) });
  } catch (error) {
    console.error("[GET /api/admin/interviews/round-plan]", error);
    return NextResponse.json({ error: "Gagal memuat rencana ronde." }, { status: 500 });
  }
}
