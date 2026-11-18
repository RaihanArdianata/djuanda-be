// biome-ignore-start lint/suspicious/noConsole: seed output

import { bcryptHash } from "@repo/shared/utils/hashing";
import { eq, or } from "drizzle-orm";
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

async function upsertUser(values: {
  email: string;
  name: string;
  phone: string;
  username: string;
  roleId?: number;
}): Promise<{ id: string }> {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(
      or(
        eq(users.email, values.email),
        eq(users.username, values.username),
        eq(users.phone, values.phone),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(users)
      .set({
        email: values.email,
        name: values.name,
        phone: values.phone,
        username: values.username,
        roleId: values.roleId,
      })
      .where(eq(users.id, existing[0].id))
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

  const permManageUsers = await getOrCreatePermission(
    "Manage Users",
    "users.manage",
    "Kelola data user",
  );

  // Hapus alert permission lowercase lama (kalau sudah pernah di-seed) supaya
  // konsisten dengan convention UPPERCASE permission code.
  const staleAlertCodes = ["alert.view", "alert.create"];
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
    await grant(role.id, permManageUsers.id);
    await grant(role.id, permAlertView.id);
    await grant(role.id, permAlertCreate.id);
    await grant(role.id, permAlertEdit.id);
    await grant(role.id, permAlertClear.id);
    await grant(role.id, permAlertVerify.id);
    await grant(role.id, permAlertDelete.id);
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
