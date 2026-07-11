import { useTranslation } from "react-i18next";
import type { RevealSnapshot } from "@wtcit/shared";
import { Countdown } from "../components/Countdown";
import { ArrowIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { Ranking } from "../components/Ranking";
import styles from "../styles.module.css";

export function RevealScreen({ snapshot, onPause, onAdvance }: { snapshot: RevealSnapshot; onPause: (paused: boolean) => void; onAdvance: () => void }) {
  const { t } = useTranslation();
  const isHost = snapshot.selfId === snapshot.hostId;
  const selfResult = snapshot.reveal.results.find((result) => result.participantId === snapshot.selfId);
  const comparison = selfResult ?? snapshot.reveal.results[0] ?? null;
  return <main className={`${styles.page} ${styles.revealPage}`}><div className={styles.revealHeading}><span>{t("reveal.title")}</span><h1>{snapshot.reveal.hint}</h1></div><div className={styles.revealLayout}><section className={styles.comparison}><div className={styles.comparisonSwatches}><ColorResult label={t("reveal.target")} color={snapshot.reveal.targetHex} />{comparison ? <ColorResult label={selfResult ? t("reveal.mine") : t("reveal.closest")} color={comparison.color} /> : null}</div>{comparison ? <><div className={styles.similarity}><span>{t("reveal.similarity")}</span><strong>{t("reveal.similarityValue", { value: comparison.accuracy })}</strong><small>{t("reveal.difference")} · ΔE {comparison.deltaE.toFixed(1)}</small>{comparison.autoSubmitted ? <small>{t("reveal.autoSubmitted")}</small> : null}</div><div className={styles.scoreBreakdown}><span>{t("reveal.colorScore", { value: comparison.accuracyPoints })}</span><span>{t("reveal.speed", { value: comparison.speedPoints })}</span><strong>{t("reveal.roundScore", { value: comparison.roundScore })}</strong></div></> : null}<div className={styles.pickerScore}>{t("reveal.pickerScore", { value: snapshot.reveal.pickerScore })}<small>{snapshot.reveal.pickerNickname}</small></div><div className={styles.allResults}>{snapshot.reveal.results.map((result) => <div key={result.participantId}><i style={{ backgroundColor: result.color }} /><span>{result.nickname}</span><b>{t("reveal.similarityValue", { value: result.accuracy })}</b></div>)}</div></section><aside className={styles.resultRail}><Ranking ranking={snapshot.ranking} title={t("reveal.ranking")} /><div className={styles.revealControls}><Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={12} paused={snapshot.revealPaused} remainingMs={snapshot.revealRemainingMs} /><p>{snapshot.revealPaused ? t("reveal.paused") : t("reveal.nextIn", { seconds: Math.ceil(((snapshot.deadline ?? snapshot.serverNow) - snapshot.serverNow) / 1000) })}</p>{isHost ? <><button className={styles.secondaryButton} type="button" onClick={() => onPause(!snapshot.revealPaused)}>{snapshot.revealPaused ? <PlayIcon /> : <PauseIcon />}{snapshot.revealPaused ? t("reveal.resume") : t("reveal.pause")}</button><button className={styles.darkButton} type="button" onClick={onAdvance}>{t("reveal.next")}<ArrowIcon /></button></> : null}</div></aside></div></main>;
}

function ColorResult({ label, color }: { label: string; color: string }) {
  return <div><span>{label}</span><i style={{ backgroundColor: color }} /><strong>{color}</strong></div>;
}

