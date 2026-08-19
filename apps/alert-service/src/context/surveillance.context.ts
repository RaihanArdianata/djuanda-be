import { getAllTrackStates, saveTrackState } from "../cache/track-state.cache";
import type { MovementTrack } from "../modules/engine/types";

export async function trackUpdated(track: MovementTrack): Promise<void> {
  await saveTrackState(track);
}

export async function getAirportTracks(
  airportId: string,
): Promise<MovementTrack[]> {
  return getAllTrackStates(airportId);
}
