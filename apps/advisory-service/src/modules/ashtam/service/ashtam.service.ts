import { fetchAshtamHistories } from "../../client/navsim.client";

const DEFAULT_ASHTAM_HISTORY_SIZE = 2000;

export interface GetAshtamHistoriesOptions {
  size?: number;
  startDateTimeLessThan?: string;
}

export async function getAshtamHistories(
  options: GetAshtamHistoriesOptions = {},
): Promise<unknown> {
  return fetchAshtamHistories({
    size: options.size ?? DEFAULT_ASHTAM_HISTORY_SIZE,
    startDateTimeLessThan: options.startDateTimeLessThan,
  });
}
