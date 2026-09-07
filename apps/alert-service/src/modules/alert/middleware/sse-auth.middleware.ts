import { getUserById, validateAccessToken, verifyToken } from "@repo/auth";
import ApiError from "@repo/shared/api-error";
import { catchAsync } from "@repo/shared/catch-async";
import type { JWTPayload } from "hono/utils/jwt/types";

export const sseAuthentication = catchAsync(async (c, next) => {
  const queryToken = c.req.query("token");
  const headerToken = c.req.header("Authorization")?.replace("Bearer ", "");
  const token = queryToken || headerToken;

  if (!token) {
    throw new ApiError("UNAUTHORIZED");
  }

  let payload: JWTPayload;
  try {
    payload = await verifyToken(token);
  } catch {
    throw new ApiError("UNAUTHORIZED");
  }

  const id = payload.id as string;
  const user = await getUserById(id);

  if (!user) {
    throw new ApiError("UNAUTHORIZED");
  }

  if (user.status !== "ACTIVE") {
    throw new ApiError("UNAUTHORIZED", {
      message: "Account is inactive or has been deleted.",
    });
  }

  const { isExpired, isValid } = await validateAccessToken(id, token);

  if (isExpired) {
    throw new ApiError("INVALID_ACCESS_TOKEN");
  }

  if (!isValid) {
    throw new ApiError("SESSION_TERMINATED");
  }

  c.set("jwtPayload", payload);
  c.set("user", user);

  return next();
});
