"use client";

// View survei pengalaman kandidat (?survei=<token>) — satu pertanyaan bintang 1-5
// + komentar opsional. Tautan dikirim otomatis lewat email status Diterima/Ditolak.
// Anonim: tidak menampilkan nama/email pelamar, tidak meminta login.
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { BrandMark } from "@/components/landing/primitives";
import { cn } from "@/lib/utils";

const SCORE_LABELS: Record<number, string> = {
  1: "Kurang sekali",
  2: "Kurang",
  3: "Cukup",
  4: "Puas",
  5: "Sangat puas",
};

type Phase = "loading" | "ready" | "invalid" | "answered" | "sending" | "done" | "error";

export function SurveyView({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [positionTitle, setPositionTitle] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Muat info survei sekali saat mount — semua setState berada di callback
  // async (bukan sinkron di badan effect) sesuai aturan react-hooks.
  useEffect(() => {
    let active = true;
    fetch(`/api/public/survey?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json: unknown = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !json || typeof json !== "object") {
          setPhase("invalid");
          return;
        }
        const data = json as { answered?: boolean; positionTitle?: string | null; error?: string };
        if (data.answered) {
          setPhase("answered");
          return;
        }
        setPositionTitle(data.positionTitle ?? null);
        setPhase("ready");
      })
      .catch(() => {
        if (active) setPhase("invalid");
      });
    return () => {
      active = false;
    };
  }, [token]);

  const submit = async () => {
    if (score < 1 || score > 5) {
      setError("Pilih nilai 1 sampai 5 dulu, ya.");
      return;
    }
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/public/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, score, comment: comment.trim() || undefined }),
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const data = json as { error?: string } | null;
        setError(data?.error ?? "Gagal menyimpan jawaban. Coba lagi nanti.");
        setPhase("ready");
        return;
      }
      setPhase("done");
    } catch {
      setError("Gagal menyimpan jawaban. Coba lagi nanti.");
      setPhase("ready");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <Card className="w-full max-w-md rounded-3xl p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
            <Star className="size-7" aria-hidden="true" />
          </div>

          {phase === "loading" ? (
            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Memuat survei...
            </div>
          ) : phase === "invalid" ? (
            <>
              <h1 className="mt-5 text-xl font-bold">Tautan survei tidak tersedia</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Tautan ini tidak valid atau sudah kedaluwarsa. Tidak perlu apa-apa —
                masukan kamu tetap kami hargai.
              </p>
            </>
          ) : phase === "answered" || phase === "done" ? (
            <>
              <span className="mx-auto mt-5 flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
                <CheckCircle2 className="size-6" aria-hidden="true" />
              </span>
              <h1 className="mt-4 text-xl font-bold">Terima kasih</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Jawabanmu sudah tercatat. Masukan kamu membantu kami membuat proses
                rekrutmen yang lebih baik.
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-5 text-xl font-bold">
                Seberapa puas kamu dengan proses rekrutmen kami?
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {positionTitle
                  ? `Posisi: ${positionTitle}. `
                  : ""}
                Cukup 1 menit — jawabanmu anonim.
              </p>

              <div
                className="mt-6 flex items-center justify-center gap-2"
                role="radiogroup"
                aria-label="Nilai kepuasan 1 sampai 5"
              >
                {[1, 2, 3, 4, 5].map((value) => {
                  const active = value <= (hover || score);
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={score === value}
                      aria-label={`${value} — ${SCORE_LABELS[value]}`}
                      className={cn(
                        "flex size-11 items-center justify-center rounded-xl border transition-colors",
                        active
                          ? "border-rose-600 bg-rose-600 text-white"
                          : "border-zinc-200 bg-background text-zinc-400 hover:border-rose-300 hover:text-rose-500 dark:border-zinc-700",
                      )}
                      onMouseEnter={() => setHover(value)}
                      onMouseLeave={() => setHover(0)}
                      onClick={() => {
                        setScore(value);
                        setError(null);
                      }}
                    >
                      <Star
                        className={cn("size-5", active && "fill-current")}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
              {score > 0 ? (
                <p className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
                  {SCORE_LABELS[score]}
                </p>
              ) : null}

              <Textarea
                className="mt-4 min-h-20 resize-none"
                placeholder="Masukan tambahan (opsional)"
                value={comment}
                maxLength={1000}
                onChange={(event) => setComment(event.target.value)}
                aria-label="Masukan tambahan"
              />

              {error ? (
                <p className="mt-3 text-sm text-rose-600 dark:text-rose-400" role="alert">
                  {error}
                </p>
              ) : null}

              <Button
                className="mt-4 w-full min-h-11"
                disabled={phase === "sending"}
                onClick={() => void submit()}
              >
                {phase === "sending" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                Kirim jawaban
              </Button>
            </>
          )}
        </Card>
      </main>
      <footer className="mt-auto border-t py-4 text-center text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <BrandMark size="sm" />
          Survei pengalaman kandidat
        </span>
      </footer>
    </div>
  );
}
