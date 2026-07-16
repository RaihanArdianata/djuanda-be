import { logger } from "@repo/logger";
import { ApiError, catchAsync } from "@repo/shared";
import { jwt } from "hono/jwt";
import { getUserById, isAccessTokenValid } from "@/modules/auth/service/auth.service";

export const authentication = catchAsync(async (c, next) => {
  const jwtMiddleware = jwt({
    secret: process.env.JWT_SECRET as string,
    alg: "HS256",
    headerName: "Authorization",
  });

  await jwtMiddleware(c, async () => {
    const { id } = c.get("jwtPayload") as { id: string };
    const findUser = await getUserById(id);

    if (!findUser) {
      throw new ApiError("FORBIDDEN");
    }

    const isTokenValid = await isAccessTokenValid(id, c.req.header("Authorization")?.replace("Bearer ", "") || "");

    if (!isTokenValid) {
      throw new ApiError("FORBIDDEN", {
        message: "Access token is invalid or has been revoked.",
      });
    }

    c.set("user", findUser);

    return await next();
  });
});

export const authenticationStoreOwner = catchAsync(async (_c, next) => {
  // const { id } = c.get("jwtPayload") as { id: string }; // temporarily disabled
  return await next();
});

export const authenticationUser = catchAsync(async (c, next) => {
  const { id } = c.get("jwtPayload") as { id: string };
  const findUser = await getUserById(id);

  if (findUser && findUser.role?.name === "Admin") {
    return await next();
  } else {
    throw new ApiError("FORBIDDEN");
  }
});

export const rbacMiddleware = catchAsync(async (c, next) => {
  const { id } = c.get("jwtPayload") as { id: string };
  const findUser = await getUserById(id);

  if (!findUser) {
    throw new ApiError("FORBIDDEN");
  }

  const { path, method } = c.req;

  const permissions = findUser.role?.rolePermissions.map((rp) => rp.permission.code) || [];

  const hasPermission = permissions.some((permission) => {
    const [permPath, permMethod] = permission.split(".");
    if (!permPath || !permMethod) {
      logger.warn(`Invalid permission format: ${permission}`);
      throw new ApiError("FORBIDDEN", {
        message: 'Invalid permission format, example: "USERS.VIEW"',
      });
    }
    const isPathMatch = path.startsWith(`/${permPath.toLocaleLowerCase()}`);

    logger.debug(
      `Checking permission: ${permission} against request path: ${path} and method: ${method}: path match: ${isPathMatch}, method match: ${translateMethodName(method) === permMethod.toLocaleLowerCase()}`
    );

    return isPathMatch && translateMethodName(method) === permMethod.toLocaleLowerCase();
  });

  if (!hasPermission) {
    throw new ApiError("FORBIDDEN");
  }

  return await next();
});

const translateMethodName = (method: string): string => {
  switch (method.toLocaleLowerCase()) {
    case "get":
      return "view";
    case "post":
      return "create";
    case "put":
    case "patch":
      return "edit";
    case "delete":
      return "delete";
    default:
      return method.toLowerCase();
  }
};
