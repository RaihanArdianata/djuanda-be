// biome-ignore-start lint/suspicious/noConsole: seed output

import { bcryptHash } from "@repo/shared/utils/hashing";
import { and, eq, ne, or } from "drizzle-orm";
import {
  credentials,
  db,
  permissions,
  pool,
  rolePermissions,
  userRoles,
  users,
} from "./index";

const isProduction = process.env.NODE_ENV === "production";
const allowProduction = Boolean(process.env.ALLOW_PRODUCTION_SEED);

if (isProduction && !allowProduction) {
  throw new Error(
    "Seeding in production requires ALLOW_PRODUCTION_SEED=1. This is a destructive operation and must be explicit.",
  );
}

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const superadminEmail: string = getEnv("SEED_SUPERADMIN_EMAIL");
const superadminPassword: string = getEnv("SEED_SUPERADMIN_PASSWORD");
const superadminUsername: string = getEnv("SEED_SUPERADMIN_USERNAME");
const superadminName: string =
  process.env.SEED_SUPERADMIN_NAME || "Super Admin";
const superadminPhone: string =
  process.env.SEED_SUPERADMIN_PHONE || "08999999990";
// Nama peran yang dicari di database (tabel user_roles); error bila tidak ada.
const superadminRoleName: string = process.env.SEED_SUPERADMIN_ROLE || "Owner";

const adminEmail: string = getEnv("SEED_ADMIN_EMAIL");
const adminPassword: string = getEnv("SEED_ADMIN_PASSWORD");
const adminUsername: string = getEnv("SEED_ADMIN_USERNAME");
const adminName: string = process.env.SEED_ADMIN_NAME || "Admin";
const adminPhone: string = process.env.SEED_ADMIN_PHONE || "089999999991";
const adminRoleName: string = process.env.SEED_ADMIN_ROLE || "Admin";

/**
 * Izin RBAC berbentuk `PATH.AKSI`. rbacMiddleware mencocokkan awal path request (huruf kecil) dan metode HTTP:
 * GET = VIEW, POST = CREATE, PUT/PATCH = EDIT, DELETE = DELETE. Satu baris per awal path yang dijaga rbacMiddleware di
 * service (alert, aerodrome, playback, statistics, weather, user, roles, permissions). Owner dan Admin menerima semuanya.
 */
const RBAC_PATHS = [
  "ALERT",
  "AERODROME",
  "PLAYBACK",
  "STATISTICS",
  "WEATHER",
  "USERS",
  "ROLES",
  "PERMISSIONS",
] as const;
const RBAC_ACTIONS = ["VIEW", "CREATE", "EDIT", "DELETE"] as const;

async function getOrCreateRole(
  name: string,
  description?: string,
): Promise<{ id: number }> {
  const existing = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.name, name))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const [created] = await db
    .insert(userRoles)
    .values({ name, description })
    .returning({ id: userRoles.id });

  return created;
}

async function getOrCreatePermission(
  name: string,
  code: string,
  description?: string,
): Promise<{ id: string }> {
  const existing = await db
    .select({ id: permissions.id })
    .from(permissions)
    .where(eq(permissions.code, code))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  const [created] = await db
    .insert(permissions)
    .values({ name, code, description })
    .returning({ id: permissions.id });

  return created;
}

/** Peran yang sudah ada di database menurut namanya; bila tidak ada, error yang menyebut peran apa saja yang ada. */
async function findRoleByName(name: string): Promise<{ id: number }> {
  const [found] = await db
    .select({ id: userRoles.id })
    .from(userRoles)
    .where(eq(userRoles.name, name))
    .limit(1);
  if (found) return found;

  const all = await db.select({ name: userRoles.name }).from(userRoles);
  const names = all.map((r) => r.name).join(", ") || "(belum ada)";
  throw new Error(
    `Peran "${name}" tidak ada di database. Peran yang ada: ${names}. Atur SEED_SUPERADMIN_ROLE / SEED_ADMIN_ROLE.`,
  );
}

/**
 * Membuat atau memperbarui satu pengguna seed. Pencocokan deterministik: email dulu; tanpa kecocokan email, pengguna seed
 * dengan email lama dikenali dari username atau telepon. Bila lebih dari satu baris cocok, atau username/telepon baru sudah
 * dipakai pengguna lain, seed berhenti dengan pesan yang menyebut siapa saja (tidak menebak baris mana yang diubah).
 */
async function upsertUser(values: {
  email: string;
  name: string;
  phone: string;
  username: string;
  roleId?: number;
}): Promise<{ id: string }> {
  const [byEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, values.email))
    .limit(1);
  let targetId: string | undefined = byEmail?.id;

  if (!targetId) {
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        or(eq(users.username, values.username), eq(users.phone, values.phone)),
      );
    if (rows.length > 1) {
      throw new Error(
        `Lebih dari satu pengguna cocok dengan username "${values.username}" atau telepon "${values.phone}": ${rows.map((r) => r.email).join(", ")}. Samakan atau hapus salah satunya dulu.`,
      );
    }
    targetId = rows[0]?.id;
  }

  if (targetId) {
    const clash = await db
      .select({ email: users.email })
      .from(users)
      .where(
        and(
          ne(users.id, targetId),
          or(
            eq(users.username, values.username),
            eq(users.phone, values.phone),
          ),
        ),
      );
    if (clash.length > 0) {
      throw new Error(
        `Username "${values.username}" atau telepon "${values.phone}" sudah dipakai pengguna lain: ${clash.map((c) => c.email).join(", ")}.`,
      );
    }
    const [updated] = await db
      .update(users)
      .set({
        email: values.email,
        name: values.name,
        phone: values.phone,
        username: values.username,
        roleId: values.roleId,
      })
      .where(eq(users.id, targetId))
      .returning({ id: users.id });
    return updated;
  }

  const [created] = await db
    .insert(users)
    .values(values)
    .returning({ id: users.id });

  return created;
}

async function seed(): Promise<void> {
  const roleOwner = await getOrCreateRole("Owner");
  const roleAdmin = await getOrCreateRole("Admin");
  const roleUser = await getOrCreateRole("USER");

  // Hapus alert permission lowercase lama (kalau sudah pernah di-seed) supaya
  // konsisten dengan convention UPPERCASE permission code.
  // "users.manage" juga dihapus: kodenya tidak cocok dengan metode HTTP mana pun, diganti USERS.VIEW/CREATE/EDIT/DELETE.
  const staleAlertCodes = ["alert.view", "alert.create", "users.manage"];
  for (const code of staleAlertCodes) {
    const existing = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.code, code))
      .limit(1);
    if (existing.length > 0) {
      await db
        .delete(rolePermissions)
        .where(eq(rolePermissions.permissionId, existing[0].id));
      await db.delete(permissions).where(eq(permissions.id, existing[0].id));
    }
  }

  const permAlertView = await getOrCreatePermission(
    "View Alerts",
    "ALERT.VIEW",
    "Lihat daftar & detail alert",
  );

  const permAlertCreate = await getOrCreatePermission(
    "Create/Manage Alerts",
    "ALERT.CREATE",
    "Deteksi, acknowledge, dan clear alert",
  );

  const permAlertEdit = await getOrCreatePermission(
    "Edit Alert Rules",
    "ALERT.EDIT",
    "Ubah konfigurasi & aktif/nonaktifkan alert rule",
  );

  const permAlertClear = await getOrCreatePermission(
    "Clear Alerts",
    "ALERT.CLEAR",
    "Clear / tutup alert",
  );

  const permAlertVerify = await getOrCreatePermission(
    "Verify Alerts",
    "ALERT.VERIFY",
    "Verifikasi status alert (valid / false alarm)",
  );

  const permAlertDelete = await getOrCreatePermission(
    "Delete Alerts",
    "ALERT.DELETE",
    "Hapus alert",
  );

  const grant = (roleId: number, permissionId: string): Promise<unknown> =>
    db
      .insert(rolePermissions)
      .values({ roleId, permissionId })
      .onConflictDoNothing();

  for (const role of [roleOwner, roleAdmin]) {
    await grant(role.id, permAlertView.id);
    await grant(role.id, permAlertCreate.id);
    await grant(role.id, permAlertEdit.id);
    await grant(role.id, permAlertClear.id);
    await grant(role.id, permAlertVerify.id);
    await grant(role.id, permAlertDelete.id);
  }

  // Semua fitur terbuka untuk Owner dan Admin: setiap kombinasi PATH.AKSI yang dicek rbacMiddleware.
  for (const path of RBAC_PATHS) {
    for (const action of RBAC_ACTIONS) {
      const perm = await getOrCreatePermission(
        `${action} ${path}`,
        `${path}.${action}`,
        `${action} untuk ${path.toLowerCase()}`,
      );
      for (const role of [roleOwner, roleAdmin]) {
        await grant(role.id, perm.id);
      }
    }
  }

  // Operator (role USER) minimal perlu lihat + acknowledge/clear/verify alert.
  await grant(roleUser.id, permAlertView.id);
  await grant(roleUser.id, permAlertCreate.id);
  await grant(roleUser.id, permAlertClear.id);
  await grant(roleUser.id, permAlertVerify.id);

  const superadminRole = await findRoleByName(superadminRoleName);
  const adminRole = await findRoleByName(adminRoleName);

  const superadmin = await upsertUser({
    email: superadminEmail,
    name: superadminName,
    phone: superadminPhone,
    username: superadminUsername,
    roleId: superadminRole.id,
  });

  const superadminHash = await bcryptHash(superadminPassword);
  await db
    .insert(credentials)
    .values({
      userId: superadmin.id,
      passwordHash: superadminHash,
    })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: { passwordHash: superadminHash },
    });

  const adminUser = await upsertUser({
    email: adminEmail,
    name: adminName,
    phone: adminPhone,
    username: adminUsername,
    roleId: adminRole.id,
  });

  const adminHash = await bcryptHash(adminPassword);
  await db
    .insert(credentials)
    .values({
      userId: adminUser.id,
      passwordHash: adminHash,
    })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: { passwordHash: adminHash },
    });
}

seed()
  .then(async () => {
    console.log("Seed completed.");
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await pool.end();
    process.exit(1);
  });
// biome-ignore-end lint/suspicious/noConsole: seed output
