export const TIME_OPTIONS = [30, 45, 60, 90] as const;
export const CYCLE_OPTIONS = [1, 2, 3] as const;
export const MAX_PLAYERS = 10;
export const MAX_SPECTATORS = 20;
export const DEFAULT_COLOR = "#808080";

export type TimeOption = (typeof TIME_OPTIONS)[number];
export type CycleOption = (typeof CYCLE_OPTIONS)[number];
export type Locale = "ko" | "en";
export type ParticipantRole = "player" | "spectator";
export type GamePhase =
  | "lobby"
  | "pickerPrep"
  | "guessing"
  | "reveal"
  | "roundSkipped"
  | "gameOver";

export interface GameSettings {
  guessSeconds: TimeOption;
  pickerSeconds: TimeOption;
  cycles: CycleOption;
}

export const DEFAULT_SETTINGS: GameSettings = {
  guessSeconds: 60,
  pickerSeconds: 60,
  cycles: 1,
};

export interface ParticipantSummary {
  id: string;
  nickname: string;
  role: ParticipantRole;
  connected: boolean;
  pendingPlayer: boolean;
  score: number;
}

export interface RankingEntry {
  participantId: string;
  nickname: string;
  score: number;
  rank: number;
  connected: boolean;
}

export interface LiveGuess {
  participantId: string;
  nickname: string;
  color: string;
  confirmed: boolean;
}

export interface GuessResult extends LiveGuess {
  deltaE: number;
  accuracy: number;
  rawTime: number;
  accuracyPoints: number;
  speedPoints: number;
  roundScore: number;
  autoSubmitted: boolean;
}

export interface RevealData {
  targetHex: string;
  hint: string;
  results: GuessResult[];
  pickerId: string;
  pickerNickname: string;
  pickerScore: number;
}

export interface BaseSnapshot {
  roomCode: string;
  selfId: string;
  hostId: string;
  phase: GamePhase;
  settings: GameSettings;
  players: ParticipantSummary[];
  spectators: ParticipantSummary[];
  ranking: RankingEntry[];
  pickerId: string | null;
  pickerNickname: string | null;
  roundNumber: number;
  totalRounds: number;
  cycleNumber: number;
  serverNow: number;
  deadline: number | null;
  revealPaused: boolean;
  revealRemainingMs: number | null;
  notice: "notEnoughPlayers" | null;
}

export interface LobbySnapshot extends BaseSnapshot {
  phase: "lobby";
  view: "lobby";
}

export interface PickerPrepSnapshot extends BaseSnapshot {
  phase: "pickerPrep";
  view: "picker";
  candidates: string[];
}

export interface WaitingSnapshot extends BaseSnapshot {
  phase: "pickerPrep";
  view: "watcher";
}

export interface GuesserSnapshot extends BaseSnapshot {
  phase: "guessing";
  view: "guesser";
  hint: string;
  ownGuess: {
    color: string;
    confirmed: boolean;
  };
}

export interface PickerLiveSnapshot extends BaseSnapshot {
  phase: "guessing";
  view: "picker";
  hint: string;
  targetHex: string;
  liveGuesses: LiveGuess[];
}

export interface WatcherSnapshot extends BaseSnapshot {
  phase: "guessing";
  view: "watcher";
  hint: string;
  liveGuesses: LiveGuess[];
}

export interface RevealSnapshot extends BaseSnapshot {
  phase: "reveal";
  view: "reveal";
  reveal: RevealData;
}

export interface RoundSkippedSnapshot extends BaseSnapshot {
  phase: "roundSkipped";
  view: "roundSkipped";
  skippedPickerNickname: string;
}

export interface GameOverSnapshot extends BaseSnapshot {
  phase: "gameOver";
  view: "gameOver";
  winners: RankingEntry[];
}

export type RoomSnapshot =
  | LobbySnapshot
  | PickerPrepSnapshot
  | WaitingSnapshot
  | GuesserSnapshot
  | PickerLiveSnapshot
  | WatcherSnapshot
  | RevealSnapshot
  | RoundSkippedSnapshot
  | GameOverSnapshot;

export interface SessionInfo {
  roomCode: string;
  participantId: string;
  token: string;
}

export type ErrorCode =
  | "INVALID_PAYLOAD"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "NAME_TAKEN"
  | "NOT_HOST"
  | "INVALID_PHASE"
  | "NOT_ALLOWED"
  | "ALREADY_CONFIRMED"
  | "RATE_LIMITED"
  | "SESSION_EXPIRED"
  | "KICKED";

export type EventAck<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string };

export interface GuessPresence {
  participantId: string;
  color: string;
  confirmed: boolean;
}

type Ack<T> = (result: EventAck<T>) => void;

export interface ClientToServerEvents {
  "room:create": (payload: unknown, ack: Ack<SessionInfo>) => void;
  "room:join": (payload: unknown, ack: Ack<SessionInfo>) => void;
  "room:leave": (ack: Ack<undefined>) => void;
  "room:updateRole": (payload: unknown, ack: Ack<undefined>) => void;
  "room:kickPlayer": (payload: unknown, ack: Ack<undefined>) => void;
  "room:updateSettings": (payload: unknown, ack: Ack<undefined>) => void;
  "game:start": (ack: Ack<undefined>) => void;
  "game:end": (ack: Ack<undefined>) => void;
  "picker:submit": (payload: unknown, ack: Ack<undefined>) => void;
  "guess:update": (payload: unknown, ack: Ack<undefined>) => void;
  "guess:confirm": (payload: unknown, ack: Ack<undefined>) => void;
  "reveal:advance": (ack: Ack<undefined>) => void;
  "reveal:pause": (payload: unknown, ack: Ack<undefined>) => void;
  "session:resume": (payload: unknown, ack: Ack<SessionInfo>) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (snapshot: RoomSnapshot) => void;
  "room:kicked": () => void;
  "guess:presence": (presence: GuessPresence) => void;
}

