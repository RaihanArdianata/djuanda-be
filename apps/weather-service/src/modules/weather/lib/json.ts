// Represents a value freshly parsed from JSON (e.g. response.json()) whose
// shape hasn't been validated yet. Same safety guarantee as `unknown`
// (no property access without narrowing) but scoped to what JSON can
// actually produce, so type guards read as validating real JSON shapes
// instead of an arbitrary unknown value.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonRecord = { [key: string]: JsonValue };
