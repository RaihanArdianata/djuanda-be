import { z } from "zod";

export const createSessionSchema = z.object({
  airportId: z.string().min(1),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  speed: z.number().positive().default(1),
});

export type CreateSessionRequest = z.infer<typeof createSessionSchema>;

export const playbackControlActionSchema = z.enum([
  "play",
  "pause",
  "stop",
  "seek",
  "set_speed",
]);

export const controlSchema = z.object({
  action: playbackControlActionSchema,
  value: z.number().optional(),
});

export type PlaybackControlRequest = z.infer<typeof controlSchema>;

export const playbackStatusSchema = z.enum([
  "created",
  "playing",
  "paused",
  "finished",
  "stopped",
]);

export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;

export const timelineEventTypeSchema = z.enum([
  "aircraft_track",
  "aircraft_movement",
  "weather_metar",
  "weather_taf",
  "notam",
  "ashtam",
  "aerodrome",
]);

export type TimelineEventType = z.infer<typeof timelineEventTypeSchema>;

export const timelineEventSchema = z.object({
  type: timelineEventTypeSchema,
  ts: z.number(), // epoch ms, used to drive playback ordering
  timestamp: z.string(), // ISO string, for the wire payload
  data: z.unknown(),
});

export type TimelineEvent = z.infer<typeof timelineEventSchema>;

export const playbackSessionRecordSchema = z.object({
  id: z.string(),
  airportId: z.string(),
  from: z.string(), // ISO
  to: z.string(), // ISO
  speed: z.number(),
  status: playbackStatusSchema,
  cursor: z.number(), // epoch ms, current playhead position
  createdAt: z.string(),
});

export type PlaybackSessionRecord = z.infer<typeof playbackSessionRecordSchema>;
