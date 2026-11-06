import { describe, expect, test } from "bun:test";
import { splitStatements } from "./manual-sql";

describe("splitStatements", () => {
  test("drops comment lines and splits on semicolons", () => {
    const sql = "-- komentar\nSELECT 1;\n\n-- lagi\nSELECT 2;\n";
    expect(splitStatements(sql)).toEqual(["SELECT 1", "SELECT 2"]);
  });

  test("keeps a multi-line statement together", () => {
    const sql =
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS x\n  ON t ((a->>'b'), c);";
    expect(splitStatements(sql)).toEqual([
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS x\n  ON t ((a->>'b'), c)",
    ]);
  });

  test("ignores an empty file", () => {
    expect(splitStatements("-- hanya komentar\n")).toEqual([]);
  });
});
