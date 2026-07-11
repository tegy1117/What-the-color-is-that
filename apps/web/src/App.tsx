import { useTranslation } from "react-i18next";
import { EntryScreen } from "./features/EntryScreen";
import { GameScreen } from "./features/GameScreen";
import { useGameSocket } from "./hooks/useGameSocket";
import styles from "./styles.module.css";

export function App() {
  const { t } = useTranslation();
  const game = useGameSocket();
  return <>{game.errorCode ? <button type="button" className={styles.errorBanner} onClick={game.clearError}>{t(`errors.${game.errorCode}`, { defaultValue: t("errors.UNKNOWN") })}</button> : null}{game.snapshot ? <GameScreen snapshot={game.snapshot} connected={game.connected} onLeave={game.leaveRoom} onSettings={game.updateSettings} onStart={game.startGame} onEnd={game.endGame} onPickerSubmit={game.submitPicker} onGuessUpdate={game.updateGuess} onGuessConfirm={game.confirmGuess} onRevealPause={game.pauseReveal} onRevealAdvance={game.advanceReveal} /> : <EntryScreen onCreate={game.createRoom} onJoin={game.joinRoom} />}</>;
}

