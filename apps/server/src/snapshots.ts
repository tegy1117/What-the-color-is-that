import type {
  BaseSnapshot,
  GameOverSnapshot,
  GuessResult,
  LiveGuess,
  ParticipantSummary,
  PrecisionHistory,
  PrecisionSnapshot,
  RankingEntry,
  RoomSnapshot,
  SpySnapshot,
  SpyVoteTally,
} from "@wtcit/shared";
import type { Participant, RoomState } from "./model";

function participantSummary(participant: Participant): ParticipantSummary {
  return {
    id: participant.id,
    nickname: participant.nickname,
    role: participant.role,
    connected: participant.connected,
    pendingPlayer: participant.pendingPlayer,
    score: participant.score,
  };
}

export function buildRanking(room: RoomState): RankingEntry[] {
  const players = [...room.participants.values()]
    .filter((participant) => participant.role === "player")
    .sort((first, second) => second.score - first.score || first.joinedAt - second.joinedAt);

  let previousScore: number | null = null;
  let previousRank = 0;
  return players.map((participant, index) => {
    if (previousScore !== participant.score) {
      previousScore = participant.score;
      previousRank = index + 1;
    }
    return {
      participantId: participant.id,
      nickname: participant.nickname,
      score: participant.score,
      rank: previousRank,
      connected: participant.connected,
    };
  });
}

function liveGuesses(room: RoomState, participantIds: string[]): LiveGuess[] {
  return participantIds.flatMap((participantId) => {
    const participant = room.participants.get(participantId);
    return participant
      ? [{
          participantId,
          nickname: participant.nickname,
          color: participant.lastColor,
          confirmed: participant.confirmed,
        }]
      : [];
  });
}

function totalRounds(room: RoomState) {
  if (room.game.settings.mode === "spy") return room.game.settings.spyRounds;
  if (room.game.settings.mode === "precision") return room.game.settings.precisionTargets;
  if (room.game.cycleOrders.length > 0) {
    return room.game.cycleOrders.reduce((total, order) => total + order.length, 0);
  }
  const players = [...room.participants.values()].filter(
    (participant) => participant.role === "player",
  ).length;
  return players * room.game.settings.cycles;
}

function baseSnapshot(room: RoomState, selfId: string, now: number): BaseSnapshot {
  const participants = [...room.participants.values()].sort(
    (first, second) => first.joinedAt - second.joinedAt,
  );
  const picker = room.game.pickerId
    ? room.participants.get(room.game.pickerId) ?? null
    : null;
  return {
    roomCode: room.code,
    selfId,
    hostId: room.hostId,
    mode: room.game.settings.mode,
    phase: room.game.phase,
    settings: room.game.settings,
    players: participants.filter((participant) => participant.role === "player").map(participantSummary),
    spectators: participants.filter((participant) => participant.role === "spectator").map(participantSummary),
    ranking: buildRanking(room),
    pickerId: picker?.id ?? null,
    pickerNickname: picker?.nickname ?? null,
    roundNumber: room.game.roundNumber,
    totalRounds: totalRounds(room),
    cycleNumber: room.game.settings.mode === "classic"
      ? (room.game.phase === "lobby" ? 0 : room.game.cycleIndex + 1)
      : room.game.roundNumber,
    serverNow: now,
    deadline: room.game.deadline,
    revealPaused: room.game.revealPaused,
    revealRemainingMs: room.game.revealRemainingMs,
    notice: room.notice,
  };
}

function spyTallies(room: RoomState): SpyVoteTally[] {
  const state = room.game.spy;
  if (!state) return [];
  const counts = new Map<string, number>();
  for (const choice of state.votes.values()) {
    counts.set(choice, (counts.get(choice) ?? 0) + 1);
  }
  const candidates = state.alivePlayerIds.flatMap((participantId) => {
    const participant = room.participants.get(participantId);
    return participant
      ? [{
          choice: participantId,
          nickname: participant.nickname,
          count: counts.get(participantId) ?? 0,
        }]
      : [];
  });
  return [
    ...candidates,
    { choice: "abstain", nickname: null, count: counts.get("abstain") ?? 0 },
  ];
}

function buildSpySnapshot(
  room: RoomState,
  selfId: string,
  base: BaseSnapshot,
): SpySnapshot {
  const state = room.game.spy;
  if (!state) throw new Error("Spy phase requires spy state");
  const isRoundPlayer = state.roundPlayerIds.includes(selfId);
  const isSpy = selfId === state.spyId;
  const isSpectator = !isRoundPlayer;
  const isReveal = room.game.phase === "spyRoundReveal";
  const canSeeSpy = isSpy || isSpectator || isReveal;
  const canSeeTarget = !isSpy || isSpectator || isReveal;
  const canSeeSpyChoices = isSpy || isSpectator || isReveal;
  const spy = state.spyId ? room.participants.get(state.spyId) ?? null : null;
  return {
    ...base,
    phase: room.game.phase as SpySnapshot["phase"],
    view: "spy",
    spyRole: isSpectator ? "spectator" : isSpy ? "spy" : "crew",
    spyId: canSeeSpy ? state.spyId : null,
    targetHex: canSeeTarget ? state.targetHex : null,
    roundPlayerIds: [...state.roundPlayerIds],
    alivePlayerIds: [...state.alivePlayerIds],
    eliminatedPlayerIds: [...state.eliminatedPlayerIds],
    hintCycle: state.hintCycle,
    currentHintPlayerId: room.game.phase === "spyHinting"
      ? state.hintOrder[state.hintIndex] ?? null
      : null,
    hints: [...state.hints],
    voteTallies: spyTallies(room),
    ownVote: state.votes.get(selfId) ?? null,
    votesCast: state.votes.size,
    eligibleVoters: state.alivePlayerIds.length,
    voteInvalid: state.voteInvalid,
    lastEliminated: state.lastEliminated,
    guessKind: state.guessKind,
    probes: canSeeSpyChoices ? [...state.probes] : [],
    spyCurrentColor: canSeeSpyChoices ? spy?.lastColor ?? null : null,
    roundResult: isReveal ? state.roundResult : null,
  };
}

function precisionHistories(room: RoomState): PrecisionHistory[] {
  const state = room.game.precision;
  if (!state) return [];
  return state.roundPlayerIds.flatMap((participantId) => {
    const participant = room.participants.get(participantId);
    return participant
      ? [{
          participantId,
          nickname: participant.nickname,
          results: [...(state.histories.get(participantId) ?? [])],
        }]
      : [];
  });
}

function buildPrecisionSnapshot(
  room: RoomState,
  selfId: string,
  base: BaseSnapshot,
): PrecisionSnapshot {
  const state = room.game.precision;
  if (!state) throw new Error("Precision phase requires precision state");
  const isRoundPlayer = state.roundPlayerIds.includes(selfId);
  const isSpectator = !isRoundPlayer;
  const self = room.participants.get(selfId);
  const targetVisible = isSpectator || (room.game.phase === "precisionResult" && state.targetComplete);
  return {
    ...base,
    phase: room.game.phase as PrecisionSnapshot["phase"],
    view: isSpectator ? "precisionSpectator" : "precisionPlayer",
    targetNumber: state.targetNumber,
    totalTargets: room.game.settings.precisionTargets,
    attemptNumber: state.attemptNumber,
    maxAttempts: room.game.settings.precisionMaxAttempts,
    targetHex: targetVisible ? state.targetHex : null,
    targetComplete: state.targetComplete,
    ownGuess: isRoundPlayer && room.game.phase === "precisionGuessing" && self
      ? { color: self.lastColor, confirmed: self.confirmed }
      : null,
    ownHistory: isRoundPlayer ? [...(state.histories.get(selfId) ?? [])] : [],
    liveGuesses: isSpectator ? liveGuesses(room, state.roundPlayerIds) : [],
    attemptResults: isSpectator
      ? [...state.currentResults]
      : state.currentResults.filter((result) => result.participantId === selfId),
    histories: isSpectator ? precisionHistories(room) : [],
  };
}

export function buildSnapshot(room: RoomState, selfId: string, now: number): RoomSnapshot {
  const base = baseSnapshot(room, selfId, now);
  const self = room.participants.get(selfId);

  if (room.game.phase === "lobby") {
    return { ...base, phase: "lobby", view: "lobby" };
  }

  if (room.game.phase === "gameOver") {
    const ranking = buildRanking(room);
    const firstScore = ranking[0]?.score ?? 0;
    const gameOver: GameOverSnapshot = {
      ...base,
      phase: "gameOver",
      view: "gameOver",
      winners: ranking.filter((entry) => entry.score === firstScore),
    };
    return gameOver;
  }

  if (room.game.settings.mode === "spy") {
    return buildSpySnapshot(room, selfId, base);
  }

  if (room.game.settings.mode === "precision") {
    return buildPrecisionSnapshot(room, selfId, base);
  }

  if (room.game.phase === "pickerPrep") {
    if (selfId === room.game.pickerId) {
      return {
        ...base,
        phase: "pickerPrep",
        view: "picker",
        candidates: room.game.candidates,
      };
    }
    return { ...base, phase: "pickerPrep", view: "watcher" };
  }

  if (room.game.phase === "guessing") {
    if (selfId === room.game.pickerId) {
      return {
        ...base,
        phase: "guessing",
        view: "picker",
        hint: room.game.hint,
        targetHex: room.game.targetHex ?? "#808080",
        liveGuesses: liveGuesses(room, room.game.roundGuesserIds),
      };
    }
    if (self && room.game.roundGuesserIds.includes(selfId)) {
      return {
        ...base,
        phase: "guessing",
        view: "guesser",
        hint: room.game.hint,
        ownGuess: {
          color: self.lastColor,
          confirmed: self.confirmed,
        },
      };
    }
    return {
      ...base,
      phase: "guessing",
      view: "watcher",
      hint: room.game.hint,
      liveGuesses: liveGuesses(room, room.game.roundGuesserIds),
    };
  }

  if (room.game.phase === "reveal") {
    if (!room.game.reveal) throw new Error("Reveal phase requires reveal data");
    return {
      ...base,
      phase: "reveal",
      view: "reveal",
      reveal: room.game.reveal,
    };
  }

  if (room.game.phase === "roundSkipped") {
    return {
      ...base,
      phase: "roundSkipped",
      view: "roundSkipped",
      skippedPickerNickname: room.game.skippedPickerNickname,
    };
  }

  throw new Error(`Unsupported game phase: ${room.game.phase}`);
}

export function resultForParticipant(
  results: GuessResult[],
  participantId: string,
): GuessResult | null {
  return results.find((result) => result.participantId === participantId) ?? null;
}
