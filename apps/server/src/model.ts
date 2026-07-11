import type {
  GamePhase,
  GameSettings,
  GuessResult,
  ParticipantRole,
  RevealData,
} from "@wtcit/shared";

export interface Participant {
  id: string;
  token: string;
  socketId: string | null;
  nickname: string;
  role: ParticipantRole;
  preferredRole: ParticipantRole;
  pendingPlayer: boolean;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  score: number;
  lastColor: string;
  confirmed: boolean;
  confirmedAt: number | null;
  lastGuessUpdateAt: number;
}

export interface GameState {
  phase: GamePhase;
  settings: GameSettings;
  cycleOrders: string[][];
  cycleIndex: number;
  pickerIndex: number;
  roundNumber: number;
  pickerId: string | null;
  candidates: string[];
  targetHex: string | null;
  hint: string;
  deadline: number | null;
  guessStartedAt: number | null;
  guessDeadline: number | null;
  roundGuesserIds: string[];
  reveal: RevealData | null;
  revealPaused: boolean;
  revealRemainingMs: number | null;
  skippedPickerNickname: string;
  results: GuessResult[];
}

export interface RoomState {
  code: string;
  hostId: string;
  participants: Map<string, Participant>;
  game: GameState;
  notice: "notEnoughPlayers" | null;
}

export interface Clock {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
};

