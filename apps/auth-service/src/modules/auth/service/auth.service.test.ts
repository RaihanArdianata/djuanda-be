import { describe, expect, test } from "bun:test";
import { allowsConcurrentSessions } from "./auth.service";

describe("allowsConcurrentSessions", () => {
  test("guest may have several sessions by default, whatever the case", () => {
    expect(allowsConcurrentSessions("guest", {})).toBe(true);
    expect(allowsConcurrentSessions("Guest", {})).toBe(true);
    expect(allowsConcurrentSessions(" GUEST ", {})).toBe(true);
  });

  test("other roles keep a single session", () => {
    expect(allowsConcurrentSessions("Admin", {})).toBe(false);
    expect(allowsConcurrentSessions("", {})).toBe(false);
    expect(allowsConcurrentSessions(null, {})).toBe(false);
    expect(allowsConcurrentSessions(undefined, {})).toBe(false);
  });

  test("the role list comes from CONCURRENT_SESSION_ROLES", () => {
    const env = {
      CONCURRENT_SESSION_ROLES: "guest, Viewer",
    } as NodeJS.ProcessEnv;
    expect(allowsConcurrentSessions("viewer", env)).toBe(true);
    expect(allowsConcurrentSessions("guest", env)).toBe(true);
    expect(allowsConcurrentSessions("Admin", env)).toBe(false);
  });

  test("an empty list switches the exception off", () => {
    expect(
      allowsConcurrentSessions("guest", { CONCURRENT_SESSION_ROLES: "" }),
    ).toBe(false);
  });
});
