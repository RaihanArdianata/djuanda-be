import type { Alert } from "@repo/database";
import {
  buildAlertDescription,
  categoryOfAlertType,
  formatAlertDate,
  toDataView,
} from "@repo/shared/alert-description";

const WIB_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** `2026-11-08T19:53:06+07:00`: waktu dinding Jakarta, bentuk yang dibaca `formatAlertDate`. */
export function toJakartaIso(date: Date | string): string | null {
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return null;
  const parts: Record<string, string> = {};
  for (const p of WIB_PARTS.formatToParts(d)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`;
}

/** Keterangan satu alert (Potensi ..., jarak, batas, sebab, waktu); null bila jenisnya tidak dikenal. */
export function describeAlert(alert: Alert): string | null {
  const category = categoryOfAlertType(alert.type);
  if (!category) return null;
  const view = toDataView(alert.data);
  const iso = toJakartaIso(alert.triggeredAt);
  return buildAlertDescription({
    category,
    dateText: iso ? formatAlertDate(iso) : null,
    callsign: view.callsign,
    airportId: alert.airportId,
    severity: alert.severity,
    relatedTrackId: alert.relatedTrackId ?? null,
    area: view.area,
    surface: view.surface,
    facts: view.facts,
  });
}

/** Alert untuk klien: baris tabel ditambah `description`. */
export function withDescription<T extends Alert>(
  alert: T,
): T & { description: string | null } {
  return { ...alert, description: describeAlert(alert) };
}
