export class ProviderRequestError extends Error {
  readonly status: number;
  readonly upstreamBody?: unknown;

  constructor(message: string, status: number, upstreamBody?: unknown) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = status;
    this.upstreamBody = upstreamBody;
  }
}

export const toProviderDateString = (date: Date): string =>
  date.toISOString().slice(0, 19).replace("T", " ");
