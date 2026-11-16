import type {
  AftnMessage,
  MetarParsedData,
  NotamMessage,
  TafParsedData,
} from "@repo/database";
import type { AlertArea } from "./alert-area";

export interface MovementTrack {
  trackId: string;
  airportId: string;
  targetType: "AIRCRAFT" | "VEHICLE" | string;
  latitude: number;
  longitude: number;
  altitude?: number;
  groundSpeed?: number;
  heading?: number;
  onGround?: boolean;
  timestamp: Date;
  callsign?: string;
  registration?: string;
  aircraftType?: string;
  vehicleFleet?: string;
  lifecycle?: string;
  /** Laju vertikal / climb-descent rate (ft/min). Positif = naik, negatif = turun. */
  verticalRate?: number;
}

export interface WeatherContextData {
  station: string;
  current: {
    kind: string;
    observedAt: string;
    raw: string;
    parsed: MetarParsedData;
    stale: boolean;
    staleSince: string | null;
  } | null;
  forecast: {
    raw: string;
    forecast: TafParsedData;
    stale: boolean;
  } | null;
}

export interface AerodromeFeatureContext {
  id: string;
  layer: string;
  status: string | null;
  name?: string | null;
  polygon: [number, number][];
  /** [minLat, minLon, maxLat, maxLon] — precomputed at load so occupancy
   *  checks can skip point-in-polygon for polygons far from the track. */
  bbox?: [number, number, number, number];
  properties: Record<string, unknown>;
}

export interface PolygonOccupancy {
  polygonId: string;
  type: string;
  status: "AVAILABLE" | "OCCUPIED";
  aircraftIds: string[];
  aircraftCount: number;
}

/**
 * Track yang membuat polygon aerodrome berstatus terisi, beserta posisinya. Ikut dalam siaran status aerodrome supaya klien bisa
 * membandingkannya dengan track yang sedang ia gambar: segmen hijau tanpa pesawat di peta berarti ada track di sini yang tidak sampai
 * ke klien.
 */
export interface OccupantTrack {
  trackId: string;
  callsign?: string;
  targetType?: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  groundSpeed?: number;
  onGround?: boolean;
  /** Umur laporan terakhir menurut jam proses (ms). */
  ageMs: number;
  /** Polygon yang ditempatinya. */
  polygonIds: string[];
}

export interface AerodromeContextData {
  features: AerodromeFeatureContext[];
  /** Occupancy generic untuk SEMUA polygon feature (runway, taxiway, apron,
   *  dan layer polygon lainnya) — dihitung dari posisi track terkini, bukan
   *  event masuk. */
  occupancy?: PolygonOccupancy[];
  /** Track yang menempati polygon mana pun (lihat OccupantTrack). */
  occupants?: OccupantTrack[];
  runways: {
    id: string;
    name: string | null;
    status: string | null;
    active: boolean;
    polygon: [number, number][];
  }[];
  surfaces: {
    id: string;
    name: string | null;
    status: string | null;
    active: boolean;
    type: "TAXIWAY" | "APRON";
    polygon: [number, number][];
  }[];
  areas: {
    id: string;
    name: string | null;
    status: string | null;
    type: string;
    polygon: [number, number][];
  }[];
}

export interface AftnContextData {
  messages: AftnMessage[];
  byCallsign: Record<string, AftnMessage[]>;
}

export interface NotamContextData {
  messages: NotamMessage[];
}

export interface AlertContext {
  tracks: MovementTrack[];
  airportId: string;
  timestamp: Date;
  /** Area alert bandara (ARP + radius); null/undefined = tanpa batas zona STCA 2/3. */
  alertArea?: AlertArea | null;
  weather?: WeatherContextData | null;
  aerodrome?: AerodromeContextData | null;
  aftn?: AftnContextData | null;
  notam?: NotamContextData | null;
}

/** Konteks tambahan (selain aerodrome) yang dibaca sebuah rule. */
export type ContextNeed = "weather" | "aftn" | "notam";

export interface DetectionRule {
  type: string;
  /**
   * Konteks tambahan yang dibaca rule ini. Kosong/tidak diisi = tidak butuh. Cuaca, AFTN, dan NOTAM
   * hanya diambil bila ada rule aktif yang memintanya: mengambilnya tiap evaluasi (cache Redis
   * berukuran ribuan pesan, atau HTTP dengan timeout 2 detik) menahan setiap putaran evaluasi.
   */
  needs?: readonly ContextNeed[];
  evaluate: (
    ctx: AlertContext,
    config: Record<string, unknown>,
  ) => AlertCandidate[];
}

export interface AlertCandidate {
  alertId: string;
  airportId: string;
  type: string;
  severity: string;
  status: "ACTIVE";
  trackId: string;
  relatedTrackId?: string;
  aerodromeFeatureId?: string;
  triggeredAt: Date;
  data: Record<string, unknown>;
  /**
   * Kondisi harus bertahan sekian detik tanpa terputus sebelum alert dibuat (lihat policy/confirmation.ts). Tidak disimpan di database.
   * Kosong atau 0 = langsung.
   */
  confirmSeconds?: number;
}
