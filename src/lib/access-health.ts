// SERVER-ONLY — NR46: laporan "Kesehatan Akses" (Paket B) — kartu dashboard OWNER.
// Menggabungkan temuan akun & sesi: 2FA kosong, sandi tua/tak tercatat, sesi
// menggantung, akun nonaktif bersesi hidup, login gagal 24 jam, akun mendekati
// kedaluwarsa, dan sandi yang wajib diganti. TIDAK PERNAH melempar — komponen
// gagal menjadi temuan berstatus aman, bukan error.
import { db } from "@/lib/db";
import { readPasswordPolicy, passwordAgeDays } from "@/lib/password-policy";
import type { AccessFinding, AccessHealthReport, ServerLoadLevel } from "@/lib/types";

function worstLevel(a: ServerLoadLevel, b: ServerLoadLevel): ServerLoadLevel {
  if (a === "CRIT" || b === "CRIT") return "CRIT";
  if (a === "WARN" || b === "WARN") return "WARN";
  return "OK";
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

/** Ambil laporan kesehatan akses penuh (dipanggil route OWNER). */
export async function getAccessHealth(): Promise<AccessHealthReport> {
  const findings: AccessFinding[] = [];
  let level: ServerLoadLevel = "OK";
  const bump = (l: ServerLoadLevel) => {
    level = worstLevel(level, l);
  };

  const [users, activeSessions, failedLogins24h, policy] = await Promise.all([
    db.adminUser.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] }),
    db.sessionToken.findMany({ where: { revokedAt: null }, select: { id: true, userId: true, lastSeenAt: true } }),
    db.loginAudit.count({
      where: { success: false, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
    }),
    readPasswordPolicy(),
  ]);

  const active = users.filter((u) => u.isActive);
  const nameOf = (u: { name: string; email: string }) => `${u.name} (${u.email})`;

  // 1) Akun aktif tanpa 2FA — OWNER = kritis, lainnya saran.
  const noTotp = active.filter((u) => !u.totpEnabled);
  const ownersNoTotp = noTotp.filter((u) => u.role === "OWNER");
  const staffNoTotp = noTotp.filter((u) => u.role !== "OWNER");
  if (ownersNoTotp.length > 0) {
    bump("CRIT");
    findings.push({
      key: "owner_no_totp",
      severity: "CRIT",
      title: "Pemilik (OWNER) belum mengaktifkan 2FA",
      detail: "Akun pemilik adalah target utama pembobolan akun. Aktifkan TOTP dari menu keamanan.",
      targets: ownersNoTotp.slice(0, 5).map((u) => ({ id: u.id, label: nameOf(u) })),
      targetCount: ownersNoTotp.length,
    });
  }
  if (staffNoTotp.length > 0) {
    bump("WARN");
    findings.push({
      key: "staff_no_totp",
      severity: "WARN",
      title: `${staffNoTotp.length} akun aktif belum memakai 2FA`,
      detail: "2FA disarankan untuk semua akun admin, terutama HR yang memproses data kandidat.",
      targets: staffNoTotp.slice(0, 5).map((u) => ({ id: u.id, label: nameOf(u), sublabel: u.role })),
      targetCount: staffNoTotp.length,
    });
  }

  // 2) Sandi tua / tak tercatat (hanya bila rotasi diaktifkan; selalu laporkan yang tak tercatat).
  const stalePassword: { u: (typeof active)[number]; age: number }[] = [];
  const unknownPassword = active.filter((u) => !u.lastPasswordChangedAt);
  for (const u of active) {
    const age = passwordAgeDays(u.lastPasswordChangedAt);
    if (age != null && policy.rotationDays > 0 && age > policy.rotationDays) {
      stalePassword.push({ u, age });
    }
  }
  if (stalePassword.length > 0) {
    bump("WARN");
    findings.push({
      key: "stale_password",
      severity: "WARN",
      title: `${stalePassword.length} sandi melewati batas rotasi (${policy.rotationDays} hari)`,
      detail: "Minta pengguna mengganti sandinya dari menu pengaturan akun.",
      targets: stalePassword.slice(0, 5).map(({ u, age }) => ({
        id: u.id,
        label: nameOf(u),
        sublabel: `${age} hari`,
      })),
      targetCount: stalePassword.length,
    });
  }
  if (unknownPassword.length > 0) {
    findings.push({
      key: "unknown_password_age",
      severity: "INFO",
      title: `${unknownPassword.length} sandi belum tercatat tanggal perubahannya`,
      detail: "Tanggal perubahan sandi mulai dicatat sejak NR46. Akan terisi otomatis saat sandi diganti.",
      targets: unknownPassword.slice(0, 5).map((u) => ({ id: u.id, label: nameOf(u) })),
      targetCount: unknownPassword.length,
    });
  }

  // 3) Sesi menggantung (aktif > 14 hari tanpa aktivitas).
  const staleCutoff = Date.now() - 14 * 24 * 60 * 60_000;
  const staleSessions = activeSessions.filter((s) => s.lastSeenAt.getTime() < staleCutoff);
  if (staleSessions.length > 0) {
    bump("WARN");
    const userById = new Map(users.map((u) => [u.id, u]));
    findings.push({
      key: "stale_sessions",
      severity: "WARN",
      title: `${staleSessions.length} sesi tidak aktif lebih dari 14 hari`,
      detail: "Perangkat lama yang lupa logout tetap terhitung sesi hidup. Cabut yang tidak dikenal.",
      targets: staleSessions.slice(0, 5).map((s) => ({
        id: s.id,
        label: nameOf(userById.get(s.userId) ?? { name: "Akun terhapus", email: "-" }),
        sublabel: `terakhir aktif ${fmtDate(s.lastSeenAt)}`,
      })),
      targetCount: staleSessions.length,
    });
  }

  // 4) Akun nonaktif yang masih punya sesi hidup.
  const activeUserIdSet = new Set(active.map((u) => u.id));
  const inactiveSessions = activeSessions.filter((s) => !activeUserIdSet.has(s.userId));
  if (inactiveSessions.length > 0) {
    bump("CRIT");
    const userById = new Map(users.map((u) => [u.id, u]));
    findings.push({
      key: "inactive_with_sessions",
      severity: "CRIT",
      title: `${inactiveSessions.length} sesi milik akun yang sudah dinonaktifkan`,
      detail: "Sesi seharusnya dicabut otomatis saat akun dinonaktifkan. Cabut sekarang.",
      targets: inactiveSessions.slice(0, 5).map((s) => ({
        id: userById.get(s.userId)?.id ?? s.userId,
        label: nameOf(userById.get(s.userId) ?? { name: "Akun tidak dikenal", email: s.userId }),
        sublabel: "masih memiliki sesi aktif",
      })),
      targetCount: inactiveSessions.length,
      action: "revokeSessions",
      actionUserId: inactiveSessions[0]?.userId,
    });
  }

  // 5) Login gagal 24 jam terakhir.
  if (failedLogins24h > 0) {
    const sev: ServerLoadLevel = failedLogins24h >= 20 ? "CRIT" : "WARN";
    bump(sev);
    let topTargets: { id: string; label: string; sublabel?: string }[] = [];
    try {
      const grouped = await db.loginAudit.groupBy({
        by: ["email"],
        where: { success: false, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) } },
        _count: { email: true },
        orderBy: { _count: { email: "desc" } },
        take: 5,
      });
      topTargets = grouped.map((g) => ({ id: g.email, label: g.email, sublabel: `${g._count.email}x gagal` }));
    } catch {
      // diam
    }
    findings.push({
      key: "failed_logins",
      severity: sev === "CRIT" ? "CRIT" : "WARN",
      title: `${failedLogins24h} percobaan login gagal dalam 24 jam terakhir`,
      detail: failedLogins24h >= 20
        ? "Volume gagal login tinggi — kemungkinan percobaan masuk tanpa izin. Periksa daftar di bawah."
        : "Sedikit kegagalan wajar (salah ketik). Perhatikan bila menumpuk pada satu email.",
      targets: topTargets,
      targetCount: failedLogins24h,
    });
  }

  // 6) Akun mendekati kedaluwarsa (H-7).
  const soon = active.filter(
    (u) => u.expiresAt && u.expiresAt.getTime() > Date.now() && u.expiresAt.getTime() <= Date.now() + 7 * 24 * 60 * 60_000,
  );
  if (soon.length > 0) {
    findings.push({
      key: "expiring_soon",
      severity: "INFO",
      title: `${soon.length} akun akan kedaluwarsa dalam 7 hari`,
      detail: "Perpanjang tanggal kedaluwarsa di tab Pengguna bila akun masih dibutuhkan.",
      targets: soon.slice(0, 5).map((u) => ({
        id: u.id,
        label: nameOf(u),
        sublabel: `berakhir ${fmtDate(u.expiresAt as Date)}`,
      })),
      targetCount: soon.length,
    });
  }

  // 7) Akun yang wajib mengganti sandi.
  const mustChange = active.filter((u) => u.mustChangePassword);
  if (mustChange.length > 0) {
    findings.push({
      key: "must_change_password",
      severity: "INFO",
      title: `${mustChange.length} akun belum mengganti sandi wajib`,
      detail: "Akun ini mendapat sandi dari OWNER dan wajib menggantinya saat login pertama.",
      targets: mustChange.slice(0, 5).map((u) => ({ id: u.id, label: nameOf(u) })),
      targetCount: mustChange.length,
    });
  }

  const order: Record<string, number> = { CRIT: 0, WARN: 1, INFO: 2, OK: 3 };
  findings.sort((a, b) => {
    const sa = order[(a.severity === "INFO" ? "OK" : a.severity) as ServerLoadLevel] ?? 3;
    const sb = order[(b.severity === "INFO" ? "OK" : b.severity) as ServerLoadLevel] ?? 3;
    return sa - sb;
  });

  return {
    level,
    findings,
    stats: {
      totalUsers: users.length,
      activeUsers: active.length,
      ownerCount: active.filter((u) => u.role === "OWNER").length,
      activeSessions: activeSessions.length,
      failedLogins24h,
      dualControlEnabled: false, // diisi ulang oleh route (Setting dual_control)
    },
    checkedAt: new Date().toISOString(),
  };
}
