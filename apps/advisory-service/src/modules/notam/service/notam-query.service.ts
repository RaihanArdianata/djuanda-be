import type { NotamMessage } from "@repo/database";
import { listNotamMessages } from "../repository/notam-query.repository";
import type { ListNotamQueryInput } from "../validator/notam.validator";

export interface ListNotamResponse {
  items: NotamMessage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const getNotamMessages = async (
  params: ListNotamQueryInput,
): Promise<ListNotamResponse> => {
  const { items, total } = await listNotamMessages(params);

  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
    totalPages: total === 0 ? 0 : Math.ceil(total / params.limit),
  };
};
