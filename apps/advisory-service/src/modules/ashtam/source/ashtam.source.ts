import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AshtamSourceItem } from "../parser/common";

/**
 * A source is just "something that can produce a list of raw ASHTAM items".
 * The mock loader below implements this by reading a local JSON file; a
 * future `ashtam.provider.ts` (calling `POST /api/token` + `POST
 * /api/ashtam`, mirroring `aftn.provider.ts`) implements the same shape by
 * calling the external provider instead. The parser and repository never
 * need to know which one is in use.
 */
export type AshtamSource = () => Promise<AshtamSourceItem[]>;

const ashtamSourceItemSchema = z.record(z.string(), z.unknown());

const ashtamSourceFileSchema = z.object({
  data: z.array(ashtamSourceItemSchema),
});

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_ASHTAM_MOCK_SOURCE_PATH = path.resolve(
  CURRENT_DIR,
  "../../../source/ashtam.json",
);

/**
 * read JSON → validate structure → return data[]
 *
 * Intentionally does no parsing/normalization of individual fields — that is
 * the parser's job. This function only guarantees the file is readable, is
 * valid JSON, and has the documented `{ data: [...] }` shape.
 */
export const loadAshtamFromMockSource: AshtamSource = async (
  filePath: string = DEFAULT_ASHTAM_MOCK_SOURCE_PATH,
): Promise<AshtamSourceItem[]> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    throw new Error(
      `Could not read ASHTAM mock source at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `ASHTAM mock source at ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const result = ashtamSourceFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `ASHTAM mock source at ${filePath} does not match the expected { data: [...] } structure: ${result.error.message}`,
    );
  }

  return result.data.data as AshtamSourceItem[];
};
