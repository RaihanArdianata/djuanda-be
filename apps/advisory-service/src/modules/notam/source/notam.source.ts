import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { NotamSourceItem } from "../parser/common";

export type NotamSource = () => Promise<NotamSourceItem[]>;

const notamSourceItemSchema = z.record(z.string(), z.unknown());

const notamSourceFileSchema = z.object({
  data: z.array(notamSourceItemSchema),
});

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_NOTAM_MOCK_SOURCE_PATH = path.resolve(
  CURRENT_DIR,
  "../../../source/notam.json",
);

export const loadNotamFromMockSource: NotamSource = async (
  filePath: string = DEFAULT_NOTAM_MOCK_SOURCE_PATH,
): Promise<NotamSourceItem[]> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read NOTAM mock source at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `NOTAM mock source at ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = notamSourceFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `NOTAM mock source at ${filePath} does not match the expected { data: [...] } structure: ${result.error.message}`,
    );
  }

  return result.data.data as NotamSourceItem[];
};
