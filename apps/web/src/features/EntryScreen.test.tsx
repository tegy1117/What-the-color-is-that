import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { EntryScreen } from "./EntryScreen";

describe("EntryScreen", () => {
  beforeEach(async () => {
    window.history.replaceState({}, "", "/");
    await i18n.changeLanguage("ko");
  });

  afterEach(() => cleanup());

  it("accepts and submits an eight-character room code", () => {
    const onJoin = vi.fn().mockResolvedValue(undefined);
    render(
      <I18nextProvider i18n={i18n}>
        <EntryScreen onCreate={vi.fn().mockResolvedValue(undefined)} onJoin={onJoin} />
      </I18nextProvider>,
    );

    const roomCode = screen.getByRole("textbox", { name: "방 코드" });
    expect(roomCode).toHaveAttribute("minlength", "8");
    expect(roomCode).toHaveAttribute("maxlength", "8");
    expect(roomCode).toHaveAttribute("placeholder", "8자리 코드");
    fireEvent.change(roomCode, { target: { value: "abcio-23456789" } });
    expect(roomCode).toHaveValue("ABC23456");

    fireEvent.change(screen.getAllByRole("textbox", { name: "닉네임" })[1]!, {
      target: { value: "민지" },
    });
    fireEvent.click(screen.getByRole("button", { name: "입장하기" }));

    expect(onJoin).toHaveBeenCalledWith("ABC23456", "민지", "player");
  });
});
