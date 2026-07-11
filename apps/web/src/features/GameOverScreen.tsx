import { useTranslation } from "react-i18next";
import type { GameOverSnapshot } from "@wtcit/shared";
import { Ranking } from "../components/Ranking";
import styles from "../styles.module.css";

export function GameOverScreen({ snapshot, onBack }: { snapshot: GameOverSnapshot; onBack: () => void }) {
  const { t } = useTranslation();
  const isHost = snapshot.selfId === snapshot.hostId;
  return <main className={`${styles.page} ${styles.overPage}`}><section className={styles.winnerBlock}><span>{t("over.title")}</span><h1>{snapshot.winners.length > 1 ? t("over.sharedWinners") : t("over.winner")}</h1><div>{snapshot.winners.map((winner) => <strong key={winner.participantId}>{winner.nickname}</strong>)}</div></section><Ranking ranking={snapshot.ranking} title={t("over.finalRanking")} />{isHost ? <button className={styles.primaryButton} type="button" onClick={onBack}>{t("over.backLobby")}</button> : <p>{t("over.waitingHost")}</p>}</main>;
}

