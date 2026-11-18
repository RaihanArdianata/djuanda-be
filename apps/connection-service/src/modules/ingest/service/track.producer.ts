import { logger } from "@repo/logger";
import { Kafka, type Producer } from "kafkajs";

const brokers = (
  process.env.AEROSWARM_TRACK_KAFKA_BROKERS ??
  process.env.KAFKA_BROKERS ??
  ""
)
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean);

const TRACK_TOPIC: string =
  process.env.AEROSWARM_TRACK_KAFKA_TOPIC || "asmgcs.tracks";

/**
 * Topik kedua berisi event track LENGKAP (semua field hasil dekode dan fusi, tidak dipangkas) untuk aplikasi lain.
 * `asmgcs.tracks` tetap berbentuk ringkas karena itu kontrak alert-service. Kosongkan nilainya untuk mematikan topik ini.
 */
const FULL_TRACK_TOPIC: string =
  process.env.AEROSWARM_TRACK_FULL_KAFKA_TOPIC ?? "asmgcs.tracks.full";

const kafka =
  brokers.length > 0
    ? new Kafka({ clientId: "connection-service", brokers })
    : null;

const producer: Producer | undefined = kafka?.producer();

/** Fused track event shape yang diterima ingest (trackId + fusedAt). */
interface FusedTrackEventLike {
  trackId: string;
  airportId?: string;
  lifecycle?: string;
  fusedAt: number;
  identity?: {
    targetType?: string;
    vehicleFleet?: number;
    callsign?: string;
    registration?: string;
    aircraftType?: string;
    [key: string]: unknown;
  };
  position?: {
    lat?: number;
    lon?: number;
    alt?: number;
    onGround?: boolean;
    [key: string]: unknown;
  };
  velocity?: {
    groundSpeed?: number;
    heading?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Envelope yang dikonsumsi alert-service track.consumer.ts. */
interface TrackUpdatedEvent {
  eventType: "TRACK_UPDATED";
  timestamp: string;
  data: {
    trackId: string;
    airportId: string;
    targetType: string;
    latitude: number;
    longitude: number;
    altitudeFt?: number;
    groundSpeedKt?: number;
    heading?: number;
    onGround?: boolean;
    callsign?: string;
    registration?: string;
    aircraftType?: string;
    vehicleFleet?: number;
    lifecycle?: string;
  };
}

function toTrackUpdatedEvent(
  event: FusedTrackEventLike,
): TrackUpdatedEvent | null {
  const lat = event.position?.lat;
  const lon = event.position?.lon;
  if (!event.airportId || typeof lat !== "number" || typeof lon !== "number") {
    return null;
  }

  return {
    eventType: "TRACK_UPDATED",
    timestamp: new Date(event.fusedAt).toISOString(),
    data: {
      trackId: event.trackId,
      airportId: event.airportId,
      targetType: event.identity?.targetType ?? "UNKNOWN",
      latitude: lat,
      longitude: lon,
      altitudeFt: event.position?.alt,
      groundSpeedKt: event.velocity?.groundSpeed,
      heading: event.velocity?.heading,
      onGround: event.position?.onGround,
      callsign: event.identity?.callsign,
      registration: event.identity?.registration,
      aircraftType: event.identity?.aircraftType,
      vehicleFleet: event.identity?.vehicleFleet,
      lifecycle: event.lifecycle,
    },
  };
}

/**
 * Bentuk tetap untuk konsumen: setiap field yang dikenal `FusedTrackEvent` selalu ada, bernilai `null` bila sensor tidak
 * mengirimnya (bukan hilang), jadi pembaca tidak perlu menebak "kosong" atau "tidak dikirim". Field di luar daftar ini
 * (mis. `meta`, `confidence`) ikut apa adanya.
 */
const NULL_FIELDS: Record<string, readonly string[]> = {
  identity: [
    "icao24",
    "callsign",
    "squawk",
    "targetType",
    "vehicleFleet",
    "aircraftType",
    "wake",
  ],
  route: ["adep", "ades"],
  details: [
    "trackNumber",
    "timeOfDay",
    "emitterCategory",
    "lengthM",
    "widthM",
    "orientationDeg",
  ],
  dataSource: ["sac", "sic"],
  position: ["lat", "lon", "alt", "altSource", "onGround"],
  velocity: ["groundSpeed", "heading", "verticalRate"],
};

/** `value` dengan setiap kunci di `keys` terisi: yang tidak ada (atau undefined) menjadi null. */
function withNulls(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const src =
    value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const out: Record<string, unknown> = { ...src };
  for (const k of keys) out[k] = src[k] ?? null;
  return out;
}

/** Event track lengkap dalam bentuk tetap (lihat NULL_FIELDS), kunci `trackId`. Event tanpa `trackId` dilewati. */
export function toFullTrackMessages(
  events: unknown[],
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const e of events) {
    const event = e as Record<string, unknown> | null;
    const trackId = event?.trackId;
    if (typeof trackId !== "string" || trackId === "") continue;
    const shaped: Record<string, unknown> = { ...event };
    for (const [group, keys] of Object.entries(NULL_FIELDS)) {
      shaped[group] = withNulls(event?.[group], keys);
    }
    out.push({ key: trackId, value: JSON.stringify(shaped) });
  }
  return out;
}

export async function startTrackProducer(): Promise<void> {
  if (!producer) {
    logger.info(
      "AEROSWARM_TRACK_KAFKA_BROKERS/KAFKA_BROKERS not set — track producer disabled, alert-service will not receive asmgcs.tracks",
    );
    return;
  }
  await producer.connect();
  logger.info({ brokers, topic: TRACK_TOPIC }, "track producer connected");
}

export async function stopTrackProducer(): Promise<void> {
  if (!producer) return;
  await producer
    .disconnect()
    .catch((err: unknown) =>
      logger.warn({ err }, "track producer disconnect failed"),
    );
}

/** Publish fused track events ke `asmgcs.tracks` untuk alert-service.
 *  Dipanggil setelah batch DB insert sukses — hanya event yang sudah
 *  ter-persist yang diteruskan ke alert pipeline. */
export async function publishTrackBatch(events: unknown[]): Promise<void> {
  if (!producer || events.length === 0) return;

  const messages = events
    .map((e) => toTrackUpdatedEvent(e as FusedTrackEventLike))
    .filter((e): e is TrackUpdatedEvent => e !== null)
    .map((e) => ({
      key: e.data.trackId,
      value: JSON.stringify(e),
    }));

  if (messages.length > 0) {
    await producer.send({ topic: TRACK_TOPIC, messages });
  }

  // Topik lengkap untuk aplikasi lain: kegagalannya tidak boleh mengganggu alur alert-service di atas.
  if (FULL_TRACK_TOPIC) {
    const full = toFullTrackMessages(events);
    if (full.length > 0) {
      await producer
        .send({ topic: FULL_TRACK_TOPIC, messages: full })
        .catch((err: unknown) =>
          logger.warn(
            { err, topic: FULL_TRACK_TOPIC },
            "full track publish failed",
          ),
        );
    }
  }
}
