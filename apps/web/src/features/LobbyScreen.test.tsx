import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type LobbySnapshot } from "@wtcit/shared";
import i18n from "../i18n";
import { LobbyScreen } from "./LobbyScreen";

const snapshot: LobbySnapshot = {
  roomCode: "ABC234",
  selfId: "host-id",
  hostId: "host-id",
  phase: "lobby",
  view: "lobby",
  settings: DEFAULT_SETTINGS,
  players: [
    {
      id: "host-id",
      nickname: "민지",
      role: "player",
      connected: true,
      pendingPlayer: false,
      score: 0,
    },
    {
      id: "player-id",
      nickname: "준호",
      role: "player",
      connected: true,
      pendingPlayer: false,
      score: 0,
    },
  ],
  spectators: [],
  ranking: [],
  pickerId: null,
  pickerNickname: null,
  roundNumber: 0,
  totalRounds: 2,
  cycleNumber: 0,
  serverNow: 1_000,
  deadline: null,
  revealPaused: false,
  revealRemainingMs: null,
  notice: null,
};

function renderLobby(
  value: LobbySnapshot,
  onRoleChange = vi.fn(),
  onKickPlayer = vi.fn(),
) {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <LobbyScreen
        snapshot={value}
        onSettings={vi.fn()}
        onStart={vi.fn()}
        onRoleChange={onRoleChange}
        onKickPlayer={onKickPlayer}
      />
    </I18nextProvider>,
  );
  return { ...view, onRoleChange, onKickPlayer };
}

describe("LobbyScreen", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ko");
  });

  afterEach(() => {
    cleanup();
  });

  it("lets a participant choose their own role from inside the lobby", () => {
    const onRoleChange = vi.fn();
    renderLobby(snapshot, onRoleChange);

    expect(screen.getByRole("button", { name: "플레이어" })).toHaveAttribute("aria-pressed", "true");
    const spectatorButton = screen.getByRole("button", { name: "관전자" });
    expect(spectatorButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(spectatorButton);

    expect(onRoleChange).toHaveBeenCalledWith("spectator");
  });

  it("shows player kick controls only to the host", () => {
    const onKickPlayer = vi.fn();
    const { rerender } = renderLobby(snapshot, vi.fn(), onKickPlayer);

    fireEvent.click(screen.getByRole("button", { name: "준호 내보내기" }));
    expect(onKickPlayer).toHaveBeenCalledWith("player-id");
    expect(screen.queryByRole("button", { name: "민지 내보내기" })).not.toBeInTheDocument();

    rerender(
      <I18nextProvider i18n={i18n}>
        <LobbyScreen
          snapshot={{ ...snapshot, selfId: "player-id" }}
          onSettings={vi.fn()}
          onStart={vi.fn()}
          onRoleChange={vi.fn()}
          onKickPlayer={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("button", { name: /내보내기/u })).not.toBeInTheDocument();
  });
});
