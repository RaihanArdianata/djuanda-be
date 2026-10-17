import type { AftnMessage } from "@repo/database";
import ApiError from "@repo/shared/api-error";
import {
  findAftnMessageById,
  listAftnMessages,
} from "../repository/aftn.repository";
import type { ListAftnQueryInput } from "../validator/aftn.validator";

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
