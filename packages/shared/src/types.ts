export const TIME_OPTIONS = [30, 45, 60, 90] as const;
export const CYCLE_OPTIONS = [1, 2, 3] as const;
export const PRECISION_TARGET_OPTIONS = [1, 2, 3] as const;
export const MAX_PLAYERS = 10;
export const MAX_SPECTATORS = 20;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 8;
export const DEFAULT_COLOR = "#808080";

export const GAME_SETTING_LIMITS = {
  spyRounds: { minimum: 1, maximum: 20 },
  seconds: { minimum: 5, maximum: 300 },
  precisionTargetAccuracy: { minimum: 1, maximum: 100 },
  precisionMaxAttempts: { minimum: 1, maximum: 20 },
} as const;

export type TimeOption = (typeof TIME_OPTIONS)[number];
export type CycleOption = (typeof CYCLE_OPTIONS)[number];
export type PrecisionTargetOption = (typeof PRECISION_TARGET_OPTIONS)[number];
export type Locale = "ko" | "en";
export type ParticipantRole = "player" | "spectator";
export type GameMode = "classic" | "spy" | "precision";
export type GamePhase =
  | "lobby"
  | "pickerPrep"
  | "guessing"
  | "reveal"
  | "roundSkipped"
  | "spyHinting"
  | "spyDiscussion"
  | "spyVoting"
  | "spyGuessing"
  | "spyRoundReveal"
  | "precisionGuessing"
  | "precisionResult"
  | "gameOver";

export interface GameSettings {
  mode: GameMode;
  guessSeconds: TimeOption;
  pickerSeconds: TimeOption;
  cycles: CycleOption;
  spyRounds: number;
  spyHintSeconds: number;
  spyDiscussionSeconds: number;
  spyVoteSeconds: number;
  spyGuessSeconds: number;
  precisionTargetAccuracy: number;
  precisionMaxAttempts: number;
  precisionAttemptSeconds: number;
  precisionTargets: PrecisionTargetOption;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mode: "classic",
  guessSeconds: 60,
  pickerSeconds: 60,
  cycles: 1,
  spyRounds: 4,
  spyHintSeconds: 60,
  spyDiscussionSeconds: 30,
  spyVoteSeconds: 30,
  spyGuessSeconds: 30,
  precisionTargetAccuracy: 95,
  precisionMaxAttempts: 5,
  precisionAttemptSeconds: 60,
  precisionTargets: 2,
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

export interface SpyHintEntry {
  participantId: string;
  nickname: string;
  cycle: number;
  hint: string | null;
}

export type SpyVoteChoice = string | "abstain";

export interface SpyVoteTally {
  choice: SpyVoteChoice;
  nickname: string | null;
  count: number;
}

export interface SpyColorResult {
  color: string;
  deltaE: number;
  accuracy: number;
}

export interface SpyElimination {
  participantId: string;
  nickname: string;
  wasSpy: boolean;
}

export interface SpyRoundResult {
  targetHex: string;
  spyId: string;
  spyNickname: string;
  caught: boolean;
  reachedOneOnOne: boolean;
  finalGuess: SpyColorResult;
  probes: SpyColorResult[];
  crewScore: number;
  spyScore: number;
  eliminatedPlayerIds: string[];
}

export interface PrecisionAttemptResult {
  participantId: string;
  nickname: string;
  attempt: number;
  color: string;
  deltaE: number;
  accuracy: number;
  autoSubmitted: boolean;
}

export interface PrecisionHistory {
  participantId: string;
  nickname: string;
  results: PrecisionAttemptResult[];
}

export interface BaseSnapshot {
  roomCode: string;
  selfId: string;
  hostId: string;
  mode: GameMode;
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

export interface SpySnapshot extends BaseSnapshot {
  phase:
    | "spyHinting"
    | "spyDiscussion"
    | "spyVoting"
    | "spyGuessing"
    | "spyRoundReveal";
  view: "spy";
  spyRole: "spy" | "crew" | "spectator";
  spyId: string | null;
  targetHex: string | null;
  roundPlayerIds: string[];
  alivePlayerIds: string[];
  eliminatedPlayerIds: string[];
  hintCycle: number;
  currentHintPlayerId: string | null;
  hints: SpyHintEntry[];
  voteTallies: SpyVoteTally[];
  ownVote: SpyVoteChoice | null;
  votesCast: number;
  eligibleVoters: number;
  voteInvalid: boolean;
  lastEliminated: SpyElimination | null;
  guessKind: "probe" | "final" | null;
  probes: SpyColorResult[];
  spyCurrentColor: string | null;
  roundResult: SpyRoundResult | null;
}

export interface PrecisionSnapshot extends BaseSnapshot {
  phase: "precisionGuessing" | "precisionResult";
  view: "precisionPlayer" | "precisionSpectator";
  targetNumber: number;
  totalTargets: number;
  attemptNumber: number;
  maxAttempts: number;
  targetHex: string | null;
  targetComplete: boolean;
  ownGuess: {
    color: string;
    confirmed: boolean;
  } | null;
  ownHistory: PrecisionAttemptResult[];
  liveGuesses: LiveGuess[];
  attemptResults: PrecisionAttemptResult[];
  histories: PrecisionHistory[];
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
  | SpySnapshot
  | PrecisionSnapshot
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
  "spy:submitHint": (payload: unknown, ack: Ack<undefined>) => void;
  "spy:vote": (payload: unknown, ack: Ack<undefined>) => void;
  "reveal:advance": (ack: Ack<undefined>) => void;
  "reveal:pause": (payload: unknown, ack: Ack<undefined>) => void;
  "session:resume": (payload: unknown, ack: Ack<SessionInfo>) => void;
}

export interface ServerToClientEvents {
  "room:snapshot": (snapshot: RoomSnapshot) => void;
  "room:kicked": () => void;
  "guess:presence": (presence: GuessPresence) => void;
}
