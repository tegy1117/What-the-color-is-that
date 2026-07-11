import { randomBytes, randomUUID } from "node:crypto";
import {
  DEFAULT_COLOR,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  calculatePickerScore,
  createRoomSchema,
  generateCandidateColors,
  guessSchema,
  joinRoomSchema,
  pickerSubmitSchema,
  revealPauseSchema,
  scoreGuess,
  sessionResumeSchema,
  settingsSchema,
  type ErrorCode,
  type EventAck,
  type GameSettings,
  type GuessPresence,
  type RoomSnapshot,
  type SessionInfo,
} from "@wtcit/shared";
import type { Clock, GameState, Participant, RoomState } from "./model";
import { systemClock } from "./model";
import { buildRanking, buildSnapshot } from "./snapshots";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECONNECT_GRACE_MS = 30_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const REVEAL_MS = 12_000;
const SKIPPED_MS = 3_000;

export interface EventSink {
  snapshot: (socketId: string, snapshot: RoomSnapshot) => void;
  presence: (socketId: string, presence: GuessPresence) => void;
}

const success = <T>(data: T): EventAck<T> => ({ ok: true, data });
const failure = (code: ErrorCode, message: string): EventAck<never> => ({
  ok: false,
  code,
  message,
});

function createGameState(settings: GameSettings = DEFAULT_SETTINGS): GameState {
  return {
    phase: "lobby",
    settings: { ...settings },
    cycleOrders: [],
    cycleIndex: 0,
    pickerIndex: 0,
    roundNumber: 0,
    pickerId: null,
    candidates: [],
    targetHex: null,
    hint: "",
    deadline: null,
    guessStartedAt: null,
    guessDeadline: null,
    roundGuesserIds: [],
    reveal: null,
    revealPaused: false,
    revealRemainingMs: null,
    skippedPickerNickname: "",
    results: [],
  };
}

export class GameService {
  private readonly rooms = new Map<string, RoomState>();
  private readonly socketIndex = new Map<string, { roomCode: string; participantId: string }>();
  private readonly phaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly sink: EventSink,
    private readonly clock: Clock = systemClock,
    private readonly random: () => number = Math.random,
  ) {}

  createRoom(socketId: string, rawPayload: unknown): EventAck<SessionInfo> {
    if (this.socketIndex.has(socketId)) return failure("NOT_ALLOWED", "Leave the current room first");
    const parsed = createRoomSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid room settings");
    const roomCode = this.generateRoomCode();
    const participant = this.createParticipant(socketId, parsed.data.nickname, parsed.data.role);
    const room: RoomState = {
      code: roomCode,
      hostId: participant.id,
      participants: new Map([[participant.id, participant]]),
      game: createGameState(),
      notice: null,
    };
    this.rooms.set(roomCode, room);
    this.bindSocket(socketId, roomCode, participant.id);
    this.broadcast(room);
    return success(this.sessionFor(roomCode, participant));
  }

  joinRoom(socketId: string, rawPayload: unknown): EventAck<SessionInfo> {
    if (this.socketIndex.has(socketId)) return failure("NOT_ALLOWED", "Leave the current room first");
    const parsed = joinRoomSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid join request");
    const room = this.rooms.get(parsed.data.roomCode);
    if (!room) return failure("ROOM_NOT_FOUND", "Room not found");
    if ([...room.participants.values()].some(
      (participant) => participant.nickname.toLocaleLowerCase() === parsed.data.nickname.toLocaleLowerCase(),
    )) {
      return failure("NAME_TAKEN", "Nickname is already in use");
    }

    const players = this.playerCount(room) + this.pendingPlayerCount(room);
    const spectators = [...room.participants.values()].filter(
      (participant) => participant.role === "spectator",
    ).length;
    if (parsed.data.role === "player" && players >= MAX_PLAYERS) {
      return failure("ROOM_FULL", "Player slots are full");
    }
    if (parsed.data.role === "spectator" && spectators >= MAX_SPECTATORS) {
      return failure("ROOM_FULL", "Spectator slots are full");
    }

    const joinsInProgress = room.game.phase !== "lobby";
    const participant = this.createParticipant(
      socketId,
      parsed.data.nickname,
      joinsInProgress ? "spectator" : parsed.data.role,
    );
    participant.preferredRole = parsed.data.role;
    participant.pendingPlayer = joinsInProgress && parsed.data.role === "player";
    room.participants.set(participant.id, participant);
    this.bindSocket(socketId, room.code, participant.id);
    this.clearCleanup(room.code);
    this.broadcast(room);
    return success(this.sessionFor(room.code, participant));
  }

  resumeSession(socketId: string, rawPayload: unknown): EventAck<SessionInfo> {
    if (this.socketIndex.has(socketId)) return failure("NOT_ALLOWED", "Leave the current room first");
    const parsed = sessionResumeSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid session");
    const room = this.rooms.get(parsed.data.roomCode);
    const participant = room
      ? [...room.participants.values()].find((candidate) => candidate.token === parsed.data.token)
      : undefined;
    if (!room || !participant) return failure("SESSION_EXPIRED", "Session expired");
    if (!participant.connected) {
      const reconnectDeadline = participant.disconnectedAt === null
        ? null
        : participant.disconnectedAt + RECONNECT_GRACE_MS;
      if (!this.disconnectTimers.has(participant.id) || reconnectDeadline === null) {
        return failure("SESSION_EXPIRED", "Session expired");
      }
      if (this.clock.now() >= reconnectDeadline) {
        this.expireParticipant(room, participant, false);
        return failure("SESSION_EXPIRED", "Session expired");
      }
    }

    if (participant.socketId) this.socketIndex.delete(participant.socketId);
    this.clearDisconnect(participant.id);
    participant.socketId = socketId;
    participant.connected = true;
    participant.disconnectedAt = null;
    if (
      room.game.phase !== "lobby" &&
      participant.preferredRole === "player" &&
      participant.role === "spectator" &&
      this.playerCount(room) + this.pendingPlayerCount(room) < MAX_PLAYERS
    ) {
      participant.pendingPlayer = true;
    }
    this.bindSocket(socketId, room.code, participant.id);
    this.clearCleanup(room.code);
    this.broadcast(room);
    return success(this.sessionFor(room.code, participant));
  }

  leaveRoom(socketId: string): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return success(undefined);
    this.socketIndex.delete(socketId);
    this.clearDisconnect(context.participant.id);
    context.participant.socketId = null;
    context.participant.connected = false;
    context.participant.disconnectedAt = this.clock.now();
    this.expireParticipant(context.room, context.participant, true);
    return success(undefined);
  }

  updateSettings(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    if (context.room.hostId !== context.participant.id) return failure("NOT_HOST", "Host only");
    if (context.room.game.phase !== "lobby") return failure("INVALID_PHASE", "Game already started");
    const parsed = settingsSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid game settings");
    context.room.game.settings = parsed.data;
    context.room.notice = null;
    this.broadcast(context.room);
    return success(undefined);
  }

  startGame(socketId: string): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const { room, participant } = context;
    if (room.hostId !== participant.id) return failure("NOT_HOST", "Host only");
    if (room.game.phase !== "lobby") return failure("INVALID_PHASE", "Game already started");
    const activePlayers = [...room.participants.values()].filter(
      (candidate) => candidate.role === "player" && candidate.connected,
    );
    if (activePlayers.length < 2) return failure("NOT_ALLOWED", "At least two players are required");

    for (const candidate of room.participants.values()) {
      candidate.score = 0;
      candidate.lastColor = DEFAULT_COLOR;
      candidate.confirmed = false;
      candidate.confirmedAt = null;
    }
    const order = this.shuffle(activePlayers.map((candidate) => candidate.id));
    room.game = createGameState(room.game.settings);
    room.game.cycleOrders = Array.from(
      { length: room.game.settings.cycles },
      () => [...order],
    );
    room.notice = null;
    this.startRound(room);
    return success(undefined);
  }

  submitPicker(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = pickerSubmitSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Choose a color and enter a hint");
    const { room, participant } = context;
    if (room.game.phase !== "pickerPrep") return failure("INVALID_PHASE", "Picker phase ended");
    if (room.game.pickerId !== participant.id) return failure("NOT_ALLOWED", "Picker only");
    if (room.game.deadline !== null && this.clock.now() >= room.game.deadline) {
      this.skipPickerRound(room);
      return failure("INVALID_PHASE", "Picker phase ended");
    }
    if (!room.game.candidates.includes(parsed.data.targetHex)) {
      return failure("NOT_ALLOWED", "Choose one of the assigned colors");
    }

    this.clearPhaseTimer(room.code);
    room.game.targetHex = parsed.data.targetHex;
    room.game.hint = parsed.data.hint;
    room.game.phase = "guessing";
    room.game.guessStartedAt = this.clock.now();
    room.game.guessDeadline = room.game.guessStartedAt + room.game.settings.guessSeconds * 1000;
    room.game.deadline = room.game.guessDeadline;
    room.game.roundGuesserIds = [...room.participants.values()]
      .filter((candidate) => candidate.role === "player" && candidate.id !== participant.id)
      .map((candidate) => candidate.id);
    for (const guesserId of room.game.roundGuesserIds) {
      const guesser = room.participants.get(guesserId);
      if (!guesser) continue;
      guesser.lastColor = DEFAULT_COLOR;
      guesser.confirmed = false;
      guesser.confirmedAt = null;
      guesser.lastGuessUpdateAt = 0;
    }
    this.schedulePhase(room, room.game.settings.guessSeconds * 1000, () => this.finishGuessing(room));
    this.broadcast(room);
    return success(undefined);
  }

  updateGuess(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = guessSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid color");
    const { room, participant } = context;
    if (room.game.phase !== "guessing" || !room.game.roundGuesserIds.includes(participant.id)) {
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    if (room.game.guessDeadline !== null && this.clock.now() >= room.game.guessDeadline) {
      this.finishGuessing(room);
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    if (participant.confirmed) return failure("ALREADY_CONFIRMED", "Color is locked");
    const now = this.clock.now();
    if (now - participant.lastGuessUpdateAt < 90) {
      return failure("RATE_LIMITED", "Color updates are too frequent");
    }
    participant.lastGuessUpdateAt = now;
    participant.lastColor = parsed.data.color;
    this.emitPresence(room, participant);
    return success(undefined);
  }

  confirmGuess(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = guessSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid color");
    const { room, participant } = context;
    if (room.game.phase !== "guessing" || !room.game.roundGuesserIds.includes(participant.id)) {
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    if (room.game.guessDeadline !== null && this.clock.now() >= room.game.guessDeadline) {
      this.finishGuessing(room);
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    if (participant.confirmed) return failure("ALREADY_CONFIRMED", "Color is locked");
    participant.lastColor = parsed.data.color;
    participant.confirmed = true;
    participant.confirmedAt = this.clock.now();
    this.broadcast(room);
    if (room.game.roundGuesserIds.every((id) => room.participants.get(id)?.confirmed)) {
      this.finishGuessing(room);
    }
    return success(undefined);
  }

  pauseReveal(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    if (context.room.hostId !== context.participant.id) return failure("NOT_HOST", "Host only");
    if (context.room.game.phase !== "reveal") return failure("INVALID_PHASE", "No reveal is active");
    const parsed = revealPauseSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid pause state");
    const { room } = context;
    if (room.game.revealPaused === parsed.data.paused) return success(undefined);

    if (parsed.data.paused) {
      room.game.revealRemainingMs = Math.max(0, (room.game.deadline ?? this.clock.now()) - this.clock.now());
      room.game.deadline = null;
      room.game.revealPaused = true;
      this.clearPhaseTimer(room.code);
    } else {
      const remaining = room.game.revealRemainingMs ?? REVEAL_MS;
      room.game.deadline = this.clock.now() + remaining;
      room.game.revealRemainingMs = null;
      room.game.revealPaused = false;
      this.schedulePhase(room, remaining, () => this.advanceRound(room));
    }
    this.broadcast(room);
    return success(undefined);
  }

  advanceReveal(socketId: string): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    if (context.room.hostId !== context.participant.id) return failure("NOT_HOST", "Host only");
    if (context.room.game.phase !== "reveal") return failure("INVALID_PHASE", "No reveal is active");
    this.advanceRound(context.room);
    return success(undefined);
  }

  endGame(socketId: string): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    if (context.room.hostId !== context.participant.id) return failure("NOT_HOST", "Host only");
    this.resetToLobby(context.room, null);
    return success(undefined);
  }

  disconnect(socketId: string) {
    const context = this.context(socketId);
    if (!context) return;
    this.socketIndex.delete(socketId);
    const { room, participant } = context;
    participant.socketId = null;
    participant.connected = false;
    participant.disconnectedAt = this.clock.now();
    this.broadcast(room);
    const timer = this.clock.setTimeout(() => {
      if (!participant.connected) this.expireParticipant(room, participant, false);
    }, RECONNECT_GRACE_MS);
    this.disconnectTimers.set(participant.id, timer);
    this.scheduleCleanupIfEmpty(room);
  }

  getSnapshot(roomCode: string, participantId: string): RoomSnapshot | null {
    const room = this.rooms.get(roomCode);
    return room && room.participants.has(participantId)
      ? buildSnapshot(room, participantId, this.clock.now())
      : null;
  }

  private startRound(room: RoomState) {
    this.clearPhaseTimer(room.code);
    const pickerId = this.currentPickerId(room);
    if (!pickerId) {
      this.finishGame(room);
      return;
    }
    const picker = room.participants.get(pickerId);
    if (!picker) {
      this.advanceRound(room);
      return;
    }
    room.game.phase = "pickerPrep";
    room.game.roundNumber += 1;
    room.game.pickerId = pickerId;
    room.game.candidates = generateCandidateColors(this.random);
    room.game.targetHex = null;
    room.game.hint = "";
    room.game.reveal = null;
    room.game.results = [];
    room.game.roundGuesserIds = [];
    room.game.revealPaused = false;
    room.game.revealRemainingMs = null;
    room.game.deadline = this.clock.now() + room.game.settings.pickerSeconds * 1000;
    for (const participant of room.participants.values()) {
      participant.lastColor = DEFAULT_COLOR;
      participant.confirmed = false;
      participant.confirmedAt = null;
    }
    this.schedulePhase(room, room.game.settings.pickerSeconds * 1000, () => this.skipPickerRound(room));
    this.broadcast(room);
  }

  private skipPickerRound(room: RoomState) {
    if (room.game.phase !== "pickerPrep") return;
    this.clearPhaseTimer(room.code);
    const picker = room.game.pickerId ? room.participants.get(room.game.pickerId) : null;
    room.game.phase = "roundSkipped";
    room.game.skippedPickerNickname = picker?.nickname ?? "";
    room.game.deadline = this.clock.now() + SKIPPED_MS;
    this.schedulePhase(room, SKIPPED_MS, () => this.advanceRound(room));
    this.broadcast(room);
  }

  private finishGuessing(room: RoomState) {
    if (room.game.phase !== "guessing" || !room.game.targetHex) return;
    this.clearPhaseTimer(room.code);
    const startedAt = room.game.guessStartedAt ?? this.clock.now();
    const deadline = room.game.guessDeadline ?? this.clock.now();
    const results = room.game.roundGuesserIds.flatMap((participantId) => {
      const participant = room.participants.get(participantId);
      if (!participant) return [];
      const result = scoreGuess({
        participantId,
        nickname: participant.nickname,
        color: participant.lastColor,
        targetHex: room.game.targetHex!,
        confirmedAt: participant.confirmed ? participant.confirmedAt : null,
        startedAt,
        deadline,
      });
      participant.score += result.roundScore;
      participant.confirmed = true;
      return [result];
    }).sort((first, second) => first.deltaE - second.deltaE);
    const picker = room.game.pickerId ? room.participants.get(room.game.pickerId) : null;
    const pickerScore = calculatePickerScore(results.map((result) => result.accuracy));
    if (picker) picker.score += pickerScore;

    room.game.results = results;
    room.game.reveal = {
      targetHex: room.game.targetHex,
      hint: room.game.hint,
      results,
      pickerId: picker?.id ?? "",
      pickerNickname: picker?.nickname ?? "",
      pickerScore,
    };
    room.game.phase = "reveal";
    room.game.revealPaused = false;
    room.game.revealRemainingMs = null;
    room.game.deadline = this.clock.now() + REVEAL_MS;
    this.schedulePhase(room, REVEAL_MS, () => this.advanceRound(room));
    this.broadcast(room);
  }

  private advanceRound(room: RoomState) {
    if (!["reveal", "roundSkipped"].includes(room.game.phase)) return;
    this.clearPhaseTimer(room.code);
    let cycleIndex = room.game.cycleIndex;
    let pickerIndex = room.game.pickerIndex + 1;
    const currentOrder = room.game.cycleOrders[cycleIndex] ?? [];
    if (pickerIndex >= currentOrder.length) {
      cycleIndex += 1;
      pickerIndex = 0;
    }
    if (cycleIndex >= room.game.settings.cycles) {
      this.finishGame(room);
      return;
    }

    this.promotePendingPlayers(room, cycleIndex);
    room.game.cycleIndex = cycleIndex;
    room.game.pickerIndex = pickerIndex;
    while (room.game.cycleIndex < room.game.settings.cycles) {
      const order = room.game.cycleOrders[room.game.cycleIndex] ?? [];
      const candidateId = order[room.game.pickerIndex];
      const candidate = candidateId ? room.participants.get(candidateId) : null;
      if (candidate?.role === "player") break;
      room.game.pickerIndex += 1;
      if (room.game.pickerIndex >= order.length) {
        room.game.cycleIndex += 1;
        room.game.pickerIndex = 0;
      }
    }
    if (room.game.cycleIndex >= room.game.settings.cycles) {
      this.finishGame(room);
      return;
    }
    this.startRound(room);
  }

  private promotePendingPlayers(room: RoomState, targetCycle: number) {
    if (targetCycle >= room.game.settings.cycles) return;
    const pending = [...room.participants.values()]
      .filter((participant) => participant.pendingPlayer && participant.connected)
      .sort((first, second) => first.joinedAt - second.joinedAt);
    for (const participant of pending) {
      if (this.playerCount(room) >= MAX_PLAYERS) break;
      participant.role = "player";
      participant.pendingPlayer = false;
      for (let cycle = targetCycle; cycle < room.game.settings.cycles; cycle += 1) {
        room.game.cycleOrders[cycle]?.push(participant.id);
      }
    }
  }

  private finishGame(room: RoomState) {
    this.clearPhaseTimer(room.code);
    room.game.phase = "gameOver";
    room.game.deadline = null;
    room.game.revealPaused = false;
    room.game.revealRemainingMs = null;
    this.broadcast(room);
  }

  private resetToLobby(room: RoomState, notice: RoomState["notice"]) {
    this.clearPhaseTimer(room.code);
    const settings = room.game.settings;
    for (const [participantId, participant] of room.participants) {
      if (!participant.connected && !this.disconnectTimers.has(participantId)) {
        room.participants.delete(participantId);
      }
    }
    if (!room.participants.has(room.hostId)) this.transferHost(room);
    for (const participant of room.participants.values()) {
      if (participant.pendingPlayer && participant.connected && this.playerCount(room) < MAX_PLAYERS) {
        participant.role = "player";
        participant.pendingPlayer = false;
      }
      participant.score = 0;
      participant.lastColor = DEFAULT_COLOR;
      participant.confirmed = false;
      participant.confirmedAt = null;
    }
    room.game = createGameState(settings);
    room.notice = notice;
    this.broadcast(room);
  }

  private expireParticipant(room: RoomState, participant: Participant, explicit: boolean) {
    this.clearDisconnect(participant.id);
    if (room.game.phase === "lobby") {
      room.participants.delete(participant.id);
    } else {
      participant.role = "spectator";
      participant.pendingPlayer = false;
    }
    if (room.hostId === participant.id) this.transferHost(room);
    if (room.game.phase !== "lobby" && this.connectedPlayerCount(room) < 2) {
      this.resetToLobby(room, "notEnoughPlayers");
    } else {
      this.broadcast(room);
    }
    if (explicit) this.scheduleCleanupIfEmpty(room);
  }

  private transferHost(room: RoomState) {
    const connected = [...room.participants.values()]
      .filter((participant) => participant.connected)
      .sort((first, second) => {
        if (first.role !== second.role) return first.role === "player" ? -1 : 1;
        return first.joinedAt - second.joinedAt;
      });
    room.hostId = connected[0]?.id ?? "";
  }

  private emitPresence(room: RoomState, participant: Participant) {
    const presence: GuessPresence = {
      participantId: participant.id,
      color: participant.lastColor,
      confirmed: participant.confirmed,
    };
    for (const recipient of room.participants.values()) {
      if (!recipient.connected || !recipient.socketId) continue;
      const isWatcher =
        recipient.id === room.game.pickerId ||
        !room.game.roundGuesserIds.includes(recipient.id);
      if (isWatcher) this.sink.presence(recipient.socketId, presence);
    }
  }

  private broadcast(room: RoomState) {
    const now = this.clock.now();
    for (const participant of room.participants.values()) {
      if (participant.connected && participant.socketId) {
        this.sink.snapshot(participant.socketId, buildSnapshot(room, participant.id, now));
      }
    }
  }

  private schedulePhase(room: RoomState, delay: number, callback: () => void) {
    this.clearPhaseTimer(room.code);
    this.phaseTimers.set(room.code, this.clock.setTimeout(callback, Math.max(0, delay)));
  }

  private clearPhaseTimer(roomCode: string) {
    const timer = this.phaseTimers.get(roomCode);
    if (timer) this.clock.clearTimeout(timer);
    this.phaseTimers.delete(roomCode);
  }

  private clearDisconnect(participantId: string) {
    const timer = this.disconnectTimers.get(participantId);
    if (timer) this.clock.clearTimeout(timer);
    this.disconnectTimers.delete(participantId);
  }

  private scheduleCleanupIfEmpty(room: RoomState) {
    if ([...room.participants.values()].some((participant) => participant.connected)) return;
    this.clearCleanup(room.code);
    this.cleanupTimers.set(room.code, this.clock.setTimeout(() => {
      this.clearPhaseTimer(room.code);
      this.rooms.delete(room.code);
      this.cleanupTimers.delete(room.code);
    }, EMPTY_ROOM_TTL_MS));
  }

  private clearCleanup(roomCode: string) {
    const timer = this.cleanupTimers.get(roomCode);
    if (timer) this.clock.clearTimeout(timer);
    this.cleanupTimers.delete(roomCode);
  }

  private currentPickerId(room: RoomState): string | null {
    return room.game.cycleOrders[room.game.cycleIndex]?.[room.game.pickerIndex] ?? null;
  }

  private playerCount(room: RoomState) {
    return [...room.participants.values()].filter((participant) => participant.role === "player").length;
  }

  private connectedPlayerCount(room: RoomState) {
    return [...room.participants.values()].filter(
      (participant) => participant.role === "player" && participant.connected,
    ).length;
  }

  private pendingPlayerCount(room: RoomState) {
    return [...room.participants.values()].filter((participant) => participant.pendingPlayer).length;
  }

  private createParticipant(socketId: string, nickname: string, role: Participant["role"]): Participant {
    return {
      id: randomUUID(),
      token: randomBytes(24).toString("base64url"),
      socketId,
      nickname,
      role,
      preferredRole: role,
      pendingPlayer: false,
      connected: true,
      joinedAt: this.clock.now(),
      disconnectedAt: null,
      score: 0,
      lastColor: DEFAULT_COLOR,
      confirmed: false,
      confirmedAt: null,
      lastGuessUpdateAt: 0,
    };
  }

  private sessionFor(roomCode: string, participant: Participant): SessionInfo {
    return { roomCode, participantId: participant.id, token: participant.token };
  }

  private bindSocket(socketId: string, roomCode: string, participantId: string) {
    this.socketIndex.set(socketId, { roomCode, participantId });
  }

  private context(socketId: string) {
    const indexed = this.socketIndex.get(socketId);
    const room = indexed ? this.rooms.get(indexed.roomCode) : null;
    const participant = room && indexed ? room.participants.get(indexed.participantId) : null;
    return room && participant ? { room, participant } : null;
  }

  private generateRoomCode() {
    for (;;) {
      let code = "";
      for (let index = 0; index < 6; index += 1) {
        code += ROOM_ALPHABET[Math.floor(this.random() * ROOM_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  private shuffle(values: string[]) {
    const shuffled = [...values];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(this.random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
    }
    return shuffled;
  }
}

