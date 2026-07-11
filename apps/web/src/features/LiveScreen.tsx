import { useTranslation } from "react-i18next";
import type { PickerLiveSnapshot, WatcherSnapshot } from "@wtcit/shared";
import { Countdown } from "../components/Countdown";
import { Ranking } from "../components/Ranking";
import { CheckIcon } from "../components/Icons";
import styles from "../styles.module.css";

export function LiveScreen({ snapshot }: { snapshot: PickerLiveSnapshot | WatcherSnapshot }) {
  const { t } = useTranslation();
  const confirmed = snapshot.liveGuesses.filter((guess) => guess.confirmed).length;
  return <main className={`${styles.page} ${styles.livePage}`}><div className={styles.gameMeta}><span>{t("game.round", { current: snapshot.roundNumber, total: snapshot.totalRounds })}</span><span>{t("game.picker", { name: snapshot.pickerNickname })}</span><Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={snapshot.settings.guessSeconds} /></div><section className={styles.liveHint}><span>{t("game.hint")}</span><h1>{snapshot.hint}</h1>{snapshot.view === "picker" ? <div className={styles.pickerTarget}><b>{t("game.targetForPicker")}</b><i style={{ backgroundColor: snapshot.targetHex }} /></div> : null}</section><div className={styles.liveLayout}><section className={styles.liveSelections}><header><h2>{t("game.liveSelection")}</h2><strong>{t("game.confirmationCount", { current: confirmed, total: snapshot.liveGuesses.length })}</strong></header><div className={styles.swatchGrid}>{snapshot.liveGuesses.map((guess) => <article key={guess.participantId}><div style={{ backgroundColor: guess.color }} /> <footer><strong>{guess.nickname}</strong><span>{guess.confirmed ? <CheckIcon /> : null}{guess.confirmed ? t("common.confirmed") : t("common.choosing")}</span></footer></article>)}</div></section><Ranking ranking={snapshot.ranking} /></div></main>;
}

