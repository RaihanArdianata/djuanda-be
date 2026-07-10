import {
  credentials,
  db,
  permissions,
  rolePermissions,
  userRoles,
  users,
} from "./index";

<<<<<<< HEAD
const hashPassword = (password: string): Promise<string> =>
  Bun.password.hash(password, {
    algorithm: "bcrypt",
=======
const hashPassword = (password: string) =>
  Bun.password.hash(password, {
    algorithm: 'bcrypt',
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
    cost: 4,
  });

export async function seed(): Promise<void> {
  try {
    const [roleOwner] = await db
      .insert(userRoles)
      .values({ name: "Owner" })
      .returning();
    const [roleAdmin] = await db
      .insert(userRoles)
      .values({ name: "Admin" })
      .returning();
    const [roleUser] = await db
      .insert(userRoles)
      .values({ name: "USER" })
      .returning();

    const [permManageUsers] = await db
      .insert(permissions)
      .values({
<<<<<<< HEAD
        name: "Manage Users",
        code: "users.manage",
        description: "Kelola data user",
=======
        name: 'Manage Users',
        code: 'users.manage',
        description: 'Kelola data user',
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
      })
      .returning();

    await db
      .insert(rolePermissions)
      .values({ roleId: roleOwner.id, permissionId: permManageUsers.id });
    await db
      .insert(rolePermissions)
      .values({ roleId: roleAdmin.id, permissionId: permManageUsers.id });

    const [superadmin] = await db
      .insert(users)
      .values({
<<<<<<< HEAD
        email: "admin@platform.com",
        isPlatformOwner: true,
        firstName: "Super",
        lastName: "Admin",
        phone: "081234567890",
        username: "superadmin",
      })
      .returning();
    await db.insert(credentials).values({
      userId: superadmin.id,
      passwordHash: await hashPassword("password1"),
    });
=======
        email: 'admin@platform.com',
        name: 'Super Admin',
        phone: '081234567890',
        username: 'superadmin',
      })
      .returning();
    await db.insert(credentials).values({ userId: superadmin.id, passwordHash: await hashPassword('password1') });
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0

    const [adminUser] = await db
      .insert(users)
      .values({
<<<<<<< HEAD
        email: "admin@tokoabc.com",
        firstName: "Admin",
        lastName: "TokoABC",
        phone: "081298765432",
        username: "admintokoabc",
        roleId: roleUser.id,
      })
      .returning();
    await db.insert(credentials).values({
      userId: adminUser.id,
      passwordHash: await hashPassword("password1"),
    });
  } catch (_error) {}
=======
        email: 'admin@tokoabc.com',
        name: 'Admin Toko ABC',
        phone: '081298765432',
        username: 'admintokoabc',
        roleId: roleUser.id,
      })
      .returning();
    await db.insert(credentials).values({ userId: adminUser.id, passwordHash: await hashPassword('password1') });

    console.log('Seeding selesai');
  } catch (error) {
    console.log(error, 'Gagal');
  }
>>>>>>> b73aa66c858b29b9f0e590d9ef03bbf7132effc0
}

seed();
