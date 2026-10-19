import type { AftnMessage } from "@repo/database";

export interface AftnAircraftDetail {
  id: string;
  callSign: string | null;
  registration: string | null;
  datetime: Date;
  status: string;
  route: string | null;
  dep: { icao: string | null; time: string | null };
  arrival: { icao: string | null; time: string | null };
}

export const buildAftnAircraftDetail = (
  rows: AftnMessage[],
): AftnAircraftDetail | null => {
  const latest = rows[0];
  if (!latest) return null;

  const pick = (get: (row: AftnMessage) => string | null): string | null => {
    for (const row of rows) {
      const value = get(row);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  };

  return {
    id: latest.id,
    callSign: pick((r) => r.callSign),
    registration: pick((r) => r.registration),
    datetime: latest.datetime,
    status: latest.messageType,
    route: pick((r) => r.route),
    dep: {
      icao: pick((r) => r.departure),
      time: pick((r) => r.departureTime),
    },
    arrival: {
      icao: pick((r) => r.destination),
      time: pick((r) => r.destinationTime),
    },
  };
};
