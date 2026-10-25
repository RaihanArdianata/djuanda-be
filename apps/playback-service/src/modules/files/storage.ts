import { Client } from "minio";

const endpoint: string = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const parsed = new URL(endpoint);
export const playbackBucket: string =
  process.env.PLAYBACK_BUCKET ?? "playback-files";
const credentials: { accessKey: string; secretKey: string } = {
  accessKey: process.env.MINIO_ACCESS_KEY ?? process.env.MINIO_ROOT_USER ?? "",
  secretKey:
    process.env.MINIO_SECRET_KEY ?? process.env.MINIO_ROOT_PASSWORD ?? "",
};
// MinIO is reached only from this process over the internal endpoint. There is
// deliberately no public endpoint or presigned-URL helper: browsers never talk
// to storage, uploads and downloads are proxied by the playback endpoints.
export const minio = new Client({
  endPoint: parsed.hostname,
  port: parsed.port
    ? Number(parsed.port)
    : parsed.protocol === "https:"
      ? 443
      : 80,
  // biome-ignore lint/style/useNamingConvention: option name defined by the minio client
  useSSL: parsed.protocol === "https:",
  ...credentials,
});

export async function ensurePlaybackBucket(): Promise<void> {
  if (await minio.bucketExists(playbackBucket)) return;
  try {
    await minio.makeBucket(playbackBucket);
  } catch (error) {
    // Two concurrent jobs can both see the bucket missing; the loser is fine.
    const code = (error as { code?: string }).code;
    if (code !== "BucketAlreadyOwnedByYou" && code !== "BucketAlreadyExists")
      throw error;
  }
}

export const isMissingObjectError = (error: unknown): boolean => {
  const code = (error as { code?: string }).code;
  return code === "NotFound" || code === "NoSuchKey";
};
