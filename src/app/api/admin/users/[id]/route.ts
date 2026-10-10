// GET    /api/admin/users/[id] — detail pengguna (termasuk scope posisi & status 2FA, OWNER saja).
// PATCH  /api/admin/users/[id] — update nama/role/status aktif/password/scope posisi/reset 2FA (OWNER saja).
//        Aksi undangan (NR-19): body {action: "resend-invite"} / {action: "cancel-invite"}.
// DELETE /api/admin/users/[id] — hapus pengguna (OWNER saja, dengan proteksi owner terakhir).
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import type { AdminUser as AdminUserRecordModel } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession, hashPassword, revokeUserSessions } from "@/lib/server-auth";
import { queueEmail, sendSystemEvent } from "@/lib/notify";
import { shouldRouteToApproval, createApprovalRequest } from "@/lib/dual-control";
import { readPasswordPolicy, validatePassword } from "@/lib/password-policy";
import { parseAssignedPositions, serializeAdminUser } from "@/lib/seed";
import { ROLES } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Pengguna tidak ditemukan" };

const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // tautan undangan berlaku 48 jam

/** Tambahkan status undangan (TANPA token) ke hasil serializeAdminUser. */
function withInviteFields(user: AdminUserRecordModel) {
  return {
    ...serializeAdminUser(user),
    invitePending:
      !!user.inviteToken && !!user.inviteExpiresAt && user.inviteExpiresAt.getTime() > Date.now(),
    inviteExpiresAt: user.inviteExpiresAt ? user.inviteExpiresAt.toISOString() : null,
  };
}

/** Kirim ulang email undangan admin (NR-19). Token TIDAK masuk log maupun respons. */
async function sendInviteEmail(
  user: AdminUserRecordModel,
  inviteToken: string,
  origin: string,
  actorName: string,
): Promise<void> {
  const roleLabel = user.role === "OWNER" ? "Pemilik" : user.role === "HR" ? "HR" : "Pengamat";
  const inviteUrl = `${origin}/#admin/invite?token=${inviteToken}`;
  await queueEmail({
    toEmail: user.email,
    subject: "Undangan Admin Lumina Studio",
    body: [
      `Halo ${user.name},`,
      "",
      `Anda diundang menjadi admin Lumina Studio dengan role ${roleLabel}.`,
      "Untuk mengaktifkan akun Anda, buka tautan berikut lalu atur password pilihan Anda:",
      "",
      inviteUrl,
      "",
      "Ketentuan:",
      "- Tautan berlaku 48 jam sejak email ini dikirim.",
      "- Setelah password diatur, Anda dapat langsung masuk ke Panel Admin.",
      "- Bila Anda tidak merasa mengharapkan undangan ini, abaikan email ini.",
      "",
      "Salam hangat,",
      `Tim Lumina Studio (diundang oleh ${actorName})`,
    ].join("\n"),
    kind: "INVITE",
  });
}

async function requireOwner() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json(UNAUTHORIZED, { status: 401 }) as NextResponse, session: null };
  if (session.role !== "OWNER") return { error: NextResponse.json(FORBIDDEN, { status: 403 }) as NextResponse, session: null };
  return { error: null, session };
}

/** Respons detail user: profil dasar + scope posisi (string[]) + status 2FA. */
function serializeUserDetail(user: AdminUserRecordModel) {
  return {
    ...serializeAdminUser(user),
    totpEnabled: user.totpEnabled,
    assignedPositions: parseAssignedPositions(user.assignedPositions),
  };
}

/** True jika target adalah satu-satunya OWNER aktif (tidak boleh dinonaktifkan/diturunkan/dihapus). */
async function isLastActiveOwner(targetId: string): Promise<boolean> {
  const activeOwnerCount = await db.adminUser.count({ where: { role: "OWNER", isActive: true } });
  const target = await db.adminUser.findUnique({ where: { id: targetId } });
  return !!target && target.role === "OWNER" && target.isActive && activeOwnerCount <= 1;
}

// GET: dipakai dialog edit pengguna untuk memuat scope posisi & status 2FA.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;
    const { id } = await params;

    const user = await db.adminUser.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    return NextResponse.json(serializeUserDetail(user));
  } catch (error) {
    console.error("[GET /api/admin/users/[id]]", error);
    return NextResponse.json({ error: "Gagal memuat pengguna. Coba lagi nanti." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;
    const { id } = await params;

    const existing = await db.adminUser.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const session = guard.session!;

    // ---------------- Aksi undangan (NR-19) — sebelum penanganan field biasa ----------------
    if (data.action === "resend-invite") {
      // Regenerate token selalu + perpanjang 48 jam, lalu kirim email undangan lagi.
      const inviteToken = randomBytes(24).toString("hex");
      const updated = await db.adminUser.update({
        where: { id },
        data: { inviteToken, inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      await sendInviteEmail(updated, inviteToken, req.nextUrl.origin, session.name);
      await db.activityLog.create({
        data: {
          actor: session.name,
          action: "USER_INVITE_RESENT",
          detail: `Undangan admin dikirim ulang ke ${updated.email} — tautan baru berlaku 48 jam`,
        },
      });
      return NextResponse.json(withInviteFields(updated));
    }
    if (data.action === "cancel-invite") {
      // Batalkan undangan tertunda: token + kedaluwarsa dikosongkan.
      const updated = await db.adminUser.update({
        where: { id },
        data: { inviteToken: null, inviteExpiresAt: null },
      });
      await db.activityLog.create({
        data: {
          actor: session.name,
          action: "USER_INVITE_CANCELLED",
          detail: `Undangan admin untuk ${updated.email} dibatalkan`,
        },
      });
      return NextResponse.json(withInviteFields(updated));
    }

    const updateData: {
      name?: string;
      role?: string;
      isActive?: boolean;
      passwordHash?: string;
      assignedPositions?: string;
      totpSecret?: string | null;
      totpEnabled?: boolean;
      // NR46
      expiresAt?: Date | null;
      lastPasswordChangedAt?: Date;
      mustChangePassword?: boolean;
    } = {};
    // NR46 — jejak aksi untuk audit ringkas.
    const changes: string[] = [];

    if (data.name !== undefined) {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (name.length < 2) {
        return NextResponse.json({ error: "Nama minimal 2 karakter." }, { status: 400 });
      }
      updateData.name = name;
    }
    if (data.role !== undefined) {
      if (typeof data.role !== "string" || !(ROLES as string[]).includes(data.role)) {
        return NextResponse.json({ error: "Role tidak valid." }, { status: 400 });
      }
      // NR46 — perubahan role wajib konfirmasi mengetik email target.
      if (data.role !== existing.role) {
        const confirmEmail = typeof data.confirmEmail === "string" ? data.confirmEmail.trim() : "";
        if (confirmEmail.toLowerCase() !== existing.email.toLowerCase()) {
          return NextResponse.json(
            { error: "Konfirmasi wajib: ketik email pengguna dengan tepat untuk mengubah role." },
            { status: 400 },
          );
        }
      }
      updateData.role = data.role;
    }
    if (data.isActive !== undefined) {
      if (typeof data.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive harus berupa boolean." }, { status: 400 });
      }
      updateData.isActive = data.isActive;
    }
    // NR46 — tanggal kedaluwarsa akun (ISO string ATAU null untuk menghapus).
    if (data.expiresAt !== undefined) {
      if (data.expiresAt === null || (typeof data.expiresAt === "string" && !data.expiresAt.trim())) {
        updateData.expiresAt = null;
      } else if (typeof data.expiresAt === "string") {
        const parsed = new Date(data.expiresAt);
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json({ error: "Tanggal kedaluwarsa tidak valid." }, { status: 400 });
        }
        updateData.expiresAt = parsed;
      } else {
        return NextResponse.json({ error: "expiresAt harus ISO string atau null." }, { status: 400 });
      }
    }
    if (data.password !== undefined) {
      if (typeof data.password !== "string" || data.password.length < 6) {
        return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
      }
      // NR46 — reset sandi oleh OWNER tunduk pada kebijakan + wajib diganti pengguna.
      const policy = await readPasswordPolicy();
      const check = validatePassword(data.password, policy, existing.email);
      if (!check.ok) {
        return NextResponse.json(
          { error: `Sandi tidak memenuhi kebijakan: ${check.reasons.join(" ")}` },
          { status: 400 },
        );
      }
      updateData.passwordHash = hashPassword(data.password);
      updateData.lastPasswordChangedAt = new Date();
      updateData.mustChangePassword = true;
    }
    // Scope posisi granular untuk HR: array positionId (kosong = semua posisi).
    if (data.assignedPositions !== undefined) {
      if (
        !Array.isArray(data.assignedPositions) ||
        data.assignedPositions.some((v) => typeof v !== "string")
      ) {
        return NextResponse.json(
          { error: "assignedPositions harus berupa array string." },
          { status: 400 },
        );
      }
      const scope = [
        ...new Set(
          (data.assignedPositions as string[])
            .map((v) => v.trim())
            .filter(Boolean)
            .map((v) => v.slice(0, 100))
        ),
      ].slice(0, 100);
      updateData.assignedPositions = JSON.stringify(scope);
    }
    // OWNER mereset 2FA user lain: kosongkan secret TOTP + matikan penanda aktif.
    if (data.totpReset !== undefined) {
      if (typeof data.totpReset !== "boolean") {
        return NextResponse.json({ error: "totpReset harus berupa boolean." }, { status: 400 });
      }
      if (data.totpReset) {
        updateData.totpSecret = null;
        updateData.totpEnabled = false;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    // Cegah menonaktifkan / menurunkan satu-satunya OWNER yang aktif.
    const losesOwnerStatus =
      existing.role === "OWNER" &&
      existing.isActive &&
      ((updateData.role !== undefined && updateData.role !== "OWNER") || updateData.isActive === false);
    if (losesOwnerStatus && (await isLastActiveOwner(id))) {
      return NextResponse.json(
        { error: "Tidak dapat menonaktifkan atau menurunkan satu-satunya pemilik (OWNER) yang aktif." },
        { status: 400 },
      );
    }

    // NR46 — ringkas perubahan untuk audit + tentukan perlu cabut sesi atau tidak.
    if (updateData.role !== undefined && updateData.role !== existing.role) {
      changes.push(`role ${existing.role} → ${updateData.role}`);
    }
    if (updateData.isActive !== undefined && updateData.isActive !== existing.isActive) {
      changes.push(updateData.isActive ? "diaktifkan" : "dinonaktifkan");
    }
    if (updateData.passwordHash !== undefined) changes.push("sandi direset");
    if (updateData.expiresAt !== undefined) {
      changes.push(
        updateData.expiresAt
          ? `kedaluwarsa ${updateData.expiresAt.toISOString().slice(0, 10)}`
          : "kedaluwarsa dihapus",
      );
    }
    const shouldRevoke =
      (updateData.role !== undefined && updateData.role !== existing.role) ||
      updateData.passwordHash !== undefined ||
      updateData.isActive === false;

    const updated = await db.adminUser.update({ where: { id }, data: updateData });

    // NR46 — cabut semua sesi target agar perubahan role/sandi/nonaktif langsung efektif.
    if (shouldRevoke) {
      await revokeUserSessions(id);
    }

    // NR46 — audit + notifikasi perubahan sensitif.
    if (changes.length > 0) {
      await db.activityLog
        .create({
          data: {
            applicationId: null,
            actor: session.name,
            action: "USER_UPDATED",
            detail: `${updated.email}: ${changes.join(", ")} oleh ${session.name}`,
          },
        })
        .catch(() => undefined);
      if (changes.some((c) => c.startsWith("role") || c === "sandi direset" || c === "dinonaktifkan")) {
        await queueEmail({
          toEmail: updated.email,
          subject: "Perubahan Akun Admin Lumina Studio",
          body: [
            `Halo ${updated.name},`,
            "",
            `Akun admin Anda baru saja diperbarui oleh ${session.name}:`,
            `- ${changes.join("\n- ")}`,
            "",
            changes.includes("sandi direset")
              ? "WAJIB: masuk lalu segera ganti sandi Anda. Semua sesi lama telah dicabut."
              : "Bila Anda tidak mengharapkan perubahan ini, segera hubungi pemilik situs.",
            "",
            "Salam,",
            "Tim Lumina Studio",
          ].join("\n"),
          kind: "SYSTEM",
        }).catch(() => undefined);
        await sendSystemEvent({
          title: "Perubahan Akun Admin",
          detail: `${session.name} memperbarui ${updated.email}: ${changes.join(", ")}. Sesi lama dicabut.`,
          action: "USER_UPDATED",
          category: "SYSTEM",
        }).catch(() => undefined);
      }
    }

    return NextResponse.json(serializeUserDetail(updated));
  } catch (error) {
    console.error("[PATCH /api/admin/users/[id]]", error);
    return NextResponse.json({ error: "Gagal memperbarui pengguna. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;
    const session = guard.session!;
    const { id } = await params;

    const existing = await db.adminUser.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (id === session.id) {
      return NextResponse.json({ error: "Tidak dapat menghapus akun Anda sendiri." }, { status: 400 });
    }
    if (await isLastActiveOwner(id)) {
      return NextResponse.json(
        { error: "Tidak dapat menghapus satu-satunya pemilik (OWNER) yang aktif." },
        { status: 400 },
      );
    }

    // NR46 — empat mata: penghapusan akun admin lewat persetujuan OWNER lain.
    if (await shouldRouteToApproval()) {
      const requestId = await createApprovalRequest({
        kind: "USER_DELETE",
        payload: { userId: id },
        summary: `Hapus akun admin ${existing.email} (${existing.role})`,
        session,
      });
      return NextResponse.json(
        {
          approvalRequired: true,
          requestId,
          message: `Permintaan hapus akun ${existing.email} dikirim — menunggu persetujuan OWNER lain.`,
        },
        { status: 202 },
      );
    }

    await revokeUserSessions(id);
    await db.adminUser.delete({ where: { id } });
    await db.activityLog
      .create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "USER_DELETED",
          detail: `Akun ${existing.email} dihapus oleh ${session.name}`,
        },
      })
      .catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/users/[id]]", error);
    return NextResponse.json({ error: "Gagal menghapus pengguna. Coba lagi nanti." }, { status: 500 });
  }
}
