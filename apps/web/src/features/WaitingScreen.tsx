import { useTranslation } from "react-i18next";
import type { WaitingSnapshot } from "@wtcit/shared";
import { Countdown } from "../components/Countdown";
import { Ranking } from "../components/Ranking";
import styles from "../styles.module.css";

export function WaitingScreen({ snapshot }: { snapshot: WaitingSnapshot }) {
  const { t } = useTranslation();
  return <main className={`${styles.page} ${styles.waitingPage}`}><div className={styles.gameMeta}><span>{t("game.round", { current: snapshot.roundNumber, total: snapshot.totalRounds })}</span><span>{t("game.picker", { name: snapshot.pickerNickname })}</span><Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={snapshot.settings.pickerSeconds} /></div><div className={styles.waitingGrid}><section className={styles.waitingMessage}><span className={styles.waitingDots}><i /><i /><i /></span><h1>{t("game.waitingPicker", { name: snapshot.pickerNickname })}</h1></section><Ranking ranking={snapshot.ranking} /></div></main>;
}

