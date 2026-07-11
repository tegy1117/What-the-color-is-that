import { useCallback, useEffect, useState } from "react";
import type {
  ErrorCode,
  EventAck,
  GameSettings,
  ParticipantRole,
  RoomSnapshot,
  SessionInfo,
} from "@wtcit/shared";
import { socket } from "../lib/socket";

const SESSION_KEY = "wtcit.session.v1";

function loadSession(): SessionInfo | null {
  try {
    const value = localStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) as SessionInfo : null;
  } catch {
    return null;
  }
}

function saveSession(session: SessionInfo | null) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function useGameSocket() {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [errorCode, setErrorCode] = useState<ErrorCode | "UNKNOWN" | null>(null);

  const handleResult = useCallback(<T,>(result: EventAck<T>) => {
    if (!result.ok && result.code !== "RATE_LIMITED") setErrorCode(result.code);
    return result;
  }, []);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      const session = loadSession();
      if (!session) return;
      socket.emit("session:resume", session, (result) => {
        if (!result.ok) {
          saveSession(null);
          setSnapshot(null);
          setErrorCode(result.code);
        }
      });
    };
    const onDisconnect = () => setConnected(false);
    const onSnapshot = (nextSnapshot: RoomSnapshot) => {
      setSnapshot(nextSnapshot);
      setErrorCode(null);
    };
    const onPresence = (presence: { participantId: string; color: string; confirmed: boolean }) => {
      setSnapshot((current) => {
        if (
          !current ||
          current.phase !== "guessing" ||
          (current.view !== "picker" && current.view !== "watcher")
        ) {
          return current;
        }
        return {
          ...current,
          liveGuesses: current.liveGuesses.map((guess) =>
            guess.participantId === presence.participantId
              ? { ...guess, color: presence.color, confirmed: presence.confirmed }
              : guess,
          ),
        };
      });
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:snapshot", onSnapshot);
    socket.on("guess:presence", onPresence);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:snapshot", onSnapshot);
      socket.off("guess:presence", onPresence);
    };
  }, []);

  const createRoom = useCallback((nickname: string, role: ParticipantRole) =>
    new Promise<EventAck<SessionInfo>>((resolve) => {
      socket.emit("room:create", { nickname, role }, (result) => {
        if (result.ok) saveSession(result.data);
        resolve(handleResult(result));
      });
    }), [handleResult]);

  const joinRoom = useCallback((roomCode: string, nickname: string, role: ParticipantRole) =>
    new Promise<EventAck<SessionInfo>>((resolve) => {
      socket.emit("room:join", { roomCode, nickname, role }, (result) => {
        if (result.ok) saveSession(result.data);
        resolve(handleResult(result));
      });
    }), [handleResult]);

  const leaveRoom = useCallback(() => {
    socket.emit("room:leave", () => {
      saveSession(null);
      setSnapshot(null);
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url);
    });
  }, []);

  const updateSettings = useCallback((settings: GameSettings) => {
    socket.emit("room:updateSettings", settings, handleResult);
  }, [handleResult]);

  const startGame = useCallback(() => socket.emit("game:start", handleResult), [handleResult]);
  const endGame = useCallback(() => socket.emit("game:end", handleResult), [handleResult]);
  const submitPicker = useCallback((targetHex: string, hint: string) =>
    socket.emit("picker:submit", { targetHex, hint }, handleResult), [handleResult]);
  const updateGuess = useCallback((color: string) =>
    socket.emit("guess:update", { color }, handleResult), [handleResult]);
  const confirmGuess = useCallback((color: string) =>
    socket.emit("guess:confirm", { color }, handleResult), [handleResult]);
  const advanceReveal = useCallback(() => socket.emit("reveal:advance", handleResult), [handleResult]);
  const pauseReveal = useCallback((paused: boolean) =>
    socket.emit("reveal:pause", { paused }, handleResult), [handleResult]);

  return {
    snapshot,
    connected,
    errorCode,
    clearError: () => setErrorCode(null),
    createRoom,
    joinRoom,
    leaveRoom,
    updateSettings,
    startGame,
    endGame,
    submitPicker,
    updateGuess,
    confirmGuess,
    advanceReveal,
    pauseReveal,
  };
}
