"use client";

import {
  Sparkles,
  Film,
  Users,
  Rocket,
  Wallet,
  GraduationCap,
  Globe,
  Clock,
  Zap,
  Award,
  Heart,
  Calendar,
  Camera,
  Mic,
  PenTool,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

import { BENEFIT_ICONS } from "@/lib/types";

type BenefitIconName = (typeof BENEFIT_ICONS)[number];

// Pemetaan nama ikon (string dari admin) -> komponen lucide.
// Daftar nama sengaja dibatasi sesuai BENEFIT_ICONS di @/lib/types.
const ICON_MAP: Record<BenefitIconName, LucideIcon> = {
  Sparkles,
  Film,
  Users,
  Rocket,
  Wallet,
  GraduationCap,
  Globe,
  Clock,
  Zap,
  Award,
  Heart,
  Calendar,
  Camera,
  Mic,
  PenTool,
  TrendingUp,
};

export function BenefitIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICON_MAP[name as BenefitIconName] ?? Sparkles;
  return <Icon className={className} aria-hidden="true" />;
}
