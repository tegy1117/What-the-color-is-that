import { cleanup, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type RevealSnapshot } from "@wtcit/shared";
import i18n from "../i18n";
import { RevealScreen } from "./RevealScreen";

const snapshot: RevealSnapshot = {
  roomCode: "ABC23456",
  selfId: "player-a",
  hostId: "player-a",
  mode: "classic",
  phase: "reveal",
  view: "reveal",
  settings: DEFAULT_SETTINGS,
  players: [],
  spectators: [],
  ranking: [],
  pickerId: "picker-id",
  pickerNickname: "민지",
  roundNumber: 1,
  totalRounds: 2,
  cycleNumber: 1,
  serverNow: 1_000,
  deadline: 13_000,
  revealPaused: false,
  revealRemainingMs: null,
  notice: null,
  reveal: {
    targetHex: "#336699",
    hint: "비 오는 날의 하늘",
    pickerId: "picker-id",
    pickerNickname: "민지",
    pickerScore: 120,
    results: [
      {
        participantId: "player-a",
        nickname: "준호",
        color: "#6699CC",
        confirmed: true,
        deltaE: 20,
        accuracy: 78,
        rawTime: 50,
        accuracyPoints: 55,
        speedPoints: 12,
        roundScore: 67,
        autoSubmitted: false,
      },
      {
        participantId: "player-b",
        nickname: "수아",
        color: "#3B6E9F",
        confirmed: true,
        deltaE: 10,
        accuracy: 94,
        rawTime: 40,
        accuracyPoints: 66,
        speedPoints: 11,
        roundScore: 77,
        autoSubmitted: false,
      },
    ],
  },
};

describe("RevealScreen", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ko");
  });

  afterEach(() => {
    cleanup();
  });

  it("presents similarity percentages as the primary human-readable result", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RevealScreen snapshot={snapshot} onPause={vi.fn()} onAdvance={vi.fn()} />
      </I18nextProvider>,
    );

    expect(screen.getByText("색상 유사도")).toBeInTheDocument();
    expect(screen.getAllByText("78% 유사")).toHaveLength(2);
    expect(screen.getByText("94% 유사")).toBeInTheDocument();
    expect(screen.getByText("색상 거리 · ΔE 20.0")).toBeInTheDocument();
    expect(screen.getByText("색상 점수 +55")).toBeInTheDocument();
  });
});
