import { randomBytes, randomUUID } from "node:crypto";
import {
  DEFAULT_COLOR,
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MAX_SPECTATORS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  calculatePickerScore,
  calculateSpyCrewScore,
  compareColors,
  createRoomSchema,
  generateCandidateColors,
  guessSchema,
  joinRoomSchema,
  kickPlayerSchema,
  pickerSubmitSchema,
  revealPauseSchema,
  scoreGuess,
  sessionResumeSchema,
  settingsSchema,
  spyHintSchema,
  spyVoteSchema,
  updateRoleSchema,
  type ErrorCode,
  type EventAck,
  type GameSettings,
  type GuessPresence,
  type PrecisionAttemptResult,
  type RoomSnapshot,
  type SessionInfo,
  type SpyColorResult,
  type SpyVoteChoice,
} from "@wtcit/shared";
import type { Clock, GameState, Participant, RoomState } from "./model";
import { systemClock } from "./model";
import { buildSnapshot } from "./snapshots";

export const MAX_ACTIVE_ROOMS = 80;

const RECONNECT_GRACE_MS = 30_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const REVEAL_MS = 12_000;
const SKIPPED_MS = 3_000;
const PRECISION_RESULT_MS = 5_000;

export interface EventSink {
  snapshot: (socketId: string, snapshot: RoomSnapshot) => void;
  presence: (socketId: string, presence: GuessPresence) => void;
  kicked: (socketId: string) => void;
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
    spy: null,
    precision: null,
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
    if (this.rooms.size >= MAX_ACTIVE_ROOMS) {
      return failure("RATE_LIMITED", "Server room limit reached");
    }
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
    if (!room || room.participants.size === 0) {
      if (room) this.destroyRoom(room);
      return failure("ROOM_NOT_FOUND", "Room not found");
    }
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
    if (!room.participants.has(room.hostId)) this.transferHost(room);
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
    if (!room.participants.has(room.hostId)) this.transferHost(room);
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

  updateRole(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    if (context.room.game.phase !== "lobby") {
      return failure("INVALID_PHASE", "Roles can only be changed in the lobby");
    }
    const parsed = updateRoleSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid participant role");
    const { room, participant } = context;
    if (
      parsed.data.role === "player" &&
      participant.role !== "player" &&
      this.playerCount(room) >= MAX_PLAYERS
    ) {
      return failure("ROOM_FULL", "Player slots are full");
    }
    const spectatorCount = [...room.participants.values()].filter(
      (candidate) => candidate.role === "spectator",
    ).length;
    if (
      parsed.data.role === "spectator" &&
      participant.role !== "spectator" &&
      spectatorCount >= MAX_SPECTATORS
    ) {
      return failure("ROOM_FULL", "Spectator slots are full");
    }

    participant.role = parsed.data.role;
    participant.preferredRole = parsed.data.role;
    participant.pendingPlayer = false;
    this.broadcast(room);
    return success(undefined);
  }

  kickPlayer(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const { room, participant } = context;
    if (room.hostId !== participant.id) return failure("NOT_HOST", "Host only");
    if (room.game.phase !== "lobby") {
      return failure("INVALID_PHASE", "Players can only be kicked in the lobby");
    }
    const parsed = kickPlayerSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid player");
    const target = room.participants.get(parsed.data.participantId);
    if (!target || target.id === participant.id || target.role !== "player") {
      return failure("NOT_ALLOWED", "Only another player can be kicked");
    }

    this.clearDisconnect(target.id);
    if (target.socketId) {
      this.socketIndex.delete(target.socketId);
      this.sink.kicked(target.socketId);
    }
    room.participants.delete(target.id);
    this.broadcast(room);
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
    const activePlayers = this.connectedPlayers(room);
    const minimumPlayers = room.game.settings.mode === "spy" ? 4 : 2;
    if (activePlayers.length < minimumPlayers) {
      return failure("NOT_ALLOWED", `At least ${minimumPlayers} players are required`);
    }

    for (const candidate of room.participants.values()) {
      candidate.score = 0;
      candidate.lastColor = DEFAULT_COLOR;
      candidate.confirmed = false;
      candidate.confirmedAt = null;
    }
    const settings = room.game.settings;
    room.game = createGameState(settings);
    room.notice = null;

    if (settings.mode === "spy") {
      this.startSpyRound(room);
    } else if (settings.mode === "precision") {
      this.startPrecisionTarget(room);
    } else {
      const order = this.shuffle(activePlayers.map((candidate) => candidate.id));
      room.game.cycleOrders = Array.from(
        { length: room.game.settings.cycles },
        () => [...order],
      );
      this.startClassicRound(room);
    }
    return success(undefined);
  }

  submitPicker(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = pickerSubmitSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Choose a color and enter a hint");
    const { room, participant } = context;
    if (room.game.settings.mode !== "classic" || room.game.phase !== "pickerPrep") {
      return failure("INVALID_PHASE", "Picker phase ended");
    }
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
      this.resetGuess(guesser, DEFAULT_COLOR);
    }
    this.schedulePhase(room, room.game.settings.guessSeconds * 1000, () => this.finishClassicGuessing(room));
    this.broadcast(room);
    return success(undefined);
  }

  submitSpyHint(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = spyHintSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid hint");
    const { room, participant } = context;
    const state = room.game.spy;
    if (room.game.phase !== "spyHinting" || !state) {
      return failure("INVALID_PHASE", "Hinting is not active");
    }
    if (room.game.deadline !== null && this.clock.now() >= room.game.deadline) {
      this.finishCurrentSpyHint(room, null);
      return failure("INVALID_PHASE", "Hint time ended");
    }
    if (state.hintOrder[state.hintIndex] !== participant.id) {
      return failure("NOT_ALLOWED", "Wait for your hint turn");
    }
    this.finishCurrentSpyHint(room, parsed.data.hint);
    return success(undefined);
  }

  submitSpyVote(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = spyVoteSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid vote");
    const { room, participant } = context;
    const state = room.game.spy;
    if (room.game.phase !== "spyVoting" || !state) {
      return failure("INVALID_PHASE", "Voting is not active");
    }
    if (room.game.deadline !== null && this.clock.now() >= room.game.deadline) {
      this.resolveSpyVote(room);
      return failure("INVALID_PHASE", "Voting ended");
    }
    if (!state.alivePlayerIds.includes(participant.id)) {
      return failure("NOT_ALLOWED", "Eliminated players cannot vote");
    }
    if (parsed.data.choice !== "abstain" && !state.alivePlayerIds.includes(parsed.data.choice)) {
      return failure("NOT_ALLOWED", "Vote for an active player");
    }
    state.votes.set(participant.id, parsed.data.choice as SpyVoteChoice);
    this.broadcast(room);
    return success(undefined);
  }

  updateGuess(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = guessSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid color");
    const { room, participant } = context;

    if (room.game.phase === "guessing" && room.game.settings.mode === "classic") {
      return this.updateClassicGuess(room, participant, parsed.data.color);
    }
    if (room.game.phase === "precisionGuessing" && room.game.settings.mode === "precision") {
      return this.updatePrecisionGuess(room, participant, parsed.data.color);
    }
    if (room.game.phase === "spyGuessing" && room.game.settings.mode === "spy") {
      return this.updateSpyGuess(room, participant, parsed.data.color);
    }
    return failure("INVALID_PHASE", "Guessing is not active");
  }

  confirmGuess(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    const parsed = guessSchema.safeParse(rawPayload);
    if (!parsed.success) return failure("INVALID_PAYLOAD", "Invalid color");
    const { room, participant } = context;

    if (room.game.phase === "guessing" && room.game.settings.mode === "classic") {
      return this.confirmClassicGuess(room, participant, parsed.data.color);
    }
    if (room.game.phase === "precisionGuessing" && room.game.settings.mode === "precision") {
      return this.confirmPrecisionGuess(room, participant, parsed.data.color);
    }
    if (room.game.phase === "spyGuessing" && room.game.settings.mode === "spy") {
      return this.confirmSpyGuess(room, participant, parsed.data.color);
    }
    return failure("INVALID_PHASE", "Guessing is not active");
  }

  pauseReveal(socketId: string, rawPayload: unknown): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    if (context.room.hostId !== context.participant.id) return failure("NOT_HOST", "Host only");
    if (!["reveal", "spyRoundReveal"].includes(context.room.game.phase)) {
      return failure("INVALID_PHASE", "No reveal is active");
    }
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
      this.schedulePhase(room, remaining, () => this.advanceCurrentReveal(room));
    }
    this.broadcast(room);
    return success(undefined);
  }

  advanceReveal(socketId: string): EventAck<undefined> {
    const context = this.context(socketId);
    if (!context) return failure("NOT_ALLOWED", "Join a room first");
    if (context.room.hostId !== context.participant.id) return failure("NOT_HOST", "Host only");
    if (!["reveal", "spyRoundReveal"].includes(context.room.game.phase)) {
      return failure("INVALID_PHASE", "No reveal is active");
    }
    this.advanceCurrentReveal(context.room);
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

  private updateClassicGuess(room: RoomState, participant: Participant, color: string): EventAck<undefined> {
    if (!room.game.roundGuesserIds.includes(participant.id)) {
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    if (room.game.guessDeadline !== null && this.clock.now() >= room.game.guessDeadline) {
      this.finishClassicGuessing(room);
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    const allowed = this.applyGuessUpdate(participant, color);
    if (!allowed.ok) return allowed;
    this.emitPresence(room, participant);
    return success(undefined);
  }

  private confirmClassicGuess(room: RoomState, participant: Participant, color: string): EventAck<undefined> {
    if (!room.game.roundGuesserIds.includes(participant.id)) {
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    if (room.game.guessDeadline !== null && this.clock.now() >= room.game.guessDeadline) {
      this.finishClassicGuessing(room);
      return failure("INVALID_PHASE", "Guessing is not active");
    }
    if (participant.confirmed) return failure("ALREADY_CONFIRMED", "Color is locked");
    participant.lastColor = color;
    participant.confirmed = true;
    participant.confirmedAt = this.clock.now();
    this.broadcast(room);
    if (room.game.roundGuesserIds.every((id) => room.participants.get(id)?.confirmed)) {
      this.finishClassicGuessing(room);
    }
    return success(undefined);
  }

  private startClassicRound(room: RoomState) {
    this.clearPhaseTimer(room.code);
    const pickerId = this.currentPickerId(room);
    if (!pickerId) {
      this.finishGame(room);
      return;
    }
    const picker = room.participants.get(pickerId);
    if (!picker) {
      this.advanceClassicRound(room);
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
      this.resetGuess(participant, DEFAULT_COLOR);
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
    this.schedulePhase(room, SKIPPED_MS, () => this.advanceClassicRound(room));
    this.broadcast(room);
  }

  private finishClassicGuessing(room: RoomState) {
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
    this.schedulePhase(room, REVEAL_MS, () => this.advanceClassicRound(room));
    this.broadcast(room);
  }

  private advanceClassicRound(room: RoomState) {
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

    this.promotePendingPlayersClassic(room, cycleIndex);
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
    this.startClassicRound(room);
  }

  private promotePendingPlayersClassic(room: RoomState, targetCycle: number) {
    if (targetCycle >= room.game.settings.cycles) return;
    const promoted = this.promotePendingPlayers(room);
    for (const participant of promoted) {
      for (let cycle = targetCycle; cycle < room.game.settings.cycles; cycle += 1) {
        room.game.cycleOrders[cycle]?.push(participant.id);
      }
    }
  }

  private startSpyRound(room: RoomState) {
    this.clearPhaseTimer(room.code);
    if (room.game.roundNumber >= room.game.settings.spyRounds) {
      this.finishGame(room);
      return;
    }
    if (room.game.roundNumber > 0) this.promotePendingPlayers(room);
    const players = this.connectedPlayers(room);
    if (players.length < 4) {
      this.finishGame(room);
      return;
    }
    room.game.roundNumber += 1;
    const roundPlayerIds = players.map((participant) => participant.id);
    const spyId = roundPlayerIds[Math.floor(this.random() * roundPlayerIds.length)] ?? null;
    room.game.spy = {
      roundPlayerIds,
      spyId,
      targetHex: this.generateRandomColor(),
      alivePlayerIds: [...roundPlayerIds],
      eliminatedPlayerIds: [],
      hintOrder: [],
      hintIndex: 0,
      hintCycle: 0,
      hints: [],
      votes: new Map(),
      wrongEliminations: 0,
      probes: [],
      guessKind: null,
      caught: false,
      reachedOneOnOne: false,
      voteInvalid: false,
      lastEliminated: null,
      roundResult: null,
    };
    room.game.pickerId = null;
    room.game.targetHex = null;
    room.game.revealPaused = false;
    room.game.revealRemainingMs = null;
    for (const participantId of roundPlayerIds) {
      const participant = room.participants.get(participantId);
      if (participant) this.resetGuess(participant, DEFAULT_COLOR);
    }
    this.startSpyHintCycle(room);
  }

  private startSpyHintCycle(room: RoomState) {
    const state = room.game.spy;
    if (!state) return;
    if (state.alivePlayerIds.length <= 2) {
      state.reachedOneOnOne = true;
      this.startSpyGuessing(room, "final");
      return;
    }
    state.hintCycle += 1;
    state.hintOrder = this.shuffle([...state.alivePlayerIds]);
    state.hintIndex = 0;
    state.votes.clear();
    state.guessKind = null;
    room.game.phase = "spyHinting";
    this.scheduleCurrentSpyHint(room);
  }

  private scheduleCurrentSpyHint(room: RoomState) {
    const state = room.game.spy;
    if (!state || room.game.phase !== "spyHinting") return;
    while (
      state.hintIndex < state.hintOrder.length &&
      !state.alivePlayerIds.includes(state.hintOrder[state.hintIndex]!)
    ) {
      state.hintIndex += 1;
    }
    if (state.hintIndex >= state.hintOrder.length) {
      this.startSpyDiscussion(room);
      return;
    }
    const delay = room.game.settings.spyHintSeconds * 1000;
    room.game.deadline = this.clock.now() + delay;
    this.schedulePhase(room, delay, () => this.finishCurrentSpyHint(room, null));
    this.broadcast(room);
  }

  private finishCurrentSpyHint(room: RoomState, hint: string | null) {
    const state = room.game.spy;
    if (!state || room.game.phase !== "spyHinting") return;
    this.clearPhaseTimer(room.code);
    const participantId = state.hintOrder[state.hintIndex];
    const participant = participantId ? room.participants.get(participantId) : null;
    if (participantId && participant && state.alivePlayerIds.includes(participantId)) {
      state.hints.push({
        participantId,
        nickname: participant.nickname,
        cycle: state.hintCycle,
        hint,
      });
    }
    state.hintIndex += 1;
    this.scheduleCurrentSpyHint(room);
  }

  private startSpyDiscussion(room: RoomState) {
    if (!room.game.spy) return;
    room.game.phase = "spyDiscussion";
    const delay = room.game.settings.spyDiscussionSeconds * 1000;
    room.game.deadline = this.clock.now() + delay;
    this.schedulePhase(room, delay, () => this.startSpyVoting(room));
    this.broadcast(room);
  }

  private startSpyVoting(room: RoomState) {
    const state = room.game.spy;
    if (!state) return;
    state.votes.clear();
    state.voteInvalid = false;
    room.game.phase = "spyVoting";
    const delay = room.game.settings.spyVoteSeconds * 1000;
    room.game.deadline = this.clock.now() + delay;
    this.schedulePhase(room, delay, () => this.resolveSpyVote(room));
    this.broadcast(room);
  }

  private resolveSpyVote(room: RoomState) {
    const state = room.game.spy;
    if (!state || room.game.phase !== "spyVoting") return;
    this.clearPhaseTimer(room.code);
    const choices: SpyVoteChoice[] = [...state.alivePlayerIds, "abstain"];
    const missingVotes = Math.max(0, state.alivePlayerIds.length - state.votes.size);
    const counts = choices.map((choice) => ({
      choice,
      count: [...state.votes.values()].filter((vote) => vote === choice).length +
        (choice === "abstain" ? missingVotes : 0),
    }));
    const highest = Math.max(0, ...counts.map((entry) => entry.count));
    const winners = counts.filter((entry) => entry.count === highest);
    if (highest === 0 || winners.length !== 1 || winners[0]?.choice === "abstain") {
      state.voteInvalid = true;
      state.lastEliminated = null;
      this.startSpyHintCycle(room);
      return;
    }

    const eliminatedId = winners[0]!.choice;
    if (eliminatedId === "abstain") return;
    const eliminated = room.participants.get(eliminatedId);
    state.alivePlayerIds = state.alivePlayerIds.filter((id) => id !== eliminatedId);
    if (!state.eliminatedPlayerIds.includes(eliminatedId)) {
      state.eliminatedPlayerIds.push(eliminatedId);
    }
    const wasSpy = eliminatedId === state.spyId;
    state.lastEliminated = {
      participantId: eliminatedId,
      nickname: eliminated?.nickname ?? "",
      wasSpy,
    };
    state.voteInvalid = false;
    state.votes.clear();

    if (wasSpy) {
      state.caught = true;
      this.startSpyGuessing(room, "final");
      return;
    }

    state.wrongEliminations += 1;
    if (state.alivePlayerIds.length <= 2) {
      state.reachedOneOnOne = true;
      this.startSpyGuessing(room, "final");
    } else {
      this.startSpyGuessing(room, "probe");
    }
  }

  private startSpyGuessing(room: RoomState, kind: "probe" | "final") {
    const state = room.game.spy;
    const spy = state?.spyId ? room.participants.get(state.spyId) : null;
    if (!state || !spy) {
      this.advanceCanceledSpyRound(room);
      return;
    }
    state.guessKind = kind;
    const initialColor = state.probes.at(-1)?.color ?? DEFAULT_COLOR;
    this.resetGuess(spy, initialColor);
    room.game.phase = "spyGuessing";
    const delay = room.game.settings.spyGuessSeconds * 1000;
    room.game.deadline = this.clock.now() + delay;
    this.schedulePhase(room, delay, () => this.finishSpyGuess(room));
    this.broadcast(room);
  }

  private updateSpyGuess(room: RoomState, participant: Participant, color: string): EventAck<undefined> {
    const state = room.game.spy;
    if (!state || participant.id !== state.spyId) return failure("NOT_ALLOWED", "Spy only");
    if (room.game.deadline !== null && this.clock.now() >= room.game.deadline) {
      this.finishSpyGuess(room);
      return failure("INVALID_PHASE", "Color selection ended");
    }
    const allowed = this.applyGuessUpdate(participant, color);
    if (!allowed.ok) return allowed;
    this.broadcast(room);
    return success(undefined);
  }

  private confirmSpyGuess(room: RoomState, participant: Participant, color: string): EventAck<undefined> {
    const state = room.game.spy;
    if (!state || participant.id !== state.spyId) return failure("NOT_ALLOWED", "Spy only");
    if (room.game.deadline !== null && this.clock.now() >= room.game.deadline) {
      this.finishSpyGuess(room);
      return failure("INVALID_PHASE", "Color selection ended");
    }
    if (participant.confirmed) return failure("ALREADY_CONFIRMED", "Color is locked");
    participant.lastColor = color;
    participant.confirmed = true;
    participant.confirmedAt = this.clock.now();
    this.finishSpyGuess(room);
    return success(undefined);
  }

  private finishSpyGuess(room: RoomState) {
    const state = room.game.spy;
    const spy = state?.spyId ? room.participants.get(state.spyId) : null;
    if (!state || !spy || !state.targetHex || room.game.phase !== "spyGuessing") return;
    this.clearPhaseTimer(room.code);
    spy.confirmed = true;
    const comparison = compareColors(spy.lastColor, state.targetHex);
    const result: SpyColorResult = {
      color: spy.lastColor,
      deltaE: comparison.deltaE,
      accuracy: comparison.accuracy,
    };
    if (state.guessKind === "probe") {
      state.probes.push(result);
      state.guessKind = null;
      this.startSpyHintCycle(room);
      return;
    }
    this.finishSpyRound(room, result);
  }

  private finishSpyRound(room: RoomState, finalGuess: SpyColorResult) {
    const state = room.game.spy;
    if (!state || !state.spyId || !state.targetHex) return;
    const spy = room.participants.get(state.spyId);
    const crewScore = calculateSpyCrewScore(
      state.roundPlayerIds.length,
      state.wrongEliminations,
      state.caught,
    );
    if (state.caught) {
      for (const participantId of state.roundPlayerIds) {
        if (participantId === state.spyId) continue;
        const participant = room.participants.get(participantId);
        if (participant) participant.score += crewScore;
      }
    }
    if (spy) spy.score += finalGuess.accuracy;
    state.guessKind = null;
    state.roundResult = {
      targetHex: state.targetHex,
      spyId: state.spyId,
      spyNickname: spy?.nickname ?? "",
      caught: state.caught,
      reachedOneOnOne: state.reachedOneOnOne,
      finalGuess,
      probes: [...state.probes],
      crewScore,
      spyScore: finalGuess.accuracy,
      eliminatedPlayerIds: [...state.eliminatedPlayerIds],
    };
    room.game.phase = "spyRoundReveal";
    room.game.revealPaused = false;
    room.game.revealRemainingMs = null;
    room.game.deadline = this.clock.now() + REVEAL_MS;
    this.schedulePhase(room, REVEAL_MS, () => this.advanceSpyRound(room));
    this.broadcast(room);
  }

  private advanceSpyRound(room: RoomState) {
    if (room.game.phase !== "spyRoundReveal") return;
    this.clearPhaseTimer(room.code);
    this.startSpyRound(room);
  }

  private advanceCanceledSpyRound(room: RoomState) {
    this.clearPhaseTimer(room.code);
    room.game.roundNumber = Math.max(0, room.game.roundNumber - 1);
    this.startSpyRound(room);
  }

  private startPrecisionTarget(room: RoomState) {
    this.clearPhaseTimer(room.code);
    if (room.game.roundNumber >= room.game.settings.precisionTargets) {
      this.finishGame(room);
      return;
    }
    if (room.game.roundNumber > 0) this.promotePendingPlayers(room);
    const players = this.connectedPlayers(room);
    if (players.length < 2) {
      this.finishGame(room);
      return;
    }
    room.game.roundNumber += 1;
    const roundPlayerIds = players.map((participant) => participant.id);
    room.game.precision = {
      roundPlayerIds,
      targetNumber: room.game.roundNumber,
      targetHex: this.generateRandomColor(),
      attemptNumber: 1,
      histories: new Map(roundPlayerIds.map((participantId) => [participantId, []])),
      currentResults: [],
      targetComplete: false,
    };
    for (const participantId of roundPlayerIds) {
      const participant = room.participants.get(participantId);
      if (participant) this.resetGuess(participant, DEFAULT_COLOR);
    }
    this.startPrecisionAttempt(room);
  }

  private startPrecisionAttempt(room: RoomState) {
    const state = room.game.precision;
    if (!state) return;
    state.currentResults = [];
    state.targetComplete = false;
    room.game.phase = "precisionGuessing";
    for (const participantId of state.roundPlayerIds) {
      const participant = room.participants.get(participantId);
      if (!participant) continue;
      this.resetGuess(participant, state.attemptNumber === 1 ? DEFAULT_COLOR : participant.lastColor);
    }
    const delay = room.game.settings.precisionAttemptSeconds * 1000;
    room.game.deadline = this.clock.now() + delay;
    this.schedulePhase(room, delay, () => this.finishPrecisionAttempt(room));
    this.broadcast(room);
  }

  private updatePrecisionGuess(room: RoomState, participant: Participant, color: string): EventAck<undefined> {
    const state = room.game.precision;
    if (!state || !state.roundPlayerIds.includes(participant.id)) {
      return failure("NOT_ALLOWED", "Current players only");
    }
    if (room.game.deadline !== null && this.clock.now() >= room.game.deadline) {
      this.finishPrecisionAttempt(room);
      return failure("INVALID_PHASE", "Color selection ended");
    }
    const allowed = this.applyGuessUpdate(participant, color);
    if (!allowed.ok) return allowed;
    this.emitPresence(room, participant);
    return success(undefined);
  }

  private confirmPrecisionGuess(room: RoomState, participant: Participant, color: string): EventAck<undefined> {
    const state = room.game.precision;
    if (!state || !state.roundPlayerIds.includes(participant.id)) {
      return failure("NOT_ALLOWED", "Current players only");
    }
    if (room.game.deadline !== null && this.clock.now() >= room.game.deadline) {
      this.finishPrecisionAttempt(room);
      return failure("INVALID_PHASE", "Color selection ended");
    }
    if (participant.confirmed) return failure("ALREADY_CONFIRMED", "Color is locked");
    participant.lastColor = color;
    participant.confirmed = true;
    participant.confirmedAt = this.clock.now();
    this.broadcast(room);
    if (state.roundPlayerIds.every((participantId) => room.participants.get(participantId)?.confirmed)) {
      this.finishPrecisionAttempt(room);
    }
    return success(undefined);
  }

  private finishPrecisionAttempt(room: RoomState) {
    const state = room.game.precision;
    if (!state || !state.targetHex || room.game.phase !== "precisionGuessing") return;
    this.clearPhaseTimer(room.code);
    const results: PrecisionAttemptResult[] = state.roundPlayerIds.flatMap((participantId) => {
      const participant = room.participants.get(participantId);
      if (!participant) return [];
      const comparison = compareColors(participant.lastColor, state.targetHex!);
      const result: PrecisionAttemptResult = {
        participantId,
        nickname: participant.nickname,
        attempt: state.attemptNumber,
        color: participant.lastColor,
        deltaE: comparison.deltaE,
        accuracy: comparison.accuracy,
        autoSubmitted: !participant.confirmed,
      };
      participant.confirmed = true;
      const history = state.histories.get(participantId) ?? [];
      history.push(result);
      state.histories.set(participantId, history);
      return [result];
    }).sort((first, second) => second.accuracy - first.accuracy);
    state.currentResults = results;
    state.targetComplete = results.some(
      (result) => result.accuracy >= room.game.settings.precisionTargetAccuracy,
    ) || state.attemptNumber >= room.game.settings.precisionMaxAttempts;
    if (state.targetComplete) {
      for (const result of results) {
        const participant = room.participants.get(result.participantId);
        if (participant) participant.score += result.accuracy;
      }
    }
    room.game.phase = "precisionResult";
    room.game.deadline = this.clock.now() + PRECISION_RESULT_MS;
    this.schedulePhase(room, PRECISION_RESULT_MS, () => {
      if (state.targetComplete) {
        this.startPrecisionTarget(room);
      } else {
        state.attemptNumber += 1;
        this.startPrecisionAttempt(room);
      }
    });
    this.broadcast(room);
  }

  private applyGuessUpdate(participant: Participant, color: string): EventAck<undefined> {
    if (participant.confirmed) return failure("ALREADY_CONFIRMED", "Color is locked");
    const now = this.clock.now();
    participant.lastColor = color;
    if (now - participant.lastGuessUpdateAt < 90) {
      // Keep the authoritative color current even when watcher broadcasts are throttled.
      return failure("RATE_LIMITED", "Color updates are too frequent");
    }
    participant.lastGuessUpdateAt = now;
    return success(undefined);
  }

  private resetGuess(participant: Participant, color: string) {
    participant.lastColor = color;
    participant.confirmed = false;
    participant.confirmedAt = null;
    participant.lastGuessUpdateAt = 0;
  }

  private advanceCurrentReveal(room: RoomState) {
    if (room.game.phase === "reveal") this.advanceClassicRound(room);
    else if (room.game.phase === "spyRoundReveal") this.advanceSpyRound(room);
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
      this.resetGuess(participant, DEFAULT_COLOR);
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

    let transitioned = false;
    if (room.game.phase !== "lobby" && room.game.phase !== "gameOver") {
      if (room.game.settings.mode === "spy") {
        transitioned = this.handleSpyExpiration(room, participant.id);
      } else if (room.game.settings.mode === "precision") {
        transitioned = this.handlePrecisionExpiration(room, participant.id);
      } else if (this.connectedPlayerCount(room) < 2) {
        this.resetToLobby(room, "notEnoughPlayers");
        transitioned = true;
      }
    }
    if (!transitioned) this.broadcast(room);
    if (
      room.participants.size === 0 ||
      (![...room.participants.values()].some((candidate) => candidate.connected) &&
        ![...room.participants.keys()].some((participantId) => this.disconnectTimers.has(participantId)))
    ) {
      this.destroyRoom(room);
      return;
    }
    if (explicit) this.scheduleCleanupIfEmpty(room);
  }

  private handleSpyExpiration(room: RoomState, participantId: string): boolean {
    const state = room.game.spy;
    if (
      !state ||
      !state.roundPlayerIds.includes(participantId) ||
      room.game.phase === "spyRoundReveal"
    ) return false;
    if (participantId === state.spyId) {
      this.advanceCanceledSpyRound(room);
      return true;
    }
    if (!state.alivePlayerIds.includes(participantId)) return false;

    state.alivePlayerIds = state.alivePlayerIds.filter((id) => id !== participantId);
    if (!state.eliminatedPlayerIds.includes(participantId)) {
      state.eliminatedPlayerIds.push(participantId);
      if (!state.caught && !state.reachedOneOnOne) state.wrongEliminations += 1;
    }
    state.votes.delete(participantId);
    for (const [voterId, choice] of state.votes) {
      if (choice === participantId) state.votes.delete(voterId);
    }
    const participant = room.participants.get(participantId);
    state.lastEliminated = {
      participantId,
      nickname: participant?.nickname ?? "",
      wasSpy: false,
    };

    if (
      state.alivePlayerIds.length <= 2 &&
      !(room.game.phase === "spyGuessing" && state.guessKind === "final")
    ) {
      state.reachedOneOnOne = true;
      this.startSpyGuessing(room, "final");
      return true;
    }
    if (
      room.game.phase === "spyHinting" &&
      state.hintOrder[state.hintIndex] === participantId
    ) {
      this.finishCurrentSpyHint(room, null);
      return true;
    }
    return false;
  }

  private handlePrecisionExpiration(room: RoomState, participantId: string): boolean {
    const state = room.game.precision;
    if (!state || !state.roundPlayerIds.includes(participantId)) return false;
    state.roundPlayerIds = state.roundPlayerIds.filter((id) => id !== participantId);
    state.histories.delete(participantId);
    state.currentResults = state.currentResults.filter((result) => result.participantId !== participantId);
    if (this.connectedPlayerCount(room) < 2) {
      this.resetToLobby(room, "notEnoughPlayers");
      return true;
    }
    if (
      room.game.phase === "precisionGuessing" &&
      state.roundPlayerIds.every((id) => room.participants.get(id)?.confirmed)
    ) {
      this.finishPrecisionAttempt(room);
      return true;
    }
    return false;
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
      let isWatcher = false;
      if (room.game.settings.mode === "classic") {
        isWatcher = recipient.id === room.game.pickerId || !room.game.roundGuesserIds.includes(recipient.id);
      } else if (room.game.settings.mode === "precision") {
        isWatcher = !room.game.precision?.roundPlayerIds.includes(recipient.id);
      }
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

  private destroyRoom(room: RoomState) {
    this.clearPhaseTimer(room.code);
    this.clearCleanup(room.code);
    this.rooms.delete(room.code);
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

  private connectedPlayers(room: RoomState) {
    return [...room.participants.values()].filter(
      (participant) => participant.role === "player" && participant.connected,
    );
  }

  private playerCount(room: RoomState) {
    return [...room.participants.values()].filter((participant) => participant.role === "player").length;
  }

  private connectedPlayerCount(room: RoomState) {
    return this.connectedPlayers(room).length;
  }

  private pendingPlayerCount(room: RoomState) {
    return [...room.participants.values()].filter((participant) => participant.pendingPlayer).length;
  }

  private promotePendingPlayers(room: RoomState) {
    const promoted: Participant[] = [];
    const pending = [...room.participants.values()]
      .filter((participant) => participant.pendingPlayer && participant.connected)
      .sort((first, second) => first.joinedAt - second.joinedAt);
    for (const participant of pending) {
      if (this.playerCount(room) >= MAX_PLAYERS) break;
      participant.role = "player";
      participant.pendingPlayer = false;
      promoted.push(participant);
    }
    return promoted;
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
      const code = Array.from(
        randomBytes(ROOM_CODE_LENGTH),
        (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]!,
      ).join("");
      if (!this.rooms.has(code)) return code;
    }
  }

  private generateRandomColor() {
    const channel = () => Math.floor(this.random() * 256).toString(16).padStart(2, "0");
    return `#${channel()}${channel()}${channel()}`.toUpperCase();
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
