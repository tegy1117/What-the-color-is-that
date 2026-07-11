import { useTranslation } from "react-i18next";
import type { GameSettings, RoomSnapshot } from "@wtcit/shared";
import { BrandHeader } from "../components/BrandHeader";
import { GameOverScreen } from "./GameOverScreen";
import { GuessingScreen } from "./GuessingScreen";
import { LiveScreen } from "./LiveScreen";
import { LobbyScreen } from "./LobbyScreen";
import { PickerPrepScreen } from "./PickerPrepScreen";
import { RevealScreen } from "./RevealScreen";
import { WaitingScreen } from "./WaitingScreen";
import styles from "../styles.module.css";

interface GameScreenProps {
  snapshot: RoomSnapshot;
  connected: boolean;
  onLeave: () => void;
  onSettings: (settings: GameSettings) => void;
  onStart: () => void;
  onEnd: () => void;
  onPickerSubmit: (target: string, hint: string) => void;
  onGuessUpdate: (color: string) => void;
  onGuessConfirm: (color: string) => void;
  onRevealPause: (paused: boolean) => void;
  onRevealAdvance: () => void;
}

export function GameScreen(props: GameScreenProps) {
  const { t } = useTranslation();
  const { snapshot } = props;
  let content: React.ReactNode;
  if (snapshot.phase === "lobby") content = <LobbyScreen snapshot={snapshot} onSettings={props.onSettings} onStart={props.onStart} />;
  else if (snapshot.phase === "pickerPrep" && snapshot.view === "picker") content = <PickerPrepScreen snapshot={snapshot} onSubmit={props.onPickerSubmit} />;
  else if (snapshot.phase === "pickerPrep") content = <WaitingScreen snapshot={snapshot} />;
  else if (snapshot.phase === "guessing" && snapshot.view === "guesser") content = <GuessingScreen snapshot={snapshot} onUpdate={props.onGuessUpdate} onConfirm={props.onGuessConfirm} />;
  else if (snapshot.phase === "guessing") content = <LiveScreen snapshot={snapshot} />;
  else if (snapshot.phase === "reveal") content = <RevealScreen snapshot={snapshot} onPause={props.onRevealPause} onAdvance={props.onRevealAdvance} />;
  else if (snapshot.phase === "roundSkipped") content = <main className={`${styles.page} ${styles.skippedPage}`}><span className={styles.waitingDots}><i /><i /><i /></span><h1>{t("game.skipped", { name: snapshot.skippedPickerNickname })}</h1></main>;
  else content = <GameOverScreen snapshot={snapshot} onBack={props.onEnd} />;

  return <div className={styles.appShell}><BrandHeader inRoom canEndGame={snapshot.phase !== "lobby" && snapshot.selfId === snapshot.hostId} onLeave={props.onLeave} onEndGame={props.onEnd} />{!props.connected ? <div className={styles.connectionBanner}>{t("status.reconnecting")}</div> : null}{content}</div>;
}

