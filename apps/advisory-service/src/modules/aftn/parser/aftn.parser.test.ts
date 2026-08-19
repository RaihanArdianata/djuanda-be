import { describe, expect, it } from "bun:test";
import type { AftnProviderItem } from "../../provider/aftn.provider";
import {
  detectMessageType,
  isSupportedMessageType,
  parseAftnMessage,
  SUPPORTED_MESSAGE_TYPES,
} from "./aftn.parser";

const FPL_RAW =
  "(FPL-AXM5868-IS-A320/M-SDE3FGHIJ1RWY/LB1-WMKK0930-N0450F330 " +
  "PIBOS DCT VMR-WBGS0146 WBGG-PBN/A1B1C1D1O1S2 NAV/RNVD1E2A1 " +
  "DOF/260530 REG/9MRAN EET/WBFC0100 SEL/GPKR CODE/750248 OPR/AXM " +
  "RMK/TCAS EQUIPPED)";

const fplItem = (): AftnProviderItem => ({
  datetime: "2026-05-30 23:58:22",

  message_type: "FPL",

  call_sign: "AXM5868",
  registration: "9MRAN",

  aircraft_type: "A320",
  departure: "WMKK",

  departure_time: "0930",
  destination: "WBGS",

  destination_time: "",
  duration: "0146",
  speed: "N045",
  altitude: "F330",
  route: "PIBOS DCT VMR",
  raw: FPL_RAW,
});

describe("detectMessageType", () => {
  it("uses the provider message_type field", () => {
    expect(detectMessageType(fplItem())).toBe("FPL");
  });

  it("normalises casing", () => {
    expect(detectMessageType({ message_type: "dep" })).toBe("DEP");
  });

  it("falls back to the first field of the raw message", () => {
    expect(
      detectMessageType({
        message_type: "",
        raw: "(ARR-SJV604-WIII2200-WALL2358)",
      }),
    ).toBe("ARR");
  });

  it("returns null when the type cannot be resolved", () => {
    expect(detectMessageType({ raw: "no type here" })).toBeNull();
  });

  it("knows which types have a dedicated parser", () => {
    expect(SUPPORTED_MESSAGE_TYPES.sort()).toEqual([
      "ARR",
      "CHG",
      "DEP",
      "DLA",
      "FPL",
    ]);
    expect(isSupportedMessageType("FPL")).toBe(true);
    expect(isSupportedMessageType("RQP")).toBe(false);
  });
});

describe("parseAftnMessage — validation", () => {
  it("rejects a message without a resolvable type", () => {
    const result = parseAftnMessage({
      datetime: "2026-05-30 23:58:22",
      raw: "garbage",
    });

    expect(result.ok).toBe(false);
  });

  it("rejects a message with an invalid datetime", () => {
    const item = { ...fplItem(), datetime: "not-a-date" };
    const result = parseAftnMessage(item);

    expect(result.ok).toBe(false);
  });

  it("rejects a message without raw", () => {
    const item = { ...fplItem(), raw: "" };
    const result = parseAftnMessage(item);

    expect(result.ok).toBe(false);
  });

  it("stores unknown message types using common fields only", () => {
    const result = parseAftnMessage({
      datetime: "2026-05-30 23:58:22",

      message_type: "RQP",

      call_sign: "GIA300",
      raw: "(RQP-GIA300)",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.parserSupported).toBe(false);
    expect(result.message.messageType).toBe("RQP");
    expect(result.message.callSign).toBe("GIA300");
  });

  it("parses the provider datetime as UTC", () => {
    const result = parseAftnMessage(fplItem());

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.message.datetime.toISOString()).toBe(
      "2026-05-30T23:58:22.000Z",
    );
  });
});

describe("parseAftnMessage — FPL", () => {
  it("normalises every common field", () => {
    const result = parseAftnMessage(fplItem());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { message } = result;
    expect(message.messageType).toBe("FPL");
    expect(message.callSign).toBe("AXM5868");
    expect(message.registration).toBe("9MRAN");
    expect(message.aircraftType).toBe("A320");
    expect(message.departure).toBe("WMKK");
    expect(message.departureTime).toBe("0930");
    expect(message.destination).toBe("WBGS");
    expect(message.duration).toBe("0146");
    expect(message.speed).toBe("N045");
    expect(message.altitude).toBe("F330");
    expect(message.route).toBe("PIBOS DCT VMR");
    expect(message.raw).toBe(FPL_RAW);
  });

  it("maps an empty provider field to null instead of an empty string", () => {
    const result = parseAftnMessage(fplItem());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.message.destinationTime).toBeNull();
  });

  it("keeps field-18 information that has no dedicated column", () => {
    const result = parseAftnMessage(fplItem());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.message.parsed).toMatchObject({
      pbn: "A1B1C1D1O1S2",
      nav: "RNVD1E2A1",
      dof: "260530",
      registration: "9MRAN",
      selcal: "GPKR",
      code: "750248",
      operator: "AXM",
      remark: "TCAS EQUIPPED",
    });
  });

  it("recovers registration from raw REG/ when the provider omits it", () => {
    const result = parseAftnMessage({ ...fplItem(), registration: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.message.registration).toBe("9MRAN");
  });
});

describe("parseAftnMessage — DEP", () => {
  const depItem: AftnProviderItem = {
    datetime: "2026-05-30 23:57:10",

    message_type: "DEP",

    call_sign: "BTK6201",
    departure: "WAGG",

    departure_time: "2357",
    destination: "WIII",
    registration: "",

    aircraft_type: "",
    raw: "(DEP-BTK6201/A5621-WAGG2357-WIII-DOF/260530 REG/PKLUZ)",
  };

  it("parses the common flight information", () => {
    const result = parseAftnMessage(depItem);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { message } = result;
    expect(message.messageType).toBe("DEP");
    expect(message.callSign).toBe("BTK6201");
    expect(message.departure).toBe("WAGG");
    expect(message.departureTime).toBe("2357");
    expect(message.destination).toBe("WIII");
  });

  it("does not fail on the fields a DEP message never carries", () => {
    const result = parseAftnMessage(depItem);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { message } = result;
    expect(message.speed).toBeNull();
    expect(message.altitude).toBeNull();
    expect(message.route).toBeNull();
    expect(message.duration).toBeNull();
    expect(message.aircraftType).toBeNull();
  });

  it("keeps aircraft reference details available through raw extraction", () => {
    const result = parseAftnMessage(depItem);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.message.parsed).toMatchObject({ dof: "260530" });
    expect(result.message.registration).toBe("PKLUZ");
  });
});

describe("parseAftnMessage — ARR", () => {
  it("parses departure and arrival times", () => {
    const result = parseAftnMessage({
      datetime: "2026-05-30 23:58:40",

      message_type: "ARR",

      call_sign: "SJV604",
      departure: "WIII",

      departure_time: "2200",
      destination: "WALL",

      destination_time: "2358",
      raw: "(ARR-SJV604-WIII2200-WALL2358)",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { message } = result;
    expect(message.messageType).toBe("ARR");
    expect(message.departure).toBe("WIII");
    expect(message.departureTime).toBe("2200");
    expect(message.destination).toBe("WALL");
    expect(message.destinationTime).toBe("2358");
  });
});

describe("parseAftnMessage — DLA", () => {
  it("parses the delayed departure information", () => {
    const result = parseAftnMessage({
      datetime: "2026-05-30 07:10:05",

      message_type: "DLA",

      call_sign: "LNI033",
      departure: "WADD",

      departure_time: "0720",
      destination: "WIII",
      raw: "(DLA-LNI033-WADD0720-WIII-DOF/260530)",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { message } = result;
    expect(message.messageType).toBe("DLA");
    expect(message.departureTime).toBe("0720");
    expect(message.parsed).toMatchObject({
      dof: "260530",
      delayedDepartureTime: "0720",
    });
  });
});

describe("parseAftnMessage — CHG", () => {
  it("extracts the changed AFTN fields from the raw message", () => {
    const result = parseAftnMessage({
      datetime: "2026-05-30 10:05:00",

      message_type: "CHG",

      call_sign: "LNI035",
      departure: "WADD",

      departure_time: "1020",
      destination: "WIII",
      raw: "(CHG-LNI035-WADD1020-WIII-DOF/260530-22/8-IS-22/16-WIII0130)",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { message } = result;
    expect(message.messageType).toBe("CHG");
    expect(message.callSign).toBe("LNI035");
    expect(message.parsed.changes).toEqual([
      { field: "8", value: "IS" },
      { field: "16", value: "WIII0130" },
    ]);
  });

  it("still parses a CHG message that carries no field-22 block", () => {
    const result = parseAftnMessage({
      datetime: "2026-05-30 10:05:00",

      message_type: "CHG",

      call_sign: "LNI035",
      raw: "(CHG-LNI035-WADD1020-WIII)",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.message.parsed.changes).toBeUndefined();
  });
});
