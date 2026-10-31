import { describe, expect, it } from "bun:test";
import type { FlightPlanEvent } from "@aeroswarm/core";
import {
  createFlightPlanPublisher,
  flightPlanPublisherFromEnv,
  type ProducerLike,
} from "./flightplan.producer";

const event = (callsign: string | undefined, id = "m1"): FlightPlanEvent =>
  ({
    messageId: id,
    sourceId: "aftn",
    airportId: "WARR",
    receivedAt: 5,
    message: { type: "FPL", callsign },
  }) as FlightPlanEvent;

function fakeProducer() {
  const sent: Array<{
    topic: string;
    messages: Array<{ key: string; value: string }>;
  }> = [];
  const calls: string[] = [];
  const producer: ProducerLike = {
    async connect() {
      calls.push("connect");
    },
    async disconnect() {
      calls.push("disconnect");
    },
    async send(r) {
      sent.push(r);
    },
  };
  return { producer, sent, calls };
}

describe("flight plan publisher", () => {
  it("publishes the event unchanged, keyed by upper-cased callsign", async () => {
    const f = fakeProducer();
    const pub = createFlightPlanPublisher({
      brokers: [],
      topic: "t",
      producer: f.producer,
    });
    await pub.start();
    await pub.publish(event("gia123"));
    expect(f.calls).toEqual(["connect"]);
    expect(f.sent[0]?.topic).toBe("t");
    expect(f.sent[0]?.messages[0]?.key).toBe("GIA123");
    expect(JSON.parse(f.sent[0]?.messages[0]?.value ?? "{}")).toEqual(
      event("gia123"),
    );
    await pub.stop();
    expect(f.calls).toEqual(["connect", "disconnect"]);
  });

  it("falls back to messageId when there is no callsign", async () => {
    const f = fakeProducer();
    const pub = createFlightPlanPublisher({
      brokers: [],
      topic: "t",
      producer: f.producer,
    });
    await pub.publish(event(undefined, "m9"));
    expect(f.sent[0]?.messages[0]?.key).toBe("m9");
  });

  it("is a harmless no-op without a broker", async () => {
    const pub = createFlightPlanPublisher({ brokers: [], topic: "t" });
    expect(pub.enabled).toBe(false);
    await pub.start();
    await pub.publish(event("X"));
    await pub.stop();
  });

  it("lets a Kafka failure reach the caller", async () => {
    const pub = createFlightPlanPublisher({
      brokers: [],
      topic: "t",
      producer: {
        connect: async () => {},
        disconnect: async () => {},
        send: async () => {
          throw new Error("down");
        },
      },
    });
    await expect(pub.publish(event("X"))).rejects.toThrow("down");
  });

  it("reads brokers from env", () => {
    expect(flightPlanPublisherFromEnv({}).enabled).toBe(false);
    expect(
      flightPlanPublisherFromEnv({ AFTN_KAFKA_BROKERS: "redpanda:9092" })
        .enabled,
    ).toBe(true);
    expect(
      flightPlanPublisherFromEnv({ KAFKA_BROKERS: "redpanda:9092" }).enabled,
    ).toBe(true);
  });
});
