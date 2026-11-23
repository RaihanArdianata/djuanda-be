/**
 * Penelusuran pesawat: di tahap mana sebuah pesawat terakhir terlihat atau dibuang, dan kenapa. Pertanyaan "kenapa pesawat X tidak tampil di
 * peta" tidak bisa dijawab dari statistik, karena pembuangan terjadi diam-diam di beberapa tahap (ingest, fusi, gambaran udara).
 *
 * Tiap tahap mencatat apa yang ia lakukan pada sebuah pesawat. Catatan yang sama digabung (dengan hitungan, waktu pertama dan terakhir),
 * jadi buffer tiap pesawat memuat langkah-langkah yang berbeda, bukan setiap laporan. Semuanya di memori, dibatasi per pesawat dan
 * jumlah pesawat.
 */

export type TraceStage = "ingest" | "fusi" | "gambaran-udara";

export interface TraceInput {
  icao24?: string;
  callsign?: string;
  trackId?: string;
  stage: TraceStage;
  outcome: string;
  detail?: string;
  /** Sensor atau protokol yang melapor, mis. `asterix-cat048 50:26`. */
  sensor?: string;
  lat?: number;
  lon?: number;
  alt?: number;
  onGround?: boolean;
}

export interface TraceEntry {
  stage: TraceStage;
  outcome: string;
  detail?: string;
  sensor?: string;
  firstAt: number;
  lastAt: number;
  count: number;
  lat?: number;
  lon?: number;
  alt?: number;
  onGround?: boolean;
  trackId?: string;
}

export interface TraceAircraft {
  icao24?: string;
  callsign?: string;
  trackId?: string;
  entries: TraceEntry[];
}

export interface TraceStore {
  record(input: TraceInput, now?: number): void;
  /** Pesawat yang callsign-nya memuat `q` (tanpa spasi dan huruf besar kecil), atau yang icao24 atau trackId-nya sama dengan `q`. */
  query(q: string): TraceAircraft[];
  readonly size: number;
}

export interface TraceOptions {
  /** Catatan terbaru yang disimpan per pesawat. Bawaan 30. */
  perAircraft?: number;
  /** Jumlah pesawat; yang paling lama tidak tersentuh dibuang. Bawaan 5000. */
  maxAircraft?: number;
}

const norm = (value: string | undefined): string =>
  (value ?? "").toUpperCase().replace(/[\s-]+/g, "");

interface Stored {
  icao24?: string;
  callsign?: string;
  trackId?: string;
  entries: TraceEntry[];
}

/** Catatan yang sama dengan yang baru (tahap, hasil, keterangan, sensor): digabung, bukan ditambah. */
function sameStep(entry: TraceEntry, input: TraceInput): boolean {
  return (
    entry.stage === input.stage &&
    entry.outcome === input.outcome &&
    entry.detail === input.detail &&
    entry.sensor === input.sensor
  );
}

function mergeStep(last: TraceEntry, input: TraceInput, now: number): void {
  last.count++;
  last.lastAt = now;
  last.lat = input.lat ?? last.lat;
  last.lon = input.lon ?? last.lon;
  last.alt = input.alt ?? last.alt;
  last.onGround = input.onGround ?? last.onGround;
}

function newStep(input: TraceInput, now: number): TraceEntry {
  return {
    stage: input.stage,
    outcome: input.outcome,
    detail: input.detail,
    sensor: input.sensor,
    firstAt: now,
    lastAt: now,
    count: 1,
    lat: input.lat,
    lon: input.lon,
    alt: input.alt,
    onGround: input.onGround,
    trackId: input.trackId,
  };
}

function identify(rec: Stored, input: TraceInput): void {
  if (input.icao24) rec.icao24 = input.icao24.toLowerCase();
  if (input.callsign?.trim()) rec.callsign = input.callsign.trim();
  if (input.trackId) rec.trackId = input.trackId;
}

export function createTraceStore(options: TraceOptions = {}): TraceStore {
  const perAircraft = options.perAircraft ?? 30;
  const maxAircraft = options.maxAircraft ?? 5_000;
  const byKey = new Map<string, Stored>();

  const keyOf = (input: TraceInput): string | undefined => {
    if (input.icao24) return `i:${input.icao24.toLowerCase()}`;
    if (input.trackId) return `t:${input.trackId}`;
    return undefined;
  };

  /** Catatan pesawat ini, dipindah ke paling belakang (disentuh terakhir); yang paling lama tidak tersentuh dibuang saat penuh. */
  const touch = (key: string): Stored => {
    const rec: Stored = byKey.get(key) ?? { entries: [] };
    byKey.delete(key);
    byKey.set(key, rec);
    if (byKey.size > maxAircraft) {
      const oldest = byKey.keys().next();
      if (!oldest.done) byKey.delete(oldest.value);
    }
    return rec;
  };

  return {
    record(input: TraceInput, now: number = Date.now()): void {
      const key = keyOf(input);
      if (!key) return;
      const rec = touch(key);
      identify(rec, input);

      // Satu laporan menulis tiga tahap bergantian (ingest, fusi, gambaran udara), jadi yang digabung adalah catatan terakhir yang SAMA di
      // mana pun letaknya, bukan hanya yang paling belakang; kalau tidak, buffer penuh dalam beberapa laporan dan riwayatnya hilang.
      // Catatan yang digabung dipindah ke belakang supaya urutan tetap menurut sentuhan terakhir.
      for (let i = rec.entries.length - 1; i >= 0; i--) {
        const entry = rec.entries[i];
        if (!entry || !sameStep(entry, input)) continue;
        rec.entries.splice(i, 1);
        mergeStep(entry, input, now);
        rec.entries.push(entry);
        return;
      }
      rec.entries.push(newStep(input, now));
      if (rec.entries.length > perAircraft) rec.entries.shift();
    },

    query(q: string): TraceAircraft[] {
      const wanted = norm(q);
      if (!wanted) return [];
      const out: TraceAircraft[] = [];
      for (const rec of byKey.values()) {
        const hit =
          norm(rec.callsign).includes(wanted) ||
          rec.icao24 === q.trim().toLowerCase() ||
          rec.trackId === q.trim();
        if (hit)
          out.push({
            icao24: rec.icao24,
            callsign: rec.callsign,
            trackId: rec.trackId,
            entries: [...rec.entries],
          });
      }
      return out;
    },

    get size(): number {
      return byKey.size;
    },
  };
}

const ago = (ms: number): string =>
  ms < 1_000
    ? "baru saja"
    : ms < 60_000
      ? `${Math.round(ms / 1_000)} dtk lalu`
      : `${Math.round(ms / 60_000)} mnt lalu`;

/**
 * Kesimpulan dalam kalimat dari catatan sebuah pesawat: di tahap mana ia terakhir terlihat atau dibuang. Tahap yang paling hilir yang punya
 * catatan menentukan; tahap sebelumnya menjelaskan.
 */
export function verdict(
  aircraft: TraceAircraft,
  now: number = Date.now(),
): string {
  const latest = (stage: TraceStage): TraceEntry | undefined =>
    [...aircraft.entries].reverse().find((e) => e.stage === stage);
  const ingest = latest("ingest");
  const fusion = latest("fusi");
  const live = latest("gambaran-udara");

  if (live?.outcome.startsWith("tampil")) {
    return `Ada di gambaran udara (${live.outcome}), terakhir ${ago(now - live.lastAt)}. Bila tidak terlihat di peta, masalahnya di tampilan klien.`;
  }
  if (live) {
    return `Sampai ke gambaran udara tetapi tidak ditampilkan: ${live.outcome}${live.detail ? ` (${live.detail})` : ""}, ${ago(now - live.lastAt)}.`;
  }
  if (fusion) {
    return `Sampai ke fusi (${fusion.outcome}) tetapi tidak pernah sampai ke gambaran udara.`;
  }
  if (ingest) {
    return `Dibuang di ingest: ${ingest.outcome}${ingest.detail ? ` (${ingest.detail})` : ""}, ${ago(now - ingest.lastAt)}. Pesawat ini tidak pernah sampai ke fusi dan peta.`;
  }
  return "Tidak ada catatan.";
}
