import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { io as createClient } from "socket.io-client";
import type { EventAck, SessionInfo } from "@wtcit/shared";
import { createGameServer } from "./server";
import { SOCKET_LIMITS } from "./socketProtection";

function openEngineConnection(port: number) {
  const websocket = new WebSocket(
    `ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`,
  );
  return new Promise<WebSocket>((resolve, reject) => {
    websocket.addEventListener("open", () => resolve(websocket), { once: true });
    websocket.addEventListener("error", () => reject(new Error("WebSocket rejected")), {
      once: true,
    });
    websocket.addEventListener("close", () => reject(new Error("WebSocket closed")), {
      once: true,
    });
  });
}

function closeWebSocket(websocket: WebSocket) {
  return new Promise<void>((resolve) => {
    websocket.addEventListener("close", () => resolve(), { once: true });
    websocket.close();
  });
}

describe("game server", () => {
  it("ignores commands without an acknowledgement callback", async () => {
    const { httpServer, io } = createGameServer();
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    const client = createClient(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });

    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });

      const runtimeClient = client as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };
      runtimeClient.emit("room:create", { nickname: "ackless", role: "player" });

      const result = await new Promise<{ ok: boolean }>((resolve) => {
        client.emit("room:create", { nickname: "valid", role: "player" }, resolve);
      });
      expect(result.ok).toBe(true);
    } finally {
      client.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });

  it("counts Engine.IO connections before Socket.IO namespace admission", async () => {
    const limits = {
      ...SOCKET_LIMITS,
      maxConnections: 2,
      maxConnectionsPerIp: 1,
      connectionAttemptsPerMinute: 10,
      enginePacketsPerSecondPerConnection: 2,
    };
    const { httpServer, io } = createGameServer(limits);
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    let first: WebSocket | null = null;
    let replacement: WebSocket | null = null;

    try {
      first = await openEngineConnection(port);
      await expect(openEngineConnection(port)).rejects.toThrow();
      await closeWebSocket(first);
      first = null;
      replacement = await openEngineConnection(port);
      const closed = new Promise<void>((resolve) => {
        replacement!.addEventListener("close", () => resolve(), { once: true });
      });
      replacement.send("3");
      replacement.send("3");
      replacement.send("3");
      await closed;
      replacement = null;
    } finally {
      if (first) first.close();
      if (replacement) replacement.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });

  it("limits repeated room creation from one address", async () => {
    const { httpServer, io } = createGameServer();
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, "127.0.0.1", resolve);
    });
    const { port } = httpServer.address() as AddressInfo;
    const client = createClient(`http://127.0.0.1:${port}`, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"],
    });

    try {
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("connect_error", reject);
      });
      expect(io.engine.opts.maxHttpBufferSize).toBe(SOCKET_LIMITS.maxHttpBufferSize);
      const runtimeClient = client as unknown as {
        emit: (event: string, ...args: unknown[]) => void;
      };
      runtimeClient.emit("room:create", { nickname: "ackless", role: "player" });

      for (let index = 0; index < SOCKET_LIMITS.roomCreationsPerMinutePerIp; index += 1) {
        const created = await new Promise<EventAck<SessionInfo>>((resolve) => {
          client.emit("room:create", { nickname: `방장${index}`, role: "player" }, resolve);
        });
        expect(created.ok).toBe(true);
        await new Promise<EventAck>((resolve) => client.emit("room:leave", resolve));
      }

      const limited = await new Promise<EventAck<SessionInfo>>((resolve) => {
        client.emit("room:create", { nickname: "초과", role: "player" }, resolve);
      });
      expect(limited).toMatchObject({ ok: false, code: "RATE_LIMITED" });

      for (let index = 0; index < 8; index += 1) {
        const result = await new Promise<EventAck>((resolve) => {
          client.emit("room:updateRole", { role: "player" }, resolve);
        });
        expect(result).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
      }
      const eventLimited = await new Promise<EventAck>((resolve) => {
        client.emit("room:updateRole", { role: "player" }, resolve);
      });
      expect(eventLimited).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    } finally {
      client.close();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  });
});
