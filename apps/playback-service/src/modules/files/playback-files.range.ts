export interface PlayableRangeInput {
  kind: string;
  requestedFrom?: Date | null;
  requestedTo?: Date | null;
  recordingFrom?: Date | null;
  recordingTo?: Date | null;
  stats?: unknown;
}

const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};
export function resolvePlayableRange(
  file: PlayableRangeInput,
): { from: Date; to: Date } | null {
  const stats = (file.stats ?? {}) as Record<string, unknown>;
  const declared =
    file.kind === "generated"
      ? [toDate(file.requestedFrom), toDate(file.requestedTo)]
      : [toDate(stats.headerFrom), toDate(stats.headerTo)];
  const recorded = [toDate(file.recordingFrom), toDate(file.recordingTo)];

  const [dFrom, dTo] = declared;
  const [rFrom, rTo] = recorded;
  const from = [dFrom, rFrom].filter((d): d is Date => d !== null);
  const to = [dTo, rTo].filter((d): d is Date => d !== null);
  if (from.length === 0 || to.length === 0) return null;

  const start = new Date(Math.min(...from.map((d) => d.getTime())));
  const end = new Date(Math.max(...to.map((d) => d.getTime())));
  return start < end ? { from: start, to: end } : null;
}
