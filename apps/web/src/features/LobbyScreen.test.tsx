import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type LobbySnapshot } from "@wtcit/shared";
import i18n from "../i18n";
import { LobbyScreen } from "./LobbyScreen";

const snapshot: LobbySnapshot = {
  roomCode: "ABC23456",
  selfId: "host-id",
  hostId: "host-id",
  mode: "classic",
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
  onSettings = vi.fn(),
) {
  const view = render(
    <I18nextProvider i18n={i18n}>
      <LobbyScreen
        snapshot={value}
        onSettings={onSettings}
        onStart={vi.fn()}
        onRoleChange={onRoleChange}
        onKickPlayer={onKickPlayer}
      />
    </I18nextProvider>,
  );
  return { ...view, onRoleChange, onKickPlayer, onSettings };
}

describe("LobbyScreen", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("ko");
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(document, "execCommand");
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("copies the invite link without the Clipboard API", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    let copiedText = "";
    const execCommand = vi.fn(() => {
      copiedText = document.querySelector("textarea")?.value ?? "";
      return true;
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });

    renderLobby(snapshot);
    fireEvent.click(screen.getByRole("button", { name: "초대 링크 복사" }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(new URL(copiedText).searchParams.get("room")).toBe(snapshot.roomCode);
    expect(screen.getByRole("button", { name: "복사했어요" })).toBeInTheDocument();
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

  it("lets the host select a mode while preserving every other setting", () => {
    const onSettings = vi.fn();
    renderLobby(snapshot, vi.fn(), vi.fn(), onSettings);

    const spyButton = screen.getByRole("button", { name: "스파이" });
    expect(spyButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(spyButton);
    expect(onSettings).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, mode: "spy" });
  });

  it("uses the spy mode minimum of four connected players", () => {
    renderLobby({
      ...snapshot,
      mode: "spy",
      settings: { ...DEFAULT_SETTINGS, mode: "spy" },
    });

    expect(screen.getByRole("button", { name: "게임 시작" })).toBeDisabled();
    expect(screen.getByText("플레이어가 최소 4명 필요해요.")).toBeInTheDocument();
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
