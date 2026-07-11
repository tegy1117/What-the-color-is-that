import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import express from "express";
import { Server } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@wtcit/shared";
import { GameService } from "./gameService";

function reply<T>(ack: ((result: T) => void) | undefined, action: () => T) {
  if (typeof ack === "function") ack(action());
}

export function createGameServer() {
  const app = express();
  const httpServer = createServer(app);
  const socketOptions = process.env.NODE_ENV === "production"
    ? {}
    : { cors: { origin: ["http://localhost:5173", "http://127.0.0.1:5173"] } };
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, socketOptions);
  const service = new GameService({
    snapshot: (socketId, snapshot) => io.to(socketId).emit("room:snapshot", snapshot),
    presence: (socketId, presence) => io.to(socketId).emit("guess:presence", presence),
  });

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok", connections: io.engine.clientsCount });
  });

  const webDist = path.resolve(process.cwd(), "apps/web/dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((request, response, next) => {
      if (request.method !== "GET" || !request.accepts("html")) return next();
      response.sendFile(path.join(webDist, "index.html"));
    });
  }

  io.on("connection", (socket) => {
    socket.on("room:create", (payload, ack) => reply(ack, () => service.createRoom(socket.id, payload)));
    socket.on("room:join", (payload, ack) => reply(ack, () => service.joinRoom(socket.id, payload)));
    socket.on("room:leave", (ack) => reply(ack, () => service.leaveRoom(socket.id)));
    socket.on("room:updateSettings", (payload, ack) => reply(ack, () => service.updateSettings(socket.id, payload)));
    socket.on("game:start", (ack) => reply(ack, () => service.startGame(socket.id)));
    socket.on("game:end", (ack) => reply(ack, () => service.endGame(socket.id)));
    socket.on("picker:submit", (payload, ack) => reply(ack, () => service.submitPicker(socket.id, payload)));
    socket.on("guess:update", (payload, ack) => reply(ack, () => service.updateGuess(socket.id, payload)));
    socket.on("guess:confirm", (payload, ack) => reply(ack, () => service.confirmGuess(socket.id, payload)));
    socket.on("reveal:advance", (ack) => reply(ack, () => service.advanceReveal(socket.id)));
    socket.on("reveal:pause", (payload, ack) => reply(ack, () => service.pauseReveal(socket.id, payload)));
    socket.on("session:resume", (payload, ack) => reply(ack, () => service.resumeSession(socket.id, payload)));
    socket.on("disconnect", () => service.disconnect(socket.id));
  });

  return { app, httpServer, io, service };
}
