import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PickerPrepSnapshot } from "@wtcit/shared";
import { CheckIcon, LockIcon } from "../components/Icons";
import { Countdown } from "../components/Countdown";
import styles from "../styles.module.css";

export function PickerPrepScreen({ snapshot, onSubmit }: { snapshot: PickerPrepSnapshot; onSubmit: (target: string, hint: string) => void }) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("");
  const [hint, setHint] = useState("");
  useEffect(() => { setSelected(""); setHint(""); }, [snapshot.roundNumber]);
  return (
    <main className={`${styles.page} ${styles.playPage}`}>
      <div className={styles.gameMeta}><span>{t("game.round", { current: snapshot.roundNumber, total: snapshot.totalRounds })}</span><span>{t("game.pickerTurn", { name: snapshot.pickerNickname })}</span><Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={snapshot.settings.pickerSeconds} /></div>
      <section className={styles.pickerPrep}>
        <h1>{t("game.chooseColor")}</h1><p>{t("game.chooseOne")}</p>
        <div className={styles.candidateGrid}>{snapshot.candidates.map((color) => <button key={color} type="button" className={selected === color ? styles.candidateSelected : ""} style={{ backgroundColor: color }} onClick={() => setSelected(color)} aria-label={color}>{selected === color ? <CheckIcon /> : null}</button>)}</div>
        <label className={styles.hintField}>{t("game.hint")}<textarea value={hint} onChange={(event) => setHint(event.target.value)} maxLength={80} placeholder={t("game.hintPlaceholder")} /></label>
        <button className={styles.primaryButton} type="button" disabled={!selected || !hint.trim()} onClick={() => onSubmit(selected, hint)}><LockIcon />{t("game.submitPicker")}</button>
        <span className={styles.warning}><LockIcon />{t("game.irreversible")}</span>
      </section>
    </main>
  );
}

