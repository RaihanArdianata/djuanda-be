import type { AftnParsedExtras } from "@repo/database";

export interface NormalizedAftnMessage {
  datetime: Date;
  messageType: string;
  callSign: string | null;
  registration: string | null;
  aircraftType: string | null;
  departure: string | null;
  departureTime: string | null;
  destination: string | null;
  destinationTime: string | null;
  duration: string | null;
  speed: string | null;
  altitude: string | null;
  route: string | null;
  raw: string;

  parsed: AftnParsedExtras;
}
