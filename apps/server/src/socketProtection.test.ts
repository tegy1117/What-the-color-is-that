import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  SOCKET_LIMITS,
  SocketProtection,
  clientIp,
  type SocketLimits,
} from "./socketProtection";

const testLimits: SocketLimits = {
  ...SOCKET_LIMITS,
  maxConnections: 2,
  maxConnectionsPerIp: 1,
  connectionAttemptsPerMinute: 2,
  enginePacketsPerSecondPerConnection: 2,
  eventsPerSecondPerSocket: 2,
  roomCreationsPerMinutePerIp: 1,
  joinsAndResumesPerMinutePerIp: 1,
};

describe("SocketProtection", () => {
  it("allows 30 stale and 30 replacement connections behind one shared IP", () => {
    const protection = new SocketProtection(SOCKET_LIMITS, () => 0);
    for (let index = 0; index < 60; index += 1) {
      expect(protection.allowHandshake("203.0.113.1")).toBe(true);
      expect(protection.admitConnection("203.0.113.1")).toBe(true);
    }
  });

  it("bounds active connections globally and per IP", () => {
    const protection = new SocketProtection(testLimits, () => 0);

    expect(protection.allowHandshake("203.0.113.1")).toBe(true);
    expect(protection.admitConnection("203.0.113.1")).toBe(true);
    expect(protection.allowHandshake("203.0.113.1")).toBe(false);

    expect(protection.allowHandshake("203.0.113.2")).toBe(true);
    expect(protection.admitConnection("203.0.113.2")).toBe(true);
    expect(protection.allowHandshake("203.0.113.3")).toBe(false);

    protection.releaseConnection("203.0.113.1", "connection-a");
    expect(protection.allowHandshake("203.0.113.3")).toBe(true);
  });

  it("rate-limits connection attempts and event categories", () => {
    let now = 0;
    const protection = new SocketProtection(testLimits, () => now);

    expect(protection.allowHandshake("203.0.113.1")).toBe(true);
    expect(protection.allowHandshake("203.0.113.1")).toBe(true);
    expect(protection.allowHandshake("203.0.113.1")).toBe(false);

    expect(protection.allowEnginePacket("connection-a")).toBe(true);
    expect(protection.allowEnginePacket("connection-a")).toBe(true);
    expect(protection.allowEnginePacket("connection-a")).toBe(false);
    expect(protection.allowEvent("socket-a")).toBe(true);
    expect(protection.allowEvent("socket-a")).toBe(true);
    expect(protection.allowEvent("socket-a")).toBe(false);
    protection.forgetSocket("socket-a");
    expect(protection.allowEvent("socket-a")).toBe(true);
    expect(protection.allowRoomCreation("203.0.113.1")).toBe(true);
    expect(protection.allowRoomCreation("203.0.113.1")).toBe(false);
    expect(protection.allowJoinOrResume("203.0.113.1")).toBe(true);
    expect(protection.allowJoinOrResume("203.0.113.1")).toBe(false);

    now = 60_000;
    expect(protection.allowHandshake("203.0.113.1")).toBe(true);
    expect(protection.allowEnginePacket("connection-a")).toBe(true);
    expect(protection.allowEvent("socket-a")).toBe(true);
    expect(protection.allowRoomCreation("203.0.113.1")).toBe(true);
    expect(protection.allowJoinOrResume("203.0.113.1")).toBe(true);
  });

  it("uses the address appended by the trusted reverse proxy", () => {
    const request = {
      headers: { "x-forwarded-for": "198.51.100.2, 203.0.113.9" },
      socket: { remoteAddress: "172.18.0.2" },
    } as unknown as IncomingMessage;

    expect(clientIp(request)).toBe("203.0.113.9");
  });
});
