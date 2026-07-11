import type {
  BaseSnapshot,
  GameOverSnapshot,
  GuessResult,
  LiveGuess,
  ParticipantSummary,
  RankingEntry,
  RoomSnapshot,
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

function liveGuesses(room: RoomState): LiveGuess[] {
  return room.game.roundGuesserIds.flatMap((participantId) => {
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
    phase: room.game.phase,
    settings: room.game.settings,
    players: participants.filter((participant) => participant.role === "player").map(participantSummary),
    spectators: participants.filter((participant) => participant.role === "spectator").map(participantSummary),
    ranking: buildRanking(room),
    pickerId: picker?.id ?? null,
    pickerNickname: picker?.nickname ?? null,
    roundNumber: room.game.roundNumber,
    totalRounds: totalRounds(room),
    cycleNumber: room.game.phase === "lobby" ? 0 : room.game.cycleIndex + 1,
    serverNow: now,
    deadline: room.game.deadline,
    revealPaused: room.game.revealPaused,
    revealRemainingMs: room.game.revealRemainingMs,
    notice: room.notice,
  };
}

export function buildSnapshot(room: RoomState, selfId: string, now: number): RoomSnapshot {
  const base = baseSnapshot(room, selfId, now);
  const self = room.participants.get(selfId);

  if (room.game.phase === "lobby") {
    return { ...base, phase: "lobby", view: "lobby" };
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
        liveGuesses: liveGuesses(room),
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
      liveGuesses: liveGuesses(room),
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

export function resultForParticipant(
  results: GuessResult[],
  participantId: string,
): GuessResult | null {
  return results.find((result) => result.participantId === participantId) ?? null;
}

