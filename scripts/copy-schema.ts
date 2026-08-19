import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

// biome-ignore-start lint/suspicious/noConsole: schema bundling utility
const SCHEMA_DIR = "packages/database/drizzle/schema";
const OUT_DIR = join(SCHEMA_DIR, ".single");

const args = process.argv.slice(2);
const stripComments = args.includes("--strip-comments");
const positional = args.filter((a) => a !== "--strip-comments");

const entryName: string | undefined = positional[0];
if (!entryName) {
  console.error(
    "Usage: bun scripts/copy-schema.ts <schema-name|all> [--strip-comments]",
  );
  process.exit(1);
}

const isAll = entryName === "all";
const entryPath = resolve(`${SCHEMA_DIR}/${isAll ? "index" : entryName}.ts`);
const outName: string = isAll ? "all" : entryName;

if (!existsSync(entryPath)) {
  console.error(`Schema file not found: ${entryPath}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const inlined = new Set<string>();
const importBlocks = new Set<string>();
let currentImport: string[] = [];
const bodyLines: string[] = [];

const lineCommentRegex = /(?<!:)\/\/.*$/gm;
const blockCommentRegex = /^\s*\/\*[\s\S]*?\*\/\s*$/gm;

const cleanComments = (source: string): string =>
  source.replace(blockCommentRegex, "").replace(lineCommentRegex, "");

const localFromRegex = /^(?:import|export)\b.*?from\s+["'](\.[^"']+)["'];?\s*$/;
const exportFromRegex = /^export\s+\{(?<specifiers>[^}]*)\}\s+from\s+["']\./;

const importRegex =
  /^(?<kind>import(?:\s+type)?)\s+(?<specifiers>[\s\S]+?)\s+from\s+["'](?<module>[^"']+)["'];?\s*$/;

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: schema bundling utility
const mergeImports = (blocks: Set<string>): string[] => {
  type ImportInfo = {
    typeDefault?: string;
    valueDefault?: string;
    namespace?: string;
    types: Set<string>;
    values: Set<string>;
  };

  const byModule = new Map<string, ImportInfo>();
  const moduleOrder: string[] = [];

  for (const block of blocks) {
    const m = block.match(importRegex);
    if (!m?.groups) continue;
    const { kind, specifiers, module } = m.groups as {
      kind: string;
      specifiers: string;
      module: string;
    };
    if (!byModule.has(module)) {
      byModule.set(module, { types: new Set(), values: new Set() });
      moduleOrder.push(module);
    }
    const info = byModule.get(module);
    if (!info) continue;
    const isType = kind === "import type";

    const spec = specifiers.trim();
    if (spec.startsWith("* as ")) {
      info.namespace = spec.slice(5).trim();
      continue;
    }

    if (spec.startsWith("{") && spec.endsWith("}")) {
      const inner = spec.slice(1, -1);
      const parts = inner
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      for (let part of parts) {
        let typeOnly = isType;
        if (part.startsWith("type ")) {
          typeOnly = true;
          part = part.slice(5).trim();
        }
        (typeOnly ? info.types : info.values).add(part);
      }
      continue;
    }

    if (isType) {
      info.typeDefault = spec;
    } else {
      info.valueDefault = spec;
    }
  }

  const rendered: string[] = [];
  for (const module of moduleOrder) {
    const info = byModule.get(module);
    if (!info) continue;
    if (info.typeDefault)
      rendered.push(`import type ${info.typeDefault} from "${module}";`);
    if (info.valueDefault)
      rendered.push(`import ${info.valueDefault} from "${module}";`);
    if (info.namespace)
      rendered.push(`import * as ${info.namespace} from "${module}";`);
    if (info.types.size || info.values.size) {
      const specs = [
        ...info.values,
        ...[...info.types].map((t) => `type ${t}`),
      ];
      rendered.push(`import { ${specs.join(", ")} } from "${module}";`);
    }
  }
  return rendered;
};

const resolveLocal = (baseDir: string, target: string): string => {
  const withExt = target.endsWith(".ts") ? target : `${target}.ts`;
  const candidates = [
    resolve(baseDir, withExt),
    resolve(baseDir, target),
    resolve(baseDir, target, "index.ts"),
  ];
  for (const candidate of candidates) {
    const stat = statSync(candidate, { throwIfNoEntry: false });
    if (stat?.isFile()) return candidate;
  }
  return resolve(baseDir, withExt);
};

const flushImport = (): void => {
  if (currentImport.length > 0) {
    const block = currentImport
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .join("\n");
    if (block) importBlocks.add(block);
    currentImport = [];
  }
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: schema bundling utility
const processFile = (filePath: string): void => {
  if (inlined.has(filePath)) return;
  inlined.add(filePath);

  const baseDir = dirname(filePath);
  let source = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  if (stripComments) source = cleanComments(source);

  const lines = source.split("\n");
  for (const line of lines) {
    const trimmed = line.trimStart();

    if (trimmed.startsWith("import") || currentImport.length > 0) {
      const localMatch = line.match(localFromRegex);
      if (localMatch) {
        currentImport = [];
        const target = localMatch[1];
        processFile(resolveLocal(baseDir, target));
        continue;
      }
      currentImport.push(line);
      if (line.trimEnd().endsWith(";")) {
        flushImport();
      }
      continue;
    }

    const localExportMatch = line.match(localFromRegex);
    if (localExportMatch && trimmed.startsWith("export")) {
      const target = localExportMatch[1];
      const exportSpec = line.match(exportFromRegex);
      if (exportSpec) {
        bodyLines.push(`export {${exportSpec.groups?.specifiers ?? ""}};`);
      }
      processFile(resolveLocal(baseDir, target));
      continue;
    }

    bodyLines.push(line);
  }

  flushImport();
};

processFile(entryPath);

const output = `${[...mergeImports(importBlocks), "", ...bodyLines].join("\n").trim()}\n`;
const outPath = join(OUT_DIR, `${outName}.ts`);

writeFileSync(outPath, output);
console.log(`Wrote bundled schema to ${outPath}`);
// biome-ignore-end lint/suspicious/noConsole: bundling script
