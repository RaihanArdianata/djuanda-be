import { catchAsync, success } from "@repo/shared";
import type { CreateUserParams, GetAllUsersParams, UpdateUserParams, UpdateUserPasswordParams } from "../validator/user.validator";
import { createUser, deleteUser, getAllUsers, getCountUsers, updateUser, updateUserPassword } from "../service/user.service";

export const getAll = catchAsync(async (c) => {
  const parsedData = c.get("parsedData") as GetAllUsersParams;

  const results = await getAllUsers(parsedData);
  const total = await getCountUsers(parsedData);
  const totalPages = Math.ceil(total / (parseInt(parsedData.size, 10) || 10));

  return success(
    c,
    results,
    {
      message: "Successfully retrieved all users",
    },
    {
      page: parseInt(parsedData.page, 10) || 1,
      size: parseInt(parsedData.size, 10) || 10,
      total,
      totalPages,
    }
  );
});

export const create = catchAsync(async (c) => {
  const parsedData = c.get("parsedData") as CreateUserParams;

  const results = await createUser(parsedData);

  return success(c, results, {
    code: 201,
    message: "User successfully created",
  });
});

export const update = catchAsync(async (c) => {
  const { id } = c.req.param();
  const parsedData = c.get("parsedData") as UpdateUserParams;

  const results = await updateUser(id, parsedData);

  return success(c, results, {
    message: "User successfully updated",
  });
});

export const updatePassword = catchAsync(async (c) => {
  const { id } = c.req.param();
  const parsedData = c.get("parsedData") as UpdateUserPasswordParams;

  await updateUserPassword(id, parsedData.password);

  return success(c, null, {
    message: "User password successfully updated",
  });
});

export const remove = catchAsync(async (c) => {
  const { id } = c.req.param();

  await deleteUser(id);

  return success(c, null, {
    message: "User successfully deleted",
  });
});
