import { beforeEach, describe, expect, it, mock } from "bun:test";
import { FakeRedis } from "@repo/shared/testing/fakeRedis";

const passthroughMiddleware = async (
  c: { set: (k: string, v: unknown) => void },
  next: () => Promise<void>,
): Promise<void> => {
  c.set("user", {
    id: "user-123",
    name: "Operator Tower",
    username: "optower",
  });
  await next();
};

mock.module("ioredis", () => ({
  Redis: FakeRedis,
  default: FakeRedis,
}));

class FakeKafka {
  producer() {
    return {
      connect: mock(),
      send: mock(),
      disconnect: mock(),
    };
  }
  consumer() {
    return {
      connect: mock(),
      subscribe: mock(),
      run: mock(),
      on: mock(),
      disconnect: mock(),
    };
  }
}

mock.module("kafkajs", () => ({
  Kafka: FakeKafka,
}));

const mockFindAlertById = mock();
const mockClearAlert = mock();
const mockVerifyAlert = mock();
const mockSoftDeleteAlert = mock();
const mockRecordAlertAction = mock();
const mockGetAlertActions = mock();
const mockMergeAlertData = mock();
const mockListAlerts = mock();

const realRepo = await import("../repository/alert.repository");
mock.module("../repository/alert.repository", () => ({
  ...realRepo,
  findAlertById: mockFindAlertById,
  clearAlert: mockClearAlert,
  verifyAlert: mockVerifyAlert,
  softDeleteAlert: mockSoftDeleteAlert,
  recordAlertAction: mockRecordAlertAction,
  getAlertActions: mockGetAlertActions,
  mergeAlertData: mockMergeAlertData,
  listAlerts: mockListAlerts,
}));

const authModule = await import("@repo/auth");
mock.module("@repo/auth", () => ({
  ...authModule,
  authentication: passthroughMiddleware,
  rbacMiddleware: passthroughMiddleware,
}));

const { default: alertRoute } = await import("./alert.route");

beforeEach(() => {
  mockFindAlertById.mockReset();
  mockClearAlert.mockReset();
  mockVerifyAlert.mockReset();
  mockSoftDeleteAlert.mockReset();
  mockRecordAlertAction.mockReset();
  mockGetAlertActions.mockReset();
  mockMergeAlertData.mockReset();
  mockListAlerts.mockReset();
});

describe("Alert Management Routes", () => {
  const sampleAlert = {
    id: "a1111111-1111-1111-1111-111111111111",
    alertId: "alert_001",
    airportId: "WARR",
    type: "RUNWAY_INCURSION",
    severity: "CRITICAL",
    status: "ACTIVE",
    verificationStatus: "UNVERIFIED",
    trackId: "track_1",
    triggeredAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  describe("POST /:id/clear", () => {
    it("should clear an active alert successfully with reason", async () => {
      mockFindAlertById.mockResolvedValue(sampleAlert);
      mockClearAlert.mockResolvedValue({
        ...sampleAlert,
        status: "CLEARED",
        clearedAt: new Date(),
        clearedBy: "Operator Tower",
        clearReason: "Resolved by tower",
      });
      mockRecordAlertAction.mockResolvedValue({});

      const res = await alertRoute.request(`/${sampleAlert.id}/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Resolved by tower" }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.meta.status).toBe("SUCCESS");
      expect(json.data.status).toBe("CLEARED");
      expect(mockRecordAlertAction).toHaveBeenCalled();
    });

    it("should reject clearing an already cleared alert with 400 BAD_REQUEST", async () => {
      mockFindAlertById.mockResolvedValue({
        ...sampleAlert,
        status: "CLEARED",
      });

      const res = await alertRoute.request(`/${sampleAlert.id}/clear`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Try again" }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.meta.status).toBe("ERROR");
      expect(json.error.message).toBe("Alert is already cleared");
    });

    it("should return 404 when alert not found", async () => {
      mockFindAlertById.mockResolvedValue(undefined);

      const res = await alertRoute.request("/non-existent-id/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Clear" }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });
  });

  describe("POST /clear-bulk", () => {
    it("should bulk clear alerts with partial success results", async () => {
      const alert1 = { ...sampleAlert, id: "id-1", alertId: "alt-1" };
      const alert2 = {
        ...sampleAlert,
        id: "id-2",
        alertId: "alt-2",
        status: "CLEARED",
      };

      mockFindAlertById.mockImplementation(async (id: string) => {
        if (id === "id-1") return alert1;
        if (id === "id-2") return alert2;
        return undefined;
      });

      mockClearAlert.mockResolvedValue({ ...alert1, status: "CLEARED" });
      mockRecordAlertAction.mockResolvedValue({});

      const res = await alertRoute.request("/clear-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertIds: ["id-1", "id-2", "id-3"],
          reason: "Routine bulk clear",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(3);
      expect(json.data.successCount).toBe(1);
      expect(json.data.failureCount).toBe(2);
      expect(json.data.succeeded).toEqual(["id-1"]);
      expect(json.data.failed).toEqual([
        { id: "id-2", reason: "Alert is already cleared" },
        { id: "id-3", reason: "Alert not found" },
      ]);
    });

    it("should return 400 when alertIds is empty", async () => {
      const res = await alertRoute.request("/clear-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertIds: [] }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /:id/verify", () => {
    it("should verify alert with status and note", async () => {
      mockFindAlertById.mockResolvedValue(sampleAlert);
      mockVerifyAlert.mockResolvedValue({
        ...sampleAlert,
        verificationStatus: "VERIFIED",
        verifiedAt: new Date(),
        verifiedBy: "Operator Tower",
        verificationNote: "Confirmed visual target",
      });
      mockRecordAlertAction.mockResolvedValue({});

      const res = await alertRoute.request(`/${sampleAlert.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "VERIFIED",
          note: "Confirmed visual target",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.verificationStatus).toBe("VERIFIED");
      expect(mockRecordAlertAction).toHaveBeenCalled();
    });

    it("should reject invalid verification status", async () => {
      const res = await alertRoute.request(`/${sampleAlert.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "INVALID_STATUS",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /:id/actions", () => {
    it("should return audit actions for an alert", async () => {
      mockFindAlertById.mockResolvedValue(sampleAlert);
      mockGetAlertActions.mockResolvedValue([
        {
          id: "act-1",
          alertId: sampleAlert.alertId,
          action: "CLEAR",
          actorName: "Operator Tower",
          createdAt: new Date(),
        },
      ]);

      const res = await alertRoute.request(`/${sampleAlert.id}/actions`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].action).toBe("CLEAR");
    });

    it("should return 404 when alert not found", async () => {
      mockFindAlertById.mockResolvedValue(undefined);

      const res = await alertRoute.request("/unknown-id/actions");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /:id", () => {
    it("should soft delete an alert successfully", async () => {
      mockFindAlertById.mockResolvedValue(sampleAlert);
      mockSoftDeleteAlert.mockResolvedValue({
        ...sampleAlert,
        deletedAt: new Date(),
      });
      mockRecordAlertAction.mockResolvedValue({});

      const res = await alertRoute.request(`/${sampleAlert.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Spurious alert cleanup" }),
      });

      expect(res.status).toBe(200);
      expect(mockSoftDeleteAlert).toHaveBeenCalledWith(sampleAlert.id);
      expect(mockRecordAlertAction).toHaveBeenCalled();
    });

    it("should return 404 when alert to delete is not found", async () => {
      mockFindAlertById.mockResolvedValue(undefined);

      const res = await alertRoute.request("/unknown-id", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });
});
