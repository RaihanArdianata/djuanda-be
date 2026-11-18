import { describe, expect, it } from "bun:test";
import { describeDevice, sessionTerminatedOverrides } from "./session-message";

const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/130.0.0.0`;
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

describe("describeDevice", () => {
  it("names browser and system", () => {
    expect(describeDevice(CHROME_WIN)).toBe("Chrome di Windows");
    expect(describeDevice(EDGE_WIN)).toBe("Edge di Windows");
    expect(describeDevice(SAFARI_IPHONE)).toBe("Safari di iOS");
    expect(describeDevice(CHROME_ANDROID)).toBe("Chrome di Android");
    expect(describeDevice("curl/8.5.0")).toBe("curl");
  });

  it("copes with a missing or unknown User-Agent", () => {
    expect(describeDevice(null)).toBe("perangkat tidak dikenal");
    expect(describeDevice("")).toBe("perangkat tidak dikenal");
    expect(describeDevice("custom-client/1.0")).toBe("custom-client/1.0");
  });
});

describe("sessionTerminatedOverrides", () => {
  const other = {
    deviceInfo: CHROME_WIN,
    ipAddress: "192.168.50.10",
    createdAt: new Date("2026-11-19T07:30:00Z"),
  };

  it("names the device, address and time that took over", () => {
    const out = sessionTerminatedOverrides(other, SAFARI_IPHONE);
    expect(out?.message).toContain("perangkat lain");
    expect(out?.message).toContain("Chrome di Windows, 192.168.50.10");
    expect(out?.message).toContain("WIB");
    expect(out?.details).toMatchObject({
      replacedBy: { device: "Chrome di Windows", ipAddress: "192.168.50.10" },
    });
  });

  it("says nothing when the replacing session looks like this very device", () => {
    expect(sessionTerminatedOverrides(other, CHROME_WIN)).toBeUndefined();
  });

  it("falls back to the plain message when no replacing session is known", () => {
    expect(sessionTerminatedOverrides(null, CHROME_WIN)).toBeUndefined();
  });

  it("works without an address or a time", () => {
    const out = sessionTerminatedOverrides(
      { deviceInfo: CHROME_WIN, ipAddress: null, createdAt: null },
      SAFARI_IPHONE,
    );
    expect(out?.message).toContain("(Chrome di Windows)");
    expect(out?.message).not.toContain("sejak");
  });
});
