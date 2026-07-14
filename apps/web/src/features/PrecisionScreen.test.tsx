import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type PrecisionSnapshot } from "@wtcit/shared";
import i18n from "../i18n";
import { PrecisionScreen } from "./PrecisionScreen";

const snapshot: PrecisionSnapshot = {
  roomCode: "ABC23456",
  selfId: "player-a",
  hostId: "player-a",
  mode: "precision",
  phase: "precisionGuessing",
  view: "precisionPlayer",
  settings: { ...DEFAULT_SETTINGS, mode: "precision" },
  players: [
    { id: "player-a", nickname: "민지", role: "player", connected: true, pendingPlayer: false, score: 42 },
    { id: "player-b", nickname: "준호", role: "player", connected: true, pendingPlayer: false, score: 30 },
  ],
  spectators: [],
  ranking: [],
  pickerId: null,
  pickerNickname: null,
  roundNumber: 1,
  totalRounds: 2,
  cycleNumber: 1,
  serverNow: 1_000,
  deadline: 61_000,
  revealPaused: false,
  revealRemainingMs: null,
  notice: null,
  targetNumber: 1,
  totalTargets: 2,
  attemptNumber: 2,
  maxAttempts: 5,
  targetHex: null,
  targetComplete: false,
  ownGuess: { color: "#808080", confirmed: false },
  ownHistory: [
    { participantId: "player-a", nickname: "민지", attempt: 1, color: "#336699", deltaE: 20, accuracy: 78, autoSubmitted: false },
  ],
  liveGuesses: [],
  attemptResults: [],
  histories: [],
};

describe("PrecisionScreen", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ko");
  });

  afterEach(cleanup);

  it("restores a previous color from the player's private history", () => {
    const onUpdate = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PrecisionScreen snapshot={snapshot} onUpdate={onUpdate} onConfirm={vi.fn()} />
      </I18nextProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /1차 78%/u }));
    expect(onUpdate).toHaveBeenCalledWith("#336699");
    expect(screen.queryByText("준호")).not.toBeInTheDocument();
  });
});
