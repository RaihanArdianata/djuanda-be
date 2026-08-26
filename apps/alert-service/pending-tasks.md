# Alert Service — Pending Tasks

Daftar fitur A-SMGCS `alert-service` yang belum diimplementasikan atau masih parsial.

## Completed in this pass

- STCA vertical separation (`minimumVerticalSeparationFt`) and unit tests
- Deviation time threshold (`maximumTimeDeviation`) with `expectedRouteTimes` and unit tests
- Unit tests for runway incursion, taxiway/apron incursion, and deviation
- `modules/engine/alert.lifecycle.ts` for alert lifecycle transitions and event publishing
- `modules/engine/detection.context.ts` scaffold
- `ALERT_ACKNOWLEDGED` and `ALERT_CLEARED` published via `alert.lifecycle.ts`
- Auto-clear in `alert.engine.ts` (scans active Redis keys and clears stale alerts)
- `cache/context.cache.ts` for operational context cache
- `context/weather.context.ts` — METAR/TAF fetch with Redis cache
- `context/aerodrome.context.ts` — runway / taxiway / apron / restricted area features
- `context/advisory.context.ts` — AFTN FPL and NOTAM fetch by destination / icaoLocation
- `detection.context.ts` now loads weather, aerodrome, AFTN, and NOTAM contexts
- Rules for runway, taxiway/apron, and area penetration fall back to aerodrome context
- **NOTAM integration** — advisory context, cache, consumer, and advisory-service `NOTAM_UPDATED` event publishing

## Still pending

### On hold (nanti dulu)
- **ASHTAM integration** — volcanic ash context dan optional `VOLCANIC_ASH` rule

*Catatan: item di atas bergantung pada `advisory-service`.*

### Aerodrome / weather / AFTN improvements
- Map AFTN route strings into expected polylines for the deviation rule
- Weather-based operational warnings (e.g., crosswind, low visibility)
- Use aerodrome `LineString` taxiway centerlines in addition to polygon surfaces

### Alert engine
- `ALERT_UPDATED` publishing when an active alert's data changes
- Configurable rule severity from `alert_rules.configuration` instead of hardcoded values

### API / lifecycle
- Route versioning (`/api/v1`) if not handled by gateway
- More complete lifecycle unit and integration tests (dedup, acknowledge, clear)

### Future / monitoring
- Real-time alert SSE / WebSocket
- Alert sound / alarm
- Historical playback, statistics, dan safety performance monitoring
