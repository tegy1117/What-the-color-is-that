import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { io as createClient } from "socket.io-client";
import { createGameServer } from "./server";

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
});
