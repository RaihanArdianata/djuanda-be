// biome-ignore-start lint/suspicious/noConsole: seed output

import { bcryptHash } from "@repo/shared/utils/hashing";
import { eq } from "drizzle-orm";
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
const adminEmail: string = getEnv("SEED_ADMIN_EMAIL");
const adminPassword: string = getEnv("SEED_ADMIN_PASSWORD");

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

async function upsertUser(values: {
  email: string;
  name: string;
  phone: string;
  username: string;
  roleId?: number;
}): Promise<{ id: string }> {
  const [created] = await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({
      target: users.email,
      set: {
        name: values.name,
        phone: values.phone,
        username: values.username,
        roleId: values.roleId,
      },
    })
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
  }

  // Operator (role USER) minimal perlu lihat + acknowledge/clear alert.
  await grant(roleUser.id, permAlertView.id);
  await grant(roleUser.id, permAlertCreate.id);

  const superadmin = await upsertUser({
    email: superadminEmail,
    name: "Super Admin",
    phone: "081234567890",
    username: "superadmin",
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
    name: "Admin Toko ABC",
    phone: "081298765432",
    username: "admintokoabc",
    roleId: roleUser.id,
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
