import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_COLOR, type PrecisionAttemptResult, type PrecisionSnapshot } from "@wtcit/shared";
import { ColorPicker } from "../components/ColorPicker";
import { Countdown } from "../components/Countdown";
import { CheckIcon, LockIcon } from "../components/Icons";
import { Ranking } from "../components/Ranking";
import { hexToHsv, hsvToHex, type HsvColor } from "../lib/color";
import styles from "../styles.module.css";

interface PrecisionScreenProps {
  snapshot: PrecisionSnapshot;
  onUpdate: (color: string) => void;
  onConfirm: (color: string) => void;
}

export function PrecisionScreen({ snapshot, onUpdate, onConfirm }: PrecisionScreenProps) {
  const { t } = useTranslation();
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(snapshot.ownGuess?.color ?? DEFAULT_COLOR));
  const lastSent = useRef(0);
  useEffect(() => {
    setHsv(hexToHsv(snapshot.ownGuess?.color ?? snapshot.ownHistory.at(-1)?.color ?? DEFAULT_COLOR));
    lastSent.current = 0;
  }, [snapshot.targetNumber, snapshot.attemptNumber]);

  const color = hsvToHex(hsv);
  const changeColor = (next: HsvColor) => {
    if (!snapshot.ownGuess || snapshot.ownGuess.confirmed) return;
    setHsv(next);
    const now = performance.now();
    if (now - lastSent.current >= 100) {
      lastSent.current = now;
      onUpdate(hsvToHex(next));
    }
  };
  const restoreColor = (hex: string) => {
    if (!snapshot.ownGuess || snapshot.ownGuess.confirmed) return;
    setHsv(hexToHsv(hex));
    onUpdate(hex);
  };

  if (snapshot.view === "precisionSpectator") {
    return <PrecisionSpectator snapshot={snapshot} />;
  }

  const ownResult = snapshot.attemptResults[0] ?? null;
  return (
    <main className={`${styles.page} ${styles.modePage}`}>
      <div className={styles.gameMeta}>
        <span>{t("precision.targetProgress", { current: snapshot.targetNumber, total: snapshot.totalTargets })}</span>
        <span>{t("precision.attemptProgress", { current: snapshot.attemptNumber, total: snapshot.maxAttempts })}</span>
        <Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={snapshot.phase === "precisionGuessing" ? snapshot.settings.precisionAttemptSeconds : 5} />
      </div>
      {snapshot.phase === "precisionGuessing" && snapshot.ownGuess ? (
        <section className={styles.modePanel}>
          <div className={styles.modeHeading}><span>{t("precision.hiddenTarget")}</span><h1>{t("precision.choose")}</h1><p>{t("precision.goal", { value: snapshot.settings.precisionTargetAccuracy })}</p></div>
          <ColorPicker value={hsv} onChange={changeColor} disabled={snapshot.ownGuess.confirmed} />
          <div className={styles.currentColorRow}><div><span>{t("game.currentScore")}</span><strong>{snapshot.players.find((player) => player.id === snapshot.selfId)?.score ?? 0}</strong></div><i /><span className={styles.currentSwatch} style={{ backgroundColor: color }} aria-label={color} /></div>
          <button className={styles.primaryButton} type="button" disabled={snapshot.ownGuess.confirmed} onClick={() => onConfirm(color)}><LockIcon />{snapshot.ownGuess.confirmed ? t("game.locked") : t("game.confirmColor")}</button>
          <HistoryGrid history={snapshot.ownHistory} disabled={snapshot.ownGuess.confirmed} onRestore={restoreColor} />
        </section>
      ) : (
        <section className={styles.modePanel}>
          <div className={styles.modeHeading}><span>{t("precision.result")}</span><h1>{ownResult ? t("reveal.similarityValue", { value: ownResult.accuracy }) : t("precision.waitingResult")}</h1><p>{snapshot.targetComplete ? t("precision.targetFinished") : t("precision.nextAttempt")}</p></div>
          {snapshot.targetHex ? <div className={styles.targetCard}><span>{t("reveal.target")}</span><i style={{ backgroundColor: snapshot.targetHex }} /><strong>{snapshot.targetHex}</strong></div> : null}
          {ownResult ? <div className={styles.resultSummary}><span className={styles.largeSwatch} style={{ backgroundColor: ownResult.color }} /><div><b>{t("precision.lastColor")}</b><strong>{t("reveal.similarityValue", { value: ownResult.accuracy })}</strong><small>ΔE {ownResult.deltaE.toFixed(1)}{ownResult.autoSubmitted ? ` · ${t("reveal.autoSubmitted")}` : ""}</small></div></div> : null}
          <HistoryGrid history={snapshot.ownHistory} disabled onRestore={() => undefined} />
          {snapshot.targetComplete ? <Ranking ranking={snapshot.ranking} title={t("reveal.ranking")} /> : null}
        </section>
      )}
    </main>
  );
}

function PrecisionSpectator({ snapshot }: { snapshot: PrecisionSnapshot }) {
  const { t } = useTranslation();
  const guesses = snapshot.liveGuesses;
  return (
    <main className={`${styles.page} ${styles.modePage}`}>
      <div className={styles.gameMeta}>
        <span>{t("precision.targetProgress", { current: snapshot.targetNumber, total: snapshot.totalTargets })}</span>
        <span>{t("precision.attemptProgress", { current: snapshot.attemptNumber, total: snapshot.maxAttempts })}</span>
        <Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={snapshot.phase === "precisionGuessing" ? snapshot.settings.precisionAttemptSeconds : 5} />
      </div>
      <div className={styles.modeLayout}>
        <section className={styles.modePanel}>
          <div className={styles.modeHeading}><span>{t("precision.spectator")}</span><h1>{snapshot.phase === "precisionGuessing" ? t("precision.live") : t("precision.result")}</h1></div>
          {snapshot.targetHex ? <div className={styles.targetCard}><span>{t("reveal.target")}</span><i style={{ backgroundColor: snapshot.targetHex }} /><strong>{snapshot.targetHex}</strong></div> : null}
          {snapshot.phase === "precisionGuessing" ? (
            <div className={styles.swatchGrid}>{guesses.map((guess) => <article key={guess.participantId}><div style={{ backgroundColor: guess.color }} /><footer><strong>{guess.nickname}</strong><span>{guess.confirmed ? <CheckIcon /> : null}{guess.confirmed ? t("common.confirmed") : t("common.choosing")}</span></footer></article>)}</div>
          ) : (
            <div className={styles.allResults}>{snapshot.attemptResults.map((result) => <div key={result.participantId}><i style={{ backgroundColor: result.color }} /><span>{result.nickname}</span><b>{t("reveal.similarityValue", { value: result.accuracy })}</b></div>)}</div>
          )}
          <section className={styles.spectatorHistories}>{snapshot.histories.map((history) => <div key={history.participantId}><h3>{history.nickname}</h3><HistoryGrid history={history.results} disabled onRestore={() => undefined} /></div>)}</section>
        </section>
        <Ranking ranking={snapshot.ranking} title={t("reveal.ranking")} />
      </div>
    </main>
  );
}

function HistoryGrid({ history, disabled, onRestore }: { history: PrecisionAttemptResult[]; disabled: boolean; onRestore: (color: string) => void }) {
  const { t } = useTranslation();
  return (
    <section className={styles.historySection}>
      <h2>{t("precision.history")}</h2>
      {history.length === 0 ? <p>{t("precision.noHistory")}</p> : <div className={styles.historyGrid}>{history.map((entry) => <button type="button" key={entry.attempt} disabled={disabled} onClick={() => onRestore(entry.color)}><i style={{ backgroundColor: entry.color }} /><span>{t("precision.attemptShort", { value: entry.attempt })}</span><b>{entry.accuracy}%</b></button>)}</div>}
    </section>
  );
}
