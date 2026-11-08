import type { OperationalStatisticsResult } from "../service/statistics.service";

/** Data contoh untuk menguji laporan Excel (dipakai tes workbook dan tes route). */
const UNVERIFIED = {
  status: "UNVERIFIED",
  by: null,
  at: null,
  note: null,
  history: [],
};

export function sampleReportResult(
  overrides: Partial<OperationalStatisticsResult> = {},
): OperationalStatisticsResult {
  return {
    period: "daily",
    startDate: "2026-11-01",
    endDate: "2026-11-02",
    traffic: {
      totalAircraft: 6,
      totalGroundVehicle: 0,
      totalTraffic: 6,
      averageTrafficPerHour: 0.12,
      peakTrafficMovement: 3,
      peakTrafficHour: "2026-11-01T09:00",
    },
    movement: {
      totalTakeoff: 5,
      totalLanding: 3,
      averageMovementPerHour: 0.17,
      peakHourMovement: 3,
      peakHour: "2026-11-01T09:00",
    },
    alerts: {
      stca: {
        count: 2,
        details: [
          {
            alertId: "STCA|WARR|a",
            type: "STCA",
            callsign: "LNI878",
            severity: "CRITICAL",
            time: "2026-11-02T05:10:00+07:00",
            description: "Kemungkinan konflik LNI878 dan LNI786",
            verification: {
              status: "VERIFIED",
              by: "Budi",
              at: "2026-11-02T06:00:00+07:00",
              note: "Dikonfirmasi tower",
              history: [
                {
                  at: "2026-11-02T05:30:00+07:00",
                  by: "Sari",
                  from: "UNVERIFIED",
                  to: "FALSE_ALARM",
                  note: "Tampak derau radar",
                },
                {
                  at: "2026-11-02T06:00:00+07:00",
                  by: "Budi",
                  from: "FALSE_ALARM",
                  to: "VERIFIED",
                  note: "Dikonfirmasi tower",
                },
              ],
            },
          },
          {
            alertId: "STCA|WARR|b",
            type: "STCA",
            callsign: "LNI878",
            severity: "CRITICAL",
            time: "2026-11-01T21:00:00+07:00",
            description: "Kemungkinan konflik LNI878 dan BTK6391",
            verification: UNVERIFIED,
          },
        ],
      },
      apa: { count: 0, details: [] },
      da: { count: 0, details: [] },
      ria: {
        count: 1,
        details: [
          {
            alertId: "RUNWAY_INCURSION|WARR|c",
            type: "RUNWAY_INCURSION",
            callsign: null,
            severity: "WARNING",
            time: "2026-11-01T10:30:00+07:00",
            description: "Memasuki runway 10/28",
            verification: UNVERIFIED,
          },
        ],
      },
      taia: { count: 0, details: [] },
      total: 3,
    },
    trend: [
      {
        period: "2026-11-01",
        aircraft: 4,
        aircraftList: [
          { aircraft: "LNI878", count: 3 },
          { aircraft: "BTK6391", count: 1 },
        ],
        groundVehicle: 0,
        takeoff: 3,
        landing: 2,
        totalMovement: 5,
        alerts: 2,
        takeoffAircraftCount: 2,
        landingAircraftCount: 2,
        takeoffAircraft: [
          { aircraft: "LNI878", count: 2, at: "2026-11-01T09:12:00" },
          { aircraft: "BTK6391", count: 1, at: "2026-11-01T22:16:00" },
        ],
        landingAircraft: [
          { aircraft: "LNI690", count: 2, at: "2026-11-01T14:05:00" },
        ],
      },
      {
        period: "2026-11-02",
        aircraft: 2,
        aircraftList: [{ aircraft: "LNI878", count: 2 }],
        groundVehicle: 0,
        takeoff: 2,
        landing: 1,
        totalMovement: 3,
        alerts: 1,
        takeoffAircraftCount: 1,
        landingAircraftCount: 1,
        takeoffAircraft: [
          { aircraft: "LNI878", count: 2, at: "2026-11-02T05:11:00" },
        ],
        landingAircraft: [{ aircraft: "LNI690", count: 1, at: null }],
      },
    ],
    ...overrides,
  };
}
