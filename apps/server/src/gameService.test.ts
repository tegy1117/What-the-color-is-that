import { describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@wtcit/shared";
import { GameService, MAX_ACTIVE_ROOMS, type EventSink } from "./gameService";

function createHarness() {
  vi.useFakeTimers();
  let now = 1_000;
  const snapshots = new Map<string, RoomSnapshot>();
  const kickedSockets = new Set<string>();
  const sink: EventSink = {
    snapshot: (socketId, snapshot) => snapshots.set(socketId, snapshot),
    presence: () => undefined,
    kicked: (socketId) => kickedSockets.add(socketId),
  };
  let randomState = 11;
  const random = () => {
    randomState = (randomState * 48271) % 2147483647;
    return randomState / 2147483647;
  };
  const service = new GameService(sink, {
    now: () => now,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  }, random);
  return {
    service,
    snapshots,
    kickedSockets,
    setNow: (value: number) => { now = value; },
  };
}

function createTwoPlayerRoom(harness: ReturnType<typeof createHarness>) {
  const created = harness.service.createRoom("socket-a", { nickname: "민지", role: "player" });
  if (!created.ok) throw new Error(created.message);
  const joined = harness.service.joinRoom("socket-b", {
    roomCode: created.data.roomCode,
    nickname: "준호",
    role: "player",
  });
  if (!joined.ok) throw new Error(joined.message);
  return { created: created.data, joined: joined.data };
}

function createThreePlayerRoom(harness: ReturnType<typeof createHarness>) {
  const sessions = createTwoPlayerRoom(harness);
  const third = harness.service.joinRoom("socket-c", {
    roomCode: sessions.created.roomCode,
    nickname: "수아",
    role: "player",
  });
  if (!third.ok) throw new Error(third.message);
  return { ...sessions, third: third.data };
}

function startGuessing(harness: ReturnType<typeof createHarness>) {
  createTwoPlayerRoom(harness);
  const started = harness.service.startGame("socket-a");
  if (!started.ok) throw new Error(started.message);
  const snapshotA = harness.snapshots.get("socket-a")!;
  const pickerSocket = snapshotA.view === "picker" ? "socket-a" : "socket-b";
  const guesserSocket = pickerSocket === "socket-a" ? "socket-b" : "socket-a";
  const picker = harness.snapshots.get(pickerSocket)!;
  if (picker.phase !== "pickerPrep" || picker.view !== "picker") {
    throw new Error("picker snapshot missing");
  }
  const target = picker.candidates[0]!;
  const submitted = harness.service.submitPicker(pickerSocket, {
    targetHex: target,
    hint: "정답 힌트",
  });
  if (!submitted.ok) throw new Error(submitted.message);
  return { guesserSocket, target };
}

describe("GameService", () => {
  it("keeps picker candidates secret from non-pickers", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);
    expect(harness.service.startGame("socket-a").ok).toBe(true);
    const first = harness.snapshots.get("socket-a")!;
    const second = harness.snapshots.get("socket-b")!;
    const picker = first.view === "picker" ? first : second;
    const watcher = first.view === "watcher" ? first : second;
    expect(picker.phase).toBe("pickerPrep");
    expect("candidates" in picker).toBe(true);
    expect("candidates" in watcher).toBe(false);
    expect(sessions.created.roomCode).toHaveLength(8);
    expect(sessions.created.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/u);
  });

  it("caps the total number of active rooms", () => {
    const harness = createHarness();
    for (let index = 0; index < MAX_ACTIVE_ROOMS; index += 1) {
      expect(harness.service.createRoom(`socket-${index}`, {
        nickname: `방장${index}`,
        role: "player",
      }).ok).toBe(true);
    }

    expect(harness.service.createRoom("socket-over-limit", {
      nickname: "초과",
      role: "player",
    })).toMatchObject({ ok: false, code: "RATE_LIMITED" });

    expect(harness.service.leaveRoom("socket-0").ok).toBe(true);
    expect(harness.service.createRoom("socket-replacement", {
      nickname: "교체",
      role: "player",
    }).ok).toBe(true);
  });

  it("never sends target or other guesses to a guesser", () => {
    const harness = createHarness();
    createTwoPlayerRoom(harness);
    harness.service.startGame("socket-a");
    const snapshotA = harness.snapshots.get("socket-a")!;
    const pickerSocket = snapshotA.view === "picker" ? "socket-a" : "socket-b";
    const guesserSocket = pickerSocket === "socket-a" ? "socket-b" : "socket-a";
    const pickerSnapshot = harness.snapshots.get(pickerSocket)!;
    if (pickerSnapshot.phase !== "pickerPrep" || pickerSnapshot.view !== "picker") {
      throw new Error("picker snapshot missing");
    }
    harness.service.submitPicker(pickerSocket, {
      targetHex: pickerSnapshot.candidates[0],
      hint: "비 온 뒤 하늘",
    });
    const guesser = harness.snapshots.get(guesserSocket)!;
    expect(guesser.view).toBe("guesser");
    expect("targetHex" in guesser).toBe(false);
    expect("liveGuesses" in guesser).toBe(false);
  });

  it("reveals immediately after every guesser confirms and awards both roles", () => {
    const harness = createHarness();
    createTwoPlayerRoom(harness);
    harness.service.startGame("socket-a");
    const a = harness.snapshots.get("socket-a")!;
    const pickerSocket = a.view === "picker" ? "socket-a" : "socket-b";
    const guesserSocket = pickerSocket === "socket-a" ? "socket-b" : "socket-a";
    const picker = harness.snapshots.get(pickerSocket)!;
    if (picker.phase !== "pickerPrep" || picker.view !== "picker") throw new Error("picker missing");
    const target = picker.candidates[0]!;
    harness.service.submitPicker(pickerSocket, { targetHex: target, hint: "정답 힌트" });
    harness.setNow(2_000);
    expect(harness.service.confirmGuess(guesserSocket, { color: target }).ok).toBe(true);
    const reveal = harness.snapshots.get(guesserSocket)!;
    expect(reveal.phase).toBe("reveal");
    if (reveal.phase !== "reveal") return;
    expect(reveal.reveal.results[0]?.accuracy).toBe(100);
    expect(reveal.reveal.pickerScore).toBe(150);
    expect(reveal.ranking.map((entry) => entry.score).sort((x, y) => y - x)).toEqual([150, 99]);
  });

  it("queues a mid-game player for the next round with zero points", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);
    harness.service.startGame("socket-a");
    const late = harness.service.joinRoom("socket-c", {
      roomCode: sessions.created.roomCode,
      nickname: "수아",
      role: "player",
    });
    expect(late.ok).toBe(true);
    if (!late.ok) throw new Error(late.message);
    const snapshot = harness.snapshots.get("socket-c")!;
    const self = snapshot.spectators.find((entry) => entry.id === late.data.participantId);
    expect(self?.pendingPlayer).toBe(true);
    expect(self?.score).toBe(0);
  });

  it("keeps each socket bound to one session", () => {
    const harness = createHarness();
    const first = harness.service.createRoom("socket-a", { nickname: "민지", role: "player" });
    if (!first.ok) throw new Error(first.message);

    expect(harness.service.createRoom("socket-a", { nickname: "중복", role: "player" }))
      .toMatchObject({ ok: false, code: "NOT_ALLOWED" });

    const other = harness.service.createRoom("socket-b", { nickname: "준호", role: "player" });
    if (!other.ok) throw new Error(other.message);
    expect(harness.service.joinRoom("socket-a", {
      roomCode: other.data.roomCode,
      nickname: "수아",
      role: "player",
    })).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(harness.service.resumeSession("socket-a", other.data))
      .toMatchObject({ ok: false, code: "NOT_ALLOWED" });
    expect(harness.service.getSnapshot(first.data.roomCode, first.data.participantId)).not.toBeNull();
  });

  it("resumes a session during the reconnect grace period", () => {
    const harness = createHarness();
    const sessions = createThreePlayerRoom(harness);
    harness.service.startGame("socket-a");
    harness.service.disconnect("socket-c");

    expect(harness.service.resumeSession("socket-d", sessions.third).ok).toBe(true);
  });

  it("preserves connected-session takeover", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);

    expect(harness.service.resumeSession("socket-c", sessions.joined).ok).toBe(true);
    harness.service.disconnect("socket-b");
    const snapshot = harness.snapshots.get("socket-c")!;
    expect(snapshot.players.find((player) => player.id === sessions.joined.participantId)?.connected)
      .toBe(true);
  });

  it("assigns a host when a participant reconnects after the previous host expires", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);
    harness.service.disconnect("socket-a");
    vi.advanceTimersByTime(1_000);
    harness.setNow(2_000);
    harness.service.disconnect("socket-b");
    harness.setNow(31_000);
    vi.advanceTimersByTime(29_000);

    expect(harness.service.resumeSession("socket-c", sessions.joined).ok).toBe(true);
    expect(harness.snapshots.get("socket-c")?.hostId).toBe(sessions.joined.participantId);
  });

  it("assigns a host when someone joins after the previous host expires", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);
    harness.service.disconnect("socket-a");
    vi.advanceTimersByTime(1_000);
    harness.setNow(2_000);
    harness.service.disconnect("socket-b");
    harness.setNow(31_000);
    vi.advanceTimersByTime(29_000);

    const joined = harness.service.joinRoom("socket-c", {
      roomCode: sessions.created.roomCode,
      nickname: "수아",
      role: "player",
    });
    expect(joined.ok).toBe(true);
    if (joined.ok) {
      expect(harness.snapshots.get("socket-c")?.hostId).toBe(joined.data.participantId);
    }
  });

  it("deletes a room when its final reconnect grace period expires", () => {
    const harness = createHarness();
    const created = harness.service.createRoom("socket-a", { nickname: "민지", role: "player" });
    if (!created.ok) throw new Error(created.message);
    harness.service.disconnect("socket-a");
    vi.advanceTimersByTime(30_000);

    expect(harness.service.joinRoom("socket-b", {
      roomCode: created.data.roomCode,
      nickname: "준호",
      role: "player",
    })).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
  });

  it("deletes an active game room when every reconnect grace period expires", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);
    expect(harness.service.startGame("socket-a").ok).toBe(true);
    harness.service.disconnect("socket-a");
    harness.service.disconnect("socket-b");
    vi.advanceTimersByTime(30_000);

    expect(harness.service.joinRoom("socket-c", {
      roomCode: sessions.created.roomCode,
      nickname: "수아",
      role: "player",
    })).toMatchObject({ ok: false, code: "ROOM_NOT_FOUND" });
  });

  it("rejects session resume at the reconnect deadline before the timer runs", () => {
    const harness = createHarness();
    const sessions = createThreePlayerRoom(harness);
    harness.service.startGame("socket-a");
    harness.service.disconnect("socket-c");
    harness.setNow(31_000);

    expect(harness.service.resumeSession("socket-d", sessions.third))
      .toMatchObject({ ok: false, code: "SESSION_EXPIRED" });
  });

  it("rejects session resume after the reconnect grace period", () => {
    const harness = createHarness();
    const sessions = createThreePlayerRoom(harness);
    harness.service.startGame("socket-a");
    harness.service.disconnect("socket-c");
    vi.advanceTimersByTime(30_000);

    expect(harness.service.resumeSession("socket-d", sessions.third))
      .toMatchObject({ ok: false, code: "SESSION_EXPIRED" });
  });

  it("rejects session resume after an explicit leave", () => {
    const harness = createHarness();
    const sessions = createThreePlayerRoom(harness);
    harness.service.startGame("socket-a");
    harness.service.leaveRoom("socket-c");

    expect(harness.service.resumeSession("socket-d", sessions.third))
      .toMatchObject({ ok: false, code: "SESSION_EXPIRED" });
  });

  it("expires a picker submission at the authoritative deadline", () => {
    const harness = createHarness();
    createTwoPlayerRoom(harness);
    harness.service.startGame("socket-a");
    const first = harness.snapshots.get("socket-a")!;
    const pickerSocket = first.view === "picker" ? "socket-a" : "socket-b";
    const picker = harness.snapshots.get(pickerSocket)!;
    if (picker.phase !== "pickerPrep" || picker.view !== "picker" || picker.deadline === null) {
      throw new Error("picker snapshot missing");
    }

    harness.setNow(picker.deadline);
    expect(harness.service.submitPicker(pickerSocket, {
      targetHex: picker.candidates[0],
      hint: "늦은 힌트",
    })).toMatchObject({ ok: false, code: "INVALID_PHASE" });
    expect(harness.snapshots.get(pickerSocket)?.phase).toBe("roundSkipped");
  });

  it("auto-submits a guess when an update reaches the deadline", () => {
    const harness = createHarness();
    const { guesserSocket, target } = startGuessing(harness);
    const guessing = harness.snapshots.get(guesserSocket)!;
    if (guessing.phase !== "guessing" || guessing.deadline === null) {
      throw new Error("guessing snapshot missing");
    }

    harness.setNow(guessing.deadline);
    expect(harness.service.updateGuess(guesserSocket, { color: target }))
      .toMatchObject({ ok: false, code: "INVALID_PHASE" });
    const reveal = harness.snapshots.get(guesserSocket)!;
    expect(reveal.phase).toBe("reveal");
    if (reveal.phase === "reveal") {
      expect(reveal.reveal.results[0]?.autoSubmitted).toBe(true);
    }
  });

  it("auto-submits a guess when confirmation reaches the deadline", () => {
    const harness = createHarness();
    const { guesserSocket, target } = startGuessing(harness);
    const guessing = harness.snapshots.get(guesserSocket)!;
    if (guessing.phase !== "guessing" || guessing.deadline === null) {
      throw new Error("guessing snapshot missing");
    }

    harness.setNow(guessing.deadline);
    expect(harness.service.confirmGuess(guesserSocket, { color: target }))
      .toMatchObject({ ok: false, code: "INVALID_PHASE" });
    const reveal = harness.snapshots.get(guesserSocket)!;
    expect(reveal.phase).toBe("reveal");
    if (reveal.phase === "reveal") {
      expect(reveal.reveal.results[0]?.autoSubmitted).toBe(true);
    }
  });

  it("releases an expired participant when the game returns to the lobby", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);
    harness.service.startGame("socket-a");
    harness.service.disconnect("socket-b");
    vi.advanceTimersByTime(30_000);

    const rejoined = harness.service.joinRoom("socket-c", {
      roomCode: sessions.created.roomCode,
      nickname: "준호",
      role: "player",
    });
    expect(rejoined.ok).toBe(true);
  });

  it("lets participants change their own role in the lobby only", () => {
    const harness = createHarness();
    createTwoPlayerRoom(harness);

    expect(harness.service.updateRole("socket-b", { role: "spectator" }).ok).toBe(true);
    expect(harness.snapshots.get("socket-a")?.spectators.map((entry) => entry.nickname))
      .toContain("준호");

    expect(harness.service.updateRole("socket-b", { role: "player" }).ok).toBe(true);
    expect(harness.service.startGame("socket-a").ok).toBe(true);
    expect(harness.service.updateRole("socket-b", { role: "spectator" }))
      .toMatchObject({ ok: false, code: "INVALID_PHASE" });
  });

  it("lets only the host kick another player and invalidates the kicked session", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);

    expect(harness.service.kickPlayer("socket-b", {
      participantId: sessions.created.participantId,
    })).toMatchObject({ ok: false, code: "NOT_HOST" });
    expect(harness.service.kickPlayer("socket-a", {
      participantId: sessions.created.participantId,
    })).toMatchObject({ ok: false, code: "NOT_ALLOWED" });

    expect(harness.service.kickPlayer("socket-a", {
      participantId: sessions.joined.participantId,
    }).ok).toBe(true);
    expect(harness.kickedSockets).toContain("socket-b");
    expect(harness.snapshots.get("socket-a")?.players.map((entry) => entry.id))
      .not.toContain(sessions.joined.participantId);
    expect(harness.service.getSnapshot(
      sessions.created.roomCode,
      sessions.joined.participantId,
    )).toBeNull();
    expect(harness.service.resumeSession("socket-c", sessions.joined))
      .toMatchObject({ ok: false, code: "SESSION_EXPIRED" });
  });

  it("does not let the host kick a player after the game starts", () => {
    const harness = createHarness();
    const sessions = createThreePlayerRoom(harness);
    expect(harness.service.startGame("socket-a").ok).toBe(true);

    expect(harness.service.kickPlayer("socket-a", {
      participantId: sessions.third.participantId,
    })).toMatchObject({ ok: false, code: "INVALID_PHASE" });
    expect(harness.service.getSnapshot(
      sessions.created.roomCode,
      sessions.third.participantId,
    )).not.toBeNull();
  });

  it("lets the host remove a disconnected player and invalidates reconnect", () => {
    const harness = createHarness();
    const sessions = createTwoPlayerRoom(harness);
    harness.service.disconnect("socket-b");

    expect(harness.service.kickPlayer("socket-a", {
      participantId: sessions.joined.participantId,
    }).ok).toBe(true);
    expect(harness.service.resumeSession("socket-c", sessions.joined))
      .toMatchObject({ ok: false, code: "SESSION_EXPIRED" });
  });

  it("does not let the host kick a spectator", () => {
    const harness = createHarness();
    const created = harness.service.createRoom("socket-a", { nickname: "민지", role: "player" });
    if (!created.ok) throw new Error(created.message);
    const spectator = harness.service.joinRoom("socket-b", {
      roomCode: created.data.roomCode,
      nickname: "준호",
      role: "spectator",
    });
    if (!spectator.ok) throw new Error(spectator.message);

    expect(harness.service.kickPlayer("socket-a", {
      participantId: spectator.data.participantId,
    })).toMatchObject({ ok: false, code: "NOT_ALLOWED" });
  });

  it("uses shared ranks for tied totals", () => {
    const harness = createHarness();
    createTwoPlayerRoom(harness);
    const snapshot = harness.snapshots.get("socket-a")!;
    expect(snapshot.ranking.map((entry) => entry.rank)).toEqual([1, 1]);
  });
});
