import { beforeAll, describe, expect, it } from "bun:test";
import {
  decodeToken,
  generateRefreshToken,
  generateToken,
  verifyToken,
} from "./jwt";

describe("jwt utilities", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret";
  });

  it("generates and verifies an access token", async () => {
    const payload = { id: "u1", email: "u@example.com", role: "USER" };
    const token = await generateToken(payload);
    const decoded = await verifyToken(token);

    expect(decoded.id).toBe("u1");
    expect(decoded.email).toBe("u@example.com");
    expect(decoded.role).toBe("USER");
    expect(decoded.type).toBe("access");
  });

  it("generates a refresh token with a 7-day expiration", async () => {
    const payload = { id: "u1", email: "u@example.com", role: "USER" };
    const { token, tmpExp } = await generateRefreshToken(payload);
    const decoded = await verifyToken(token);

    expect(decoded.id).toBe("u1");
    expect(decoded.type).toBe("refresh");
    expect(tmpExp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("decodes a token without verification", async () => {
    const payload = { id: "u1", email: "u@example.com", role: "USER" };
    const token = await generateToken(payload);
    // hono/jwt `decode` returns { header, payload } — the claims live on .payload
    const decoded = decodeToken(token) as unknown as {
      payload: { id: string; email: string };
    };

    expect(decoded.payload.id).toBe("u1");
    expect(decoded.payload.email).toBe("u@example.com");
  });

  it("rejects an invalid token", async () => {
    await expect(verifyToken("not-a-valid-jwt")).rejects.toThrow();
  });
});
