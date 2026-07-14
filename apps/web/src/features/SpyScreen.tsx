import { FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_COLOR, type SpyColorResult, type SpySnapshot, type SpyVoteChoice } from "@wtcit/shared";
import { ColorPicker } from "../components/ColorPicker";
import { Countdown } from "../components/Countdown";
import { ArrowIcon, LockIcon, PauseIcon, PlayIcon } from "../components/Icons";
import { Ranking } from "../components/Ranking";
import { hexToHsv, hsvToHex, type HsvColor } from "../lib/color";
import styles from "../styles.module.css";

interface SpyScreenProps {
  snapshot: SpySnapshot;
  onHint: (hint: string) => void;
  onVote: (choice: SpyVoteChoice) => void;
  onUpdate: (color: string) => void;
  onConfirm: (color: string) => void;
  onPause: (paused: boolean) => void;
  onAdvance: () => void;
}

export function SpyScreen({ snapshot, onHint, onVote, onUpdate, onConfirm, onPause, onAdvance }: SpyScreenProps) {
  const { t } = useTranslation();
  const [hint, setHint] = useState("");
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(snapshot.spyCurrentColor ?? snapshot.probes.at(-1)?.color ?? DEFAULT_COLOR));
  const lastSent = useRef(0);
  const allParticipants = [...snapshot.players, ...snapshot.spectators];
  const currentHintPlayer = allParticipants.find((participant) => participant.id === snapshot.currentHintPlayerId);
  const isAlive = snapshot.alivePlayerIds.includes(snapshot.selfId);
  const canHint = snapshot.phase === "spyHinting" && snapshot.currentHintPlayerId === snapshot.selfId && isAlive;
  const canVote = snapshot.phase === "spyVoting" && isAlive;
  const isSpyChoosing = snapshot.phase === "spyGuessing" && snapshot.spyRole === "spy";
  const isHost = snapshot.selfId === snapshot.hostId;

  useEffect(() => { setHint(""); }, [snapshot.hintCycle, snapshot.currentHintPlayerId]);
  useEffect(() => {
    setHsv(hexToHsv(snapshot.spyCurrentColor ?? snapshot.probes.at(-1)?.color ?? DEFAULT_COLOR));
    lastSent.current = 0;
  }, [snapshot.roundNumber, snapshot.guessKind]);

  const color = hsvToHex(hsv);
  const changeColor = (next: HsvColor) => {
    if (!isSpyChoosing) return;
    setHsv(next);
    const now = performance.now();
    if (now - lastSent.current >= 100) {
      lastSent.current = now;
      onUpdate(hsvToHex(next));
    }
  };
  const restoreColor = (hex: string) => {
    if (!isSpyChoosing) return;
    setHsv(hexToHsv(hex));
    onUpdate(hex);
  };
  const submitHint = (event: FormEvent) => {
    event.preventDefault();
    const value = hint.trim();
    if (value) onHint(value);
  };
  const totalSeconds = phaseSeconds(snapshot);

  if (snapshot.phase === "spyRoundReveal" && snapshot.roundResult) {
    const result = snapshot.roundResult;
    return (
      <main className={`${styles.page} ${styles.revealPage}`}>
        <div className={styles.revealHeading}><span>{t("spy.roundResult")}</span><h1>{result.caught ? t("spy.caught") : t("spy.oneOnOne")}</h1></div>
        <div className={styles.revealLayout}>
          <section className={styles.comparison}>
            <div className={styles.comparisonSwatches}><ColorResult label={t("reveal.target")} color={result.targetHex} /><ColorResult label={t("spy.finalGuess")} color={result.finalGuess.color} /></div>
            <div className={styles.similarity}><span>{t("reveal.similarity")}</span><strong>{t("reveal.similarityValue", { value: result.finalGuess.accuracy })}</strong><small>ΔE {result.finalGuess.deltaE.toFixed(1)}</small></div>
            <div className={styles.spyIdentity}><span>{t("spy.spyWas")}</span><strong>{result.spyNickname}</strong></div>
            <div className={styles.scoreBreakdown}><span>{t("spy.crewScore", { value: result.crewScore })}</span><span>{t("spy.spyScore", { value: result.spyScore })}</span><strong>{result.caught ? t("spy.crewCaught") : t("spy.spySurvived")}</strong></div>
            <ProbeHistory probes={result.probes} disabled onRestore={() => undefined} />
          </section>
          <aside className={styles.resultRail}>
            <Ranking ranking={snapshot.ranking} title={t("reveal.ranking")} />
            <div className={styles.revealControls}><Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={12} paused={snapshot.revealPaused} remainingMs={snapshot.revealRemainingMs} />{isHost ? <><button className={styles.secondaryButton} type="button" onClick={() => onPause(!snapshot.revealPaused)}>{snapshot.revealPaused ? <PlayIcon /> : <PauseIcon />}{snapshot.revealPaused ? t("reveal.resume") : t("reveal.pause")}</button><button className={styles.darkButton} type="button" onClick={onAdvance}>{t("reveal.next")}<ArrowIcon /></button></> : null}</div>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <main className={`${styles.page} ${styles.modePage}`}>
      <div className={styles.gameMeta}>
        <span>{t("game.round", { current: snapshot.roundNumber, total: snapshot.totalRounds })}</span>
        <span>{t(`spy.phases.${snapshot.phase}`)}</span>
        <Countdown deadline={snapshot.deadline} serverNow={snapshot.serverNow} totalSeconds={totalSeconds} />
      </div>
      {snapshot.voteInvalid ? <div className={styles.notice}>{t("spy.voteInvalid")}</div> : null}
      {snapshot.lastEliminated ? <div className={styles.notice}>{snapshot.lastEliminated.wasSpy ? t("spy.eliminatedSpy", { name: snapshot.lastEliminated.nickname }) : t("spy.eliminatedCrew", { name: snapshot.lastEliminated.nickname })}</div> : null}
      <div className={styles.modeLayout}>
        <section className={styles.modePanel}>
          <RoleAndTarget snapshot={snapshot} />
          {snapshot.phase === "spyHinting" ? (
            <>
              <div className={styles.modeHeading}><span>{t("spy.hintCycle", { value: snapshot.hintCycle })}</span><h1>{canHint ? t("spy.yourHintTurn") : t("spy.hintTurn", { name: currentHintPlayer?.nickname ?? "" })}</h1></div>
              {canHint ? <form className={styles.hintSubmit} onSubmit={submitHint}><textarea value={hint} maxLength={80} autoFocus aria-label={t("spy.hintInputLabel")} onChange={(event) => setHint(event.target.value)} placeholder={t("spy.hintPlaceholder")} /><button className={styles.primaryButton} type="submit" disabled={!hint.trim()}>{t("spy.submitHint")}</button></form> : <WaitingMessage text={isAlive ? t("spy.waitHint") : t("spy.eliminatedWait")} />}
            </>
          ) : null}
          {snapshot.phase === "spyDiscussion" ? <WaitingMessage title={t("spy.discussTitle")} text={isAlive ? t("spy.discuss") : t("spy.eliminatedWait")} /> : null}
          {snapshot.phase === "spyVoting" ? (
            <section className={styles.voteSection}>
              <div className={styles.modeHeading}><span>{t("spy.votesCast", { current: snapshot.votesCast, total: snapshot.eligibleVoters })}</span><h1>{canVote ? t("spy.voteTitle") : t("spy.voteWatching")}</h1><p>{t("spy.voteMutable")}</p></div>
              <div className={styles.voteGrid}>{snapshot.voteTallies.map((entry) => <button type="button" key={entry.choice} disabled={!canVote} className={snapshot.ownVote === entry.choice ? styles.voteSelected : ""} aria-pressed={snapshot.ownVote === entry.choice} onClick={() => onVote(entry.choice)}><span>{entry.choice === "abstain" ? t("spy.abstain") : entry.nickname}</span><strong>{t("spy.voteCount", { value: entry.count })}</strong></button>)}</div>
            </section>
          ) : null}
          {snapshot.phase === "spyGuessing" ? (
            isSpyChoosing ? (
              <section className={styles.spyGuessPanel}>
                <div className={styles.modeHeading}><span>{snapshot.guessKind === "final" ? t("spy.finalGuess") : t("spy.probe")}</span><h1>{snapshot.guessKind === "final" ? t("spy.chooseFinal") : t("spy.chooseProbe")}</h1></div>
                <ColorPicker value={hsv} onChange={changeColor} />
                <span className={styles.currentSwatch} style={{ backgroundColor: color }} aria-label={color} />
                <button className={styles.primaryButton} type="button" onClick={() => onConfirm(color)}><LockIcon />{t("game.confirmColor")}</button>
                <ProbeHistory probes={snapshot.probes} disabled={false} onRestore={restoreColor} />
              </section>
            ) : (
              <WaitingMessage title={snapshot.guessKind === "final" ? t("spy.finalGuess") : t("spy.probe")} text={snapshot.spyRole === "spectator" ? t("spy.spectatorGuess", { color: snapshot.spyCurrentColor ?? DEFAULT_COLOR }) : t("spy.waitSpyGuess")} />
            )
          ) : null}
          {snapshot.phase !== "spyGuessing" && snapshot.probes.length > 0 ? <ProbeHistory probes={snapshot.probes} disabled onRestore={() => undefined} /> : null}
        </section>
        <aside className={styles.modeRail}>
          <PlayerStatus snapshot={snapshot} />
          <HintHistory snapshot={snapshot} />
          <Ranking ranking={snapshot.ranking} title={t("reveal.ranking")} />
        </aside>
      </div>
    </main>
  );
}

function RoleAndTarget({ snapshot }: { snapshot: SpySnapshot }) {
  const { t } = useTranslation();
  const spy = [...snapshot.players, ...snapshot.spectators].find((participant) => participant.id === snapshot.spyId);
  return <section className={styles.roleCard}><div><span>{t("spy.yourRole")}</span><strong>{t(`spy.roles.${snapshot.spyRole}`)}</strong>{snapshot.spyRole === "spectator" && spy ? <small>{t("spy.spyIs", { name: spy.nickname })}</small> : null}</div>{snapshot.targetHex ? <div><span>{t("reveal.target")}</span><i style={{ backgroundColor: snapshot.targetHex }} /></div> : <div><span>{t("spy.target")}</span><b>{t("spy.targetHidden")}</b></div>}</section>;
}

function PlayerStatus({ snapshot }: { snapshot: SpySnapshot }) {
  const { t } = useTranslation();
  const roundPlayers = [...snapshot.players, ...snapshot.spectators].filter((participant) => snapshot.roundPlayerIds.includes(participant.id));
  return <section className={styles.statusList}><h2>{t("spy.playerStatus")}</h2>{roundPlayers.map((participant) => <div key={participant.id}><span>{participant.nickname}</span><b>{snapshot.alivePlayerIds.includes(participant.id) ? t("spy.alive") : t("spy.eliminated")}</b></div>)}</section>;
}

function HintHistory({ snapshot }: { snapshot: SpySnapshot }) {
  const { t } = useTranslation();
  return <section className={styles.hintHistory}><h2>{t("spy.hintHistory")}</h2>{snapshot.hints.length === 0 ? <p>{t("spy.noHints")}</p> : <ol>{snapshot.hints.map((entry, index) => <li key={`${entry.cycle}-${entry.participantId}-${index}`}><span>{entry.nickname}<small>{t("spy.hintCycleShort", { value: entry.cycle })}</small></span><strong>{entry.hint ?? t("spy.passed")}</strong></li>)}</ol>}</section>;
}

function ProbeHistory({ probes, disabled, onRestore }: { probes: SpyColorResult[]; disabled: boolean; onRestore: (color: string) => void }) {
  const { t } = useTranslation();
  return <section className={styles.historySection}><h2>{t("spy.probeHistory")}</h2>{probes.length === 0 ? <p>{t("spy.noProbes")}</p> : <div className={styles.historyGrid}>{probes.map((probe, index) => <button type="button" key={`${probe.color}-${index}`} disabled={disabled} onClick={() => onRestore(probe.color)}><i style={{ backgroundColor: probe.color }} /><span>{t("spy.probeShort", { value: index + 1 })}</span><b>{probe.accuracy}%</b></button>)}</div>}</section>;
}

function WaitingMessage({ title, text }: { title?: string; text: string }) {
  return <div className={styles.phaseMessage}>{title ? <h1>{title}</h1> : null}<p>{text}</p><span className={styles.waitingDots}><i /><i /><i /></span></div>;
}

function ColorResult({ label, color }: { label: string; color: string }) {
  return <div><span>{label}</span><i style={{ backgroundColor: color }} /><strong>{color}</strong></div>;
}

function phaseSeconds(snapshot: SpySnapshot) {
  if (snapshot.phase === "spyHinting") return snapshot.settings.spyHintSeconds;
  if (snapshot.phase === "spyDiscussion") return snapshot.settings.spyDiscussionSeconds;
  if (snapshot.phase === "spyVoting") return snapshot.settings.spyVoteSeconds;
  if (snapshot.phase === "spyGuessing") return snapshot.settings.spyGuessSeconds;
  return 12;
}
