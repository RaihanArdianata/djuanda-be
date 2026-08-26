import { fetchNotamHistories } from "../../client/navsim.client";

const NOTAM_HISTORY_SIZE = 2000;

export async function getNotamHistories(): Promise<unknown> {
  return fetchNotamHistories(NOTAM_HISTORY_SIZE);
}
