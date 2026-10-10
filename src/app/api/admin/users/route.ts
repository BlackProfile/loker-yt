// GET  /api/admin/users — daftar semua pengguna admin (OWNER saja).
// POST /api/admin/users — buat pengguna admin baru (OWNER saja).
//      Mode undangan (NR-19): body {name, email, role, invite: true} — akun dibuat tanpa
//      sandi dari admin; pelanggan menerima email berisi tautan 48 jam untuk mengatur sandi
//      sendiri via /api/public/admin-invite/accept. Token TIDAK pernah dikirim balik ke klien.
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/server-auth";
import { queueEmail } from "@/lib/notify";
import { readPasswordPolicy, validatePassword } from "@/lib/password-policy";
import { serializeAdminUser } from "@/lib/seed";
import { ROLES, type AdminUser } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_TTL_MS = 48 * 60 * 60 * 1000; // tautan undangan berlaku 48 jam

async function requireOwner(): Promise<{
  error: NextResponse | null;
  session: AdminSessionLocal | null;
}> {
  const session = await getSession();
  if (!session) return { error: NextResponse.json(UNAUTHORIZED, { status: 401 }), session: null };
  if (session.role !== "OWNER") return { error: NextResponse.json(FORBIDDEN, { status: 403 }), session: null };
  return { error: null, session };
}

type AdminSessionLocal = NonNullable<Awaited<ReturnType<typeof getSession>>>;

type AdminUserRecord = Awaited<ReturnType<typeof db.adminUser.findMany>>[number];

/** Tambahkan status undangan ke hasil serializeAdminUser — TANPA membocorkan token. */
function withInviteFields(user: AdminUserRecord): AdminUser {
  return {
    ...serializeAdminUser(user),
    invitePending: !!user.inviteToken && !!user.inviteExpiresAt && user.inviteExpiresAt.getTime() > Date.now(),
    inviteExpiresAt: user.inviteExpiresAt ? user.inviteExpiresAt.toISOString() : null,
  };
}

export async function GET() {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;

    const users = await db.adminUser.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return NextResponse.json(users.map(withInviteFields));
  } catch (error) {
    console.error("[GET /api/admin/users]", error);
    return NextResponse.json({ error: "Gagal memuat daftar pengguna. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireOwner();
    if (guard.error) return guard.error;
    const session = guard.session!;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data pengguna tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const name = typeof data.name === "string" ? data.name.trim() : "";
    const email = typeof data.email === "string" ? data.email.trim() : "";
    const password = typeof data.password === "string" ? data.password : "";
    const role = typeof data.role === "string" ? data.role.trim() : "";
    const invite = data.invite === true;

    if (name.length < 2) {
      return NextResponse.json({ error: "Nama minimal 2 karakter." }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    // Mode undangan tidak butuh password dari admin — penerima mengaturnya sendiri.
    const policy = await readPasswordPolicy();
    if (!invite) {
      if (password.length < 6) {
        return NextResponse.json({ error: "Password minimal 6 karakter." }, { status: 400 });
      }
      // NR46 — kebijakan sandi untuk akun yang dibuat langsung (bukan undangan).
      const check = validatePassword(password, policy, email);
      if (!check.ok) {
        return NextResponse.json(
          { error: `Sandi tidak memenuhi kebijakan: ${check.reasons.join(" ")}` },
          { status: 400 },
        );
      }
    }
    // NR46 — kedaluwarsa akun opsional (admin musiman/magang).
    let expiresAt: Date | null = null;
    if (typeof data.expiresAt === "string" && data.expiresAt.trim()) {
      const parsed = new Date(data.expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Tanggal kedaluwarsa tidak valid." }, { status: 400 });
      }
      expiresAt = parsed;
    }
    if (!(ROLES as string[]).includes(role)) {
      return NextResponse.json({ error: "Role tidak valid." }, { status: 400 });
    }

    // SQLite Prisma tidak mendukung mode: "insensitive"; cek unik email secara manual.
    const allUsers = await db.adminUser.findMany({ select: { email: true } });
    if (allUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return NextResponse.json({ error: "Email sudah terdaftar." }, { status: 400 });
    }

    if (!invite) {
      const created = await db.adminUser.create({
        data: {
          name,
          email,
          passwordHash: hashPassword(password),
          role,
          isActive: true,
          // NR46 — jejak sandi + kebijakan ganti sandi pertama.
          lastPasswordChangedAt: new Date(),
          mustChangePassword: policy.requireChangeFirstLogin,
          expiresAt,
        },
      });
      return NextResponse.json(withInviteFields(created), { status: 201 });
    }

    // ---------------- Mode undangan (NR-19) ----------------
    // passwordHash diisi hash dari token acak (tidak dipakai login langsung —
    // akan ditimpa saat penerima mengatur sandinya via tautan undangan).
    const inviteToken = randomBytes(24).toString("hex");
    const placeholderSecret = randomBytes(32).toString("hex");
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const created = await db.adminUser.create({
      data: {
        name,
        email,
        role,
        isActive: true,
        passwordHash: hashPassword(placeholderSecret),
        inviteToken,
        inviteExpiresAt,
        expiresAt, // NR46
      },
    });

    const inviteUrl = `${req.nextUrl.origin}/#admin/invite?token=${inviteToken}`;
    const roleLabel = role === "OWNER" ? "Pemilik" : role === "HR" ? "HR" : "Pengamat";

    await queueEmail({
      toEmail: email,
      subject: "Undangan Admin Lumina Studio",
      body: [
        `Halo ${name},`,
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
        `Tim Lumina Studio (diundang oleh ${session.name})`,
      ].join("\n"),
      kind: "INVITE",
    });

    await db.activityLog.create({
      data: {
        actor: session.name,
        action: "USER_INVITED",
        detail: `Undangan admin dikirim ke ${email} (role ${roleLabel}) — tautan berlaku 48 jam`,
      },
    });

    // Respons TIDAK menyertakan inviteToken — hanya status menunggu + kedaluwarsa.
    return NextResponse.json(withInviteFields(created), { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/users]", error);
    return NextResponse.json({ error: "Gagal membuat pengguna. Coba lagi nanti." }, { status: 500 });
  }
}
