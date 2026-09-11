"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { BellRing, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/components/landing/lang-context";
import { Container, FadeIn } from "@/components/landing/primitives";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SubscribeSection() {
  const { t } = useLang();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      toast.error(t.subscribe.emailInvalid);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/public/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (res.ok) {
        toast.success(t.subscribe.success);
        setEmail("");
      } else {
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const serverError =
          data && typeof data.error === "string" ? data.error : null;
        toast.error(serverError ?? t.subscribe.failed);
      }
    } catch {
      toast.error(t.subscribe.failed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="bg-background py-16 md:py-24">
      <Container>
        <FadeIn>
          <div className="relative overflow-hidden rounded-3xl border bg-gradient-to-br from-rose-50 via-background to-amber-50 p-8 md:p-12 dark:border-rose-500/20 dark:from-rose-500/10 dark:via-background dark:to-amber-500/10">
            {/* Glow dekoratif mengambang pelan di pojok panel */}
            <motion.div
              aria-hidden="true"
              className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-rose-400/20 blur-3xl dark:bg-rose-500/10"
              animate={{ y: [0, 18, 0], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
            />
            <motion.div
              aria-hidden="true"
              className="absolute -bottom-20 -left-14 h-48 w-48 rounded-full bg-amber-400/20 blur-3xl dark:bg-amber-500/10"
              animate={{ y: [0, -14, 0], opacity: [0.55, 0.95, 0.55] }}
              transition={{
                duration: 12,
                repeat: Infinity,
                ease: "easeInOut",
                delay: 1.5,
              }}
            />
            <div className="relative mx-auto flex max-w-xl flex-col items-center text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                <BellRing className="h-6 w-6" aria-hidden="true" />
              </span>
              <h2 className="mt-4 text-2xl font-bold tracking-tight md:text-3xl">
                {t.subscribe.title}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground md:text-base">
                {t.subscribe.body}
              </p>
              <form
                onSubmit={handleSubmit}
                noValidate
                className="mt-6 flex w-full flex-col gap-2 sm:flex-row"
              >
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.subscribe.emailPh}
                  aria-label={t.subscribe.emailPh}
                  autoComplete="email"
                  className="h-11 flex-1"
                  disabled={loading}
                />
                <Button type="submit" className="h-11" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {t.subscribe.loading}
                    </>
                  ) : (
                    t.subscribe.button
                  )}
                </Button>
              </form>
            </div>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}
