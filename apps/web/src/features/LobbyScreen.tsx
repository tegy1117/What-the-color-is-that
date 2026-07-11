import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CYCLE_OPTIONS, TIME_OPTIONS, type GameSettings, type LobbySnapshot } from "@wtcit/shared";
import { CheckIcon, CopyIcon } from "../components/Icons";
import styles from "../styles.module.css";

interface LobbyScreenProps {
  snapshot: LobbySnapshot;
  onSettings: (settings: GameSettings) => void;
  onStart: () => void;
}

export function LobbyScreen({ snapshot, onSettings, onStart }: LobbyScreenProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const isHost = snapshot.selfId === snapshot.hostId;
  const copyLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", snapshot.roomCode);
    await navigator.clipboard.writeText(url.toString());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  const setSetting = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    onSettings({ ...snapshot.settings, [key]: value });
  };

  return (
    <main className={`${styles.page} ${styles.lobbyPage}`}>
      {snapshot.notice === "notEnoughPlayers" ? <div className={styles.notice}>{t("lobby.notEnoughPlayers")}</div> : null}
      <section className={styles.roomCodeBlock}>
        <span>{t("lobby.roomCode")}</span>
        <strong>{snapshot.roomCode}</strong>
        <button type="button" className={styles.copyButton} onClick={() => void copyLink()}>{copied ? <CheckIcon /> : <CopyIcon />}{copied ? t("lobby.copied") : t("lobby.copyLink")}</button>
      </section>
      <div className={styles.lobbyGrid}>
        <section className={styles.roster}>
          <div>
            <h2>{t("lobby.players", { current: snapshot.players.length })}</h2>
            <ul>{snapshot.players.map((player) => <li key={player.id}><span>{player.nickname}{player.id === snapshot.hostId ? <small>{t("common.host")}</small> : null}</span><b>{player.connected ? t("common.connected") : t("common.disconnected")}</b></li>)}</ul>
          </div>
          <div>
            <h2>{t("lobby.spectators", { current: snapshot.spectators.length })}</h2>
            {snapshot.spectators.length ? <ul>{snapshot.spectators.map((spectator) => <li key={spectator.id}><span>{spectator.nickname}{spectator.pendingPlayer ? <small>{t("common.pending")}</small> : null}</span><b>{spectator.connected ? t("common.connected") : t("common.disconnected")}</b></li>)}</ul> : <p>{t("lobby.empty")}</p>}
          </div>
        </section>
        <section className={styles.settings}>
          <h2>{t("lobby.settings")}</h2>
          <SettingRow title={t("lobby.guessTime")} values={TIME_OPTIONS} value={snapshot.settings.guessSeconds} disabled={!isHost} format={(value) => t("lobby.seconds", { value })} onChange={(value) => setSetting("guessSeconds", value)} />
          <SettingRow title={t("lobby.pickerTime")} values={TIME_OPTIONS} value={snapshot.settings.pickerSeconds} disabled={!isHost} format={(value) => t("lobby.seconds", { value })} onChange={(value) => setSetting("pickerSeconds", value)} />
          <SettingRow title={t("lobby.cycles")} values={CYCLE_OPTIONS} value={snapshot.settings.cycles} disabled={!isHost} format={(value) => t("lobby.cycleCount", { value })} onChange={(value) => setSetting("cycles", value)} />
          {!isHost ? <p>{t("lobby.waitingHost")}</p> : null}
        </section>
      </div>
      {isHost ? <div className={styles.stickyAction}><button className={styles.primaryButton} type="button" onClick={onStart} disabled={snapshot.players.filter((player) => player.connected).length < 2}>{t("lobby.start")}</button>{snapshot.players.filter((player) => player.connected).length < 2 ? <span>{t("lobby.needPlayers")}</span> : null}</div> : null}
    </main>
  );
}

function SettingRow<T extends number>({ title, values, value, disabled, format, onChange }: { title: string; values: readonly T[]; value: T; disabled: boolean; format: (value: T) => string; onChange: (value: T) => void }) {
  return <fieldset className={styles.settingRow} disabled={disabled}><legend>{title}</legend><div className={styles.segmented}>{values.map((option) => <button type="button" key={option} className={value === option ? styles.selected : ""} onClick={() => onChange(option)}>{format(option)}</button>)}</div></fieldset>;
}

