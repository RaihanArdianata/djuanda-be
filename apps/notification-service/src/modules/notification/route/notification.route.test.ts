import { beforeEach, describe, expect, it, mock } from "bun:test";

// @repo/database opens a Postgres pool on import -- mock it so no real
// connection to localhost:5432 is attempted (the service layer that consumes
// it is mocked below anyway).
mock.module("@repo/database", () => ({}));

// @repo/shared (via its barrel) constructs an ioredis client at module load.
// Replace it so no real connection to localhost:6379 is attempted.
import { FakeRedis } from "@repo/shared/testing/fakeRedis";

// Shared fake (packages/shared/src/testing/fakeRedis.ts) � mock.module is
// process-wide in bun test; all files must register the same fake.
mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

const createNotification = mock();
const getNotificationsForUser = mock();
const markNotificationAsRead = mock();

mock.module("../service/notification.service", () => ({
  createNotification,
  getNotificationsForUser,
  markNotificationAsRead,
}));

// Imported dynamically, after the mocks above are registered, so the route
// (via the controller) picks up the mocked service layer instead of the
// real one.
const { default: notificationRoute } = await import("./notification.route");

const userId = "3f8a5c1e-2b4d-4f6a-9c7e-1d2b3a4c5e6f";
const notificationId = "9b7c6d5e-4f3a-2b1c-8d7e-6f5a4b3c2d1e";

const sampleNotification = {
  id: notificationId,
  senderId: null,
  title: "Runway closed",
  message: "Runway 10/28 closed until 18:00 UTC",
  createdAt: "2026-07-08T05:00:00.000Z",
  isRead: false,
  readAt: null,
};

const validCreateBody = {
  title: "Runway closed",
  message: "Runway 10/28 closed until 18:00 UTC",
  recipientIds: [userId],
};

const jsonHeaders = { "Content-Type": "application/json" };

beforeEach(() => {
  createNotification.mockReset();
  getNotificationsForUser.mockReset();
  markNotificationAsRead.mockReset();
});

describe("POST /", () => {
  it("creates a notification and returns 201", async () => {
    createNotification.mockResolvedValue(sampleNotification);

    const res = await notificationRoute.request("/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(validCreateBody),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.title).toBe("Runway closed");
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientIds: [userId] }),
    );
  });

  it("returns 400 with a VALIDATION_ERROR when required fields are missing", async () => {
    const res = await notificationRoute.request("/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ title: "Runway closed" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.meta.status).toBe("ERROR");
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("returns 400 with a VALIDATION_ERROR when recipientIds is empty", async () => {
    const res = await notificationRoute.request("/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ ...validCreateBody, recipientIds: [] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe("GET /:userId", () => {
  it("returns the notifications for the given user", async () => {
    getNotificationsForUser.mockResolvedValue([sampleNotification]);

    const res = await notificationRoute.request(`/${userId}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(notificationId);
    expect(getNotificationsForUser).toHaveBeenCalledWith(userId);
  });

  it("returns an empty list when the user has no notifications", async () => {
    getNotificationsForUser.mockResolvedValue([]);

    const res = await notificationRoute.request(`/${userId}`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

describe("PATCH /:notificationId/read", () => {
  it("marks a notification as read and returns 200", async () => {
    markNotificationAsRead.mockResolvedValue({
      ...sampleNotification,
      isRead: true,
      readAt: "2026-07-08T06:00:00.000Z",
    });

    const res = await notificationRoute.request(`/${notificationId}/read`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ recipientId: userId }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.meta.status).toBe("SUCCESS");
    expect(body.data.isRead).toBe(true);
    expect(markNotificationAsRead).toHaveBeenCalledWith(notificationId, userId);
  });

  it("returns 400 with a VALIDATION_ERROR when recipientId is missing", async () => {
    const res = await notificationRoute.request(`/${notificationId}/read`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(markNotificationAsRead).not.toHaveBeenCalled();
  });

  it("returns 404 with a NOT_FOUND error when no recipient row matches", async () => {
    markNotificationAsRead.mockResolvedValue(null);

    const res = await notificationRoute.request(`/${notificationId}/read`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify({ recipientId: userId }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.data).toBeNull();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.meta.status).toBe("ERROR");
  });
});
