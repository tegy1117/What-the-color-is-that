import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GuesserSnapshot } from "@wtcit/shared";
import { ColorPicker } from "../components/ColorPicker";
import { Countdown } from "../components/Countdown";
import { LockIcon } from "../components/Icons";
import { hexToHsv, hsvToHex, type HsvColor } from "../lib/color";
import styles from "../styles.module.css";

export function GuessingScreen({ snapshot, onUpdate, onConfirm }: { snapshot: GuesserSnapshot; onUpdate: (color: string) => void; onConfirm: (color: string) => void }) {
  const { t } = useTranslation();
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(snapshot.ownGuess.color));
  const lastSent = useRef(0);
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  useEffect(() => { setHsv(hexToHsv(snapshot.ownGuess.color)); }, [snapshot.roundNumber]);
  const color = hsvToHex(hsv);
  const changeColor = (next: HsvColor) => {
    if (snapshot.ownGuess.confirmed) return;
    setHsv(next);
    const now = performance.now();
    if (now - lastSent.current >= 100) {
      lastSent.current = now;
      onUpdate(hsvToHex(next));
    }
  };
  return (
    <main className={`${styles.page} ${styles.guessPage}`}>
      <div className={styles.gameMeta}><span>{t("game.round", { current: snapshot.roundNumber, total: snapshot.totalRounds })}</span><span>{t("game.picker", { name: snapshot.pickerNickname })}</span><Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={snapshot.settings.guessSeconds} /></div>
      <section className={styles.guessPanel}>
        <span className={styles.hintLabel}>{t("game.hint")}</span><h1 className={styles.hintText}>{snapshot.hint}</h1><div className={styles.dividerTitle}>{t("game.makeColor")}</div>
        <ColorPicker value={hsv} onChange={changeColor} disabled={snapshot.ownGuess.confirmed} />
        <div className={styles.currentColorRow}><div><span>{t("game.currentScore")}</span><strong>{self?.score ?? 0}</strong></div><i /><span className={styles.currentSwatch} style={{ backgroundColor: color }} aria-label={color} /></div>
        <button className={styles.primaryButton} type="button" disabled={snapshot.ownGuess.confirmed} onClick={() => onConfirm(color)}><LockIcon />{snapshot.ownGuess.confirmed ? t("game.locked") : t("game.confirmColor")}</button>
        <span className={styles.warning}><LockIcon />{t("game.irreversible")}</span>
      </section>
    </main>
  );
}

