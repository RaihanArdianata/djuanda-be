import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";

export const bcryptHash = async (password: string): Promise<string> =>
  await bcrypt.hash(password, 12);

export const bcryptVerify = async (
  password: string,
  hashedPassword: string,
): Promise<boolean> => await bcrypt.compare(password, hashedPassword);

export const sha256Hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
