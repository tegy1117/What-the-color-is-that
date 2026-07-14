import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type SpySnapshot } from "@wtcit/shared";
import i18n from "../i18n";
import { SpyScreen } from "./SpyScreen";

const snapshot: SpySnapshot = {
  roomCode: "ABC23456",
  selfId: "player-a",
  hostId: "player-a",
  mode: "spy",
  phase: "spyVoting",
  view: "spy",
  settings: { ...DEFAULT_SETTINGS, mode: "spy" },
  players: [
    { id: "player-a", nickname: "민지", role: "player", connected: true, pendingPlayer: false, score: 0 },
    { id: "player-b", nickname: "준호", role: "player", connected: true, pendingPlayer: false, score: 0 },
    { id: "player-c", nickname: "수아", role: "player", connected: true, pendingPlayer: false, score: 0 },
    { id: "player-d", nickname: "도윤", role: "player", connected: true, pendingPlayer: false, score: 0 },
  ],
  spectators: [],
  ranking: [],
  pickerId: null,
  pickerNickname: null,
  roundNumber: 1,
  totalRounds: 4,
  cycleNumber: 1,
  serverNow: 1_000,
  deadline: 31_000,
  revealPaused: false,
  revealRemainingMs: null,
  notice: null,
  spyRole: "crew",
  spyId: null,
  targetHex: "#336699",
  roundPlayerIds: ["player-a", "player-b", "player-c", "player-d"],
  alivePlayerIds: ["player-a", "player-b", "player-c", "player-d"],
  eliminatedPlayerIds: [],
  hintCycle: 1,
  currentHintPlayerId: null,
  hints: [
    { participantId: "player-a", nickname: "민지", cycle: 1, hint: "비 오는 하늘" },
  ],
  voteTallies: [
    { choice: "player-a", nickname: "민지", count: 1 },
    { choice: "player-b", nickname: "준호", count: 2 },
    { choice: "player-c", nickname: "수아", count: 0 },
    { choice: "player-d", nickname: "도윤", count: 0 },
    { choice: "abstain", nickname: null, count: 0 },
  ],
  ownVote: "player-a",
  votesCast: 3,
  eligibleVoters: 4,
  voteInvalid: false,
  lastEliminated: null,
  guessKind: null,
  probes: [],
  spyCurrentColor: null,
  roundResult: null,
};

describe("SpyScreen", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ko");
  });

  afterEach(cleanup);

  it("shows only aggregate vote counts and lets a player revise their vote", () => {
    const onVote = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <SpyScreen snapshot={snapshot} onHint={vi.fn()} onVote={onVote} onUpdate={vi.fn()} onConfirm={vi.fn()} onPause={vi.fn()} onAdvance={vi.fn()} />
      </I18nextProvider>,
    );

    expect(screen.getByRole("button", { name: /민지 1표/u })).toHaveAttribute("aria-pressed", "true");
    const abstain = screen.getByRole("button", { name: /기권 0표/u });
    expect(abstain).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(abstain);
    expect(onVote).toHaveBeenCalledWith("abstain");
    expect(screen.queryByText(/민지가 준호/u)).not.toBeInTheDocument();
  });
});
