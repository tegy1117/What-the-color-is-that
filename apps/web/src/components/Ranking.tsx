import { useTranslation } from "react-i18next";
import type { RankingEntry } from "@wtcit/shared";
import styles from "../styles.module.css";

interface RankingProps {
  ranking: RankingEntry[];
  title?: string;
}

export function Ranking({ ranking, title }: RankingProps) {
  const { t } = useTranslation();
  return (
    <section className={styles.ranking} aria-label={title ?? t("game.liveRanking")}>
      <h2>{title ?? t("game.liveRanking")}</h2>
      <ol>
        {ranking.map((entry) => (
          <li key={entry.participantId}>
            <strong>{entry.rank}</strong>
            <span>{entry.nickname}</span>
            <b>{entry.score}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}

