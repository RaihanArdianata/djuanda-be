/**
 * Role yang boleh login di beberapa perangkat sekaligus (tanpa batas sesi). Role lain tetap satu sesi per akun:
 * login baru memutus sesi sebelumnya (lihat `createUserSession`). Dibaca dari `CONCURRENT_SESSION_ROLES` (nama role
 * dipisah koma, tanpa membedakan huruf besar kecil); bawaan `guest`, kosong = tidak ada pengecualian.
 *
 * Modul sendiri (bukan di auth.service) supaya tes yang meniru auth.service tidak ikut meniru aturan ini.
 */
function concurrentSessionRoles(env: NodeJS.ProcessEnv): string[] {
  return (env.CONCURRENT_SESSION_ROLES ?? "guest")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
}

export function allowsConcurrentSessions(
  roleName: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const name = (roleName ?? "").trim().toLowerCase();
  return name.length > 0 && concurrentSessionRoles(env).includes(name);
}
