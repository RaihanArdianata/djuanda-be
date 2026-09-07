import { beforeEach, describe, expect, it, mock } from "bun:test";

// Auth is a cross-cutting concern owned by auth-service (JWT + DB lookup) --
// stub it out with a pass-through so these tests exercise user-service's
// own routing/validation/response logic in isolation, without a real DB.
const passthroughMiddleware = async (
  _c: unknown,
  next: () => Promise<void>,
): Promise<void> => {
  await next();
};

// @repo/database opens a Postgres pool on import. The route only needs
// userStatusEnum (for the status filter union in the validator); every other
// export is irrelevant here because the service layer is mocked below.
mock.module("@repo/database", () => ({
  userStatusEnum: { enumValues: ["ACTIVE", "INACTIVE", "DELETED"] },
}));

// @repo/shared (via its barrel) constructs an ioredis client at module load.
// Replace it so no real connection to localhost:6379 is attempted.
import { FakeRedis } from "@repo/shared/testing/fakeRedis";

// Shared fake (packages/shared/src/testing/fakeRedis.ts) � mock.module is
// process-wide in bun test; all files must register the same fake.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

const authModule = await import("@repo/auth");

// Preserve real auth package exports; only override middleware so routes can be
// tested without a real database/user. Without the spread, other test files that
// import named helpers like `generateRefreshToken` from `@repo/auth` break because
// `mock.module` is process-global in bun:test.
mock.module("@repo/auth", () => ({
  ...authModule,
  authentication: passthroughMiddleware,
  rbacMiddleware: passthroughMiddleware,
}));

const getAllUsers = mock();
const getCountUsers = mock();
const createUser = mock();
const updateUser = mock();
const updateUserPassword = mock();
const deleteUser = mock();

mock.module("../service/user.service", () => ({
  getAllUsers,
  getCountUsers,
  createUser,
  updateUser,
  updateUserPassword,
  deleteUser,
}));

// ApiError must come from the real @repo/shared/api-error so `instanceof ApiError`
// inside catchAsync still holds for errors thrown by the mocked service.
const { default: ApiError } = await import("@repo/shared/api-error");

// Imported dynamically, after the mocks above are registered, so the route
// (via the controller) picks up the mocked auth middleware and service layer
// instead of the real ones.
const { default: userRoute } = await import("./user.route");

const sampleUser = {
  id: "3f8a5c1e-2b4d-4f6a-9c7e-1d2b3a4c5e6f",
  name: "John Doe",
  email: "john@example.com",
  phone: "628123456789",
  username: "johndoe",
  status: "ACTIVE",
  createdAt: "2026-07-08T05:00:00.000Z",
  role: { id: 1, name: "ADMIN" },
  permissions: ["users:read"],
};

const validCreateBody = {
  name: "John Doe",
  username: "johndoe",
  email: "john@example.com",
  phone: "08123456789",
  password: "Passw0rd!",
  role: 1,
};

const jsonHeaders = { "Content-Type": "application/json" };

beforeEach(() => {
  getAllUsers.mockReset();
  getCountUsers.mockReset();
  createUser.mockReset();
  updateUser.mockReset();
  updateUserPassword.mockReset();
  deleteUser.mockReset();
});

describe("GET /", () => {
  it("returns a paginated list of users wrapped in the ApiResponse envelope", async () => {
    getAllUsers.mockResolvedValue([sampleUser]);
    getCountUsers.mockResolvedValue(25);

    const res = await userRoute.request("/?page=2&size=10");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].username).toBe("johndoe");
    expect(body.meta.pagination).toEqual({
      page: 2,
      size: 10,
      total: 25,
      totalPages: 3,
    });
  });

  it("defaults page/size when they're omitted", async () => {
    getAllUsers.mockResolvedValue([]);
    getCountUsers.mockResolvedValue(0);

    await userRoute.request("/");

    expect(getAllUsers).toHaveBeenCalledWith(
      expect.objectContaining({ page: "1", size: "10" }),
    );
  });

  it("forwards the search filter to the service", async () => {
    getAllUsers.mockResolvedValue([sampleUser]);
    getCountUsers.mockResolvedValue(1);

    await userRoute.request("/?search=john");

    expect(getAllUsers).toHaveBeenCalledWith(
      expect.objectContaining({ search: "john" }),
    );
  });

  it("returns 400 with a VALIDATION_ERROR for an unknown status filter", async () => {
    const res = await userRoute.request("/?status=BOGUS");
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.meta.status).toBe("ERROR");
  });
});

describe("POST /", () => {
  it("creates a user and returns 201", async () => {
    createUser.mockResolvedValue(sampleUser);

    const res = await userRoute.request("/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(validCreateBody),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.username).toBe("johndoe");
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "john@example.com", role: 1 }),
    );
  });

  it("returns 400 with a VALIDATION_ERROR when required fields are missing", async () => {
    const res = await userRoute.request("/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "John Doe" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields).toBeDefined();
    expect(createUser).not.toHaveBeenCalled();
  });

  it("returns 400 with a VALIDATION_ERROR when the password is too weak", async () => {
    const res = await userRoute.request("/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ...validCreateBody, password: "weak" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createUser).not.toHaveBeenCalled();
  });

  it("propagates a BAD_REQUEST error when the email or username already exists", async () => {
    createUser.mockRejectedValue(
      new ApiError("BAD_REQUEST", {
        message: "User with the same email or username already exists.",
      }),
    );

    const res = await userRoute.request("/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(validCreateBody),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("BAD_REQUEST");
  });
});

describe("PATCH /:id", () => {
  it("updates a user and returns 200", async () => {
    updateUser.mockResolvedValue({ ...sampleUser, name: "Jane Doe" });

    const res = await userRoute.request(`/${sampleUser.id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "Jane Doe" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("Jane Doe");
    expect(updateUser).toHaveBeenCalledWith(
      sampleUser.id,
      expect.objectContaining({ name: "Jane Doe" }),
    );
  });

  it("returns 404 with a NOT_FOUND error when the user does not exist", async () => {
    updateUser.mockRejectedValue(
      new ApiError("NOT_FOUND", { message: "User not found" }),
    );

    const res = await userRoute.request(`/${sampleUser.id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "Jane Doe" }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.meta.status).toBe("ERROR");
  });

  it("returns 400 with a VALIDATION_ERROR for an invalid status value", async () => {
    const res = await userRoute.request(`/${sampleUser.id}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ status: "BOGUS" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe("PUT /:id/update-password", () => {
  it("updates the password and returns 200", async () => {
    updateUserPassword.mockResolvedValue(undefined);

    const res = await userRoute.request(`/${sampleUser.id}/update-password`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ password: "NewPass1!" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(updateUserPassword).toHaveBeenCalledWith(sampleUser.id, "NewPass1!");
  });

  it("returns 400 with a VALIDATION_ERROR when the password is missing", async () => {
    const res = await userRoute.request(`/${sampleUser.id}/update-password`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(updateUserPassword).not.toHaveBeenCalled();
  });
});

describe("DELETE /:id", () => {
  it("soft-deletes a user and returns 200", async () => {
    deleteUser.mockResolvedValue(undefined);

    const res = await userRoute.request(`/${sampleUser.id}`, {
      method: "DELETE",
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(deleteUser).toHaveBeenCalledWith(sampleUser.id);
  });

  it("returns 404 with a NOT_FOUND error when the user does not exist", async () => {
    deleteUser.mockRejectedValue(
      new ApiError("NOT_FOUND", { message: "User not found" }),
    );

    const res = await userRoute.request(`/${sampleUser.id}`, {
      method: "DELETE",
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
