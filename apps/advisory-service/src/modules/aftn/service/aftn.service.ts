import type { AftnMessage } from "@repo/database";
import ApiError from "@repo/shared/api-error";
import {
  type AftnAircraftDetail,
  buildAftnAircraftDetail,
} from "../lib/aircraft-detail";
import {
  findAftnMessageById,
  findRecentAftnMessagesByAircraft,
  listAftnMessages,
} from "../repository/aftn.repository";
import type {
  LatestAftnQueryInput,
  ListAftnQueryInput,
} from "../validator/aftn.validator";

export interface ListAftnResponse {
  items: AftnMessage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getAftnMessages = async (
  params: ListAftnQueryInput,
): Promise<ListAftnResponse> => {
  const { items, total } = await listAftnMessages(params);

  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.limit),
  };
};

export const getAftnMessageById = async (id: string): Promise<AftnMessage> => {
  const message = await findAftnMessageById(id);

  if (!message) {
    throw new ApiError("NOT_FOUND", { message: "AFTN message not found" });
  }

  return message;
};

export const getLatestAftnAircraftDetail = async (
  params: LatestAftnQueryInput,
): Promise<AftnAircraftDetail> => {
  // Callsign dulu, registration sebagai cadangan.
  let rows = params.callSign
    ? await findRecentAftnMessagesByAircraft("callSign", params.callSign)
    : [];

  if (rows.length === 0 && params.registration) {
    rows = await findRecentAftnMessagesByAircraft(
      "registration",
      params.registration,
    );
  }

  const detail = buildAftnAircraftDetail(rows);

  if (!detail) {
    throw new ApiError("NOT_FOUND", {
      message: "No AFTN message found for this aircraft",
    });
  }

  return detail;
};
