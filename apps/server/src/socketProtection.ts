import type { IncomingMessage } from "node:http";

export interface SocketLimits {
  maxHttpBufferSize: number;
  maxConnections: number;
  maxConnectionsPerIp: number;
  connectionAttemptsPerMinute: number;
  enginePacketsPerSecondPerConnection: number;
  eventsPerSecondPerSocket: number;
  roomCreationsPerMinutePerIp: number;
  joinsAndResumesPerMinutePerIp: number;
}

export const SOCKET_LIMITS: SocketLimits = {
  maxHttpBufferSize: 32 * 1024,
  maxConnections: 100,
  maxConnectionsPerIp: 70,
  connectionAttemptsPerMinute: 600,
  enginePacketsPerSecondPerConnection: 60,
  eventsPerSecondPerSocket: 30,
  roomCreationsPerMinutePerIp: 10,
  joinsAndResumesPerMinutePerIp: 180,
};

const MAX_TRACKED_KEYS = 2_048;

class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();
  private lastPrunedAt = 0;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  allow(key: string) {
    const now = this.now();
    if (now - this.lastPrunedAt >= this.windowMs) this.prune(now);
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      if (!current && this.windows.size >= MAX_TRACKED_KEYS) return false;
      this.windows.set(key, { startedAt: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }

  delete(key: string) {
    this.windows.delete(key);
  }

  private prune(now: number) {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    }
    this.lastPrunedAt = now;
  }
}

export class SocketProtection {
  private activeConnections = 0;
  private readonly activeConnectionsByIp = new Map<string, number>();
  private readonly connectionAttempts: FixedWindowRateLimiter;
  private readonly enginePackets: FixedWindowRateLimiter;
  private readonly socketEvents: FixedWindowRateLimiter;
  private readonly roomCreations: FixedWindowRateLimiter;
  private readonly joinsAndResumes: FixedWindowRateLimiter;

  constructor(
    private readonly limits: SocketLimits = SOCKET_LIMITS,
    now: () => number = Date.now,
  ) {
    this.connectionAttempts = new FixedWindowRateLimiter(
      limits.connectionAttemptsPerMinute,
      60_000,
      now,
    );
    this.enginePackets = new FixedWindowRateLimiter(
      limits.enginePacketsPerSecondPerConnection,
      1_000,
      now,
    );
    this.socketEvents = new FixedWindowRateLimiter(
      limits.eventsPerSecondPerSocket,
      1_000,
      now,
    );
    this.roomCreations = new FixedWindowRateLimiter(
      limits.roomCreationsPerMinutePerIp,
      60_000,
      now,
    );
    this.joinsAndResumes = new FixedWindowRateLimiter(
      limits.joinsAndResumesPerMinutePerIp,
      60_000,
      now,
    );
  }

  allowHandshake(ip: string) {
    if (this.activeConnections >= this.limits.maxConnections) return false;
    if ((this.activeConnectionsByIp.get(ip) ?? 0) >= this.limits.maxConnectionsPerIp) {
      return false;
    }
    return this.connectionAttempts.allow(ip);
  }

  admitConnection(ip: string) {
    if (this.activeConnections >= this.limits.maxConnections) return false;
    const current = this.activeConnectionsByIp.get(ip) ?? 0;
    if (current >= this.limits.maxConnectionsPerIp) return false;
    this.activeConnections += 1;
    this.activeConnectionsByIp.set(ip, current + 1);
    return true;
  }

  releaseConnection(ip: string, connectionId: string) {
    const current = this.activeConnectionsByIp.get(ip);
    if (current !== undefined) {
      this.activeConnections = Math.max(0, this.activeConnections - 1);
      if (current <= 1) this.activeConnectionsByIp.delete(ip);
      else this.activeConnectionsByIp.set(ip, current - 1);
    }
    this.enginePackets.delete(connectionId);
  }

  allowEnginePacket(connectionId: string) {
    return this.enginePackets.allow(connectionId);
  }

  forgetSocket(socketId: string) {
    this.socketEvents.delete(socketId);
  }

  allowEvent(socketId: string) {
    return this.socketEvents.allow(socketId);
  }

  allowRoomCreation(ip: string) {
    return this.roomCreations.allow(ip);
  }

  allowJoinOrResume(ip: string) {
    return this.joinsAndResumes.allow(ip);
  }
}

export function clientIp(request: IncomingMessage) {
  const forwarded = request.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded?.split(",").at(-1);
  return value?.trim() || request.socket.remoteAddress || "unknown";
}
