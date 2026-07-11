import { useEffect, useState } from "react";
import { ClockIcon } from "./Icons";
import styles from "../styles.module.css";

interface CountdownProps {
  deadline: number | null;
  serverNow: number;
  totalSeconds: number;
  paused?: boolean;
  remainingMs?: number | null;
}

export function Countdown({ deadline, serverNow, totalSeconds, paused = false, remainingMs = null }: CountdownProps) {
  const clockOffset = serverNow - Date.now();
  const remaining = () => paused
    ? remainingMs ?? 0
    : Math.max(0, (deadline ?? Date.now()) - (Date.now() + clockOffset));
  const [milliseconds, setMilliseconds] = useState(remaining);

  useEffect(() => {
    setMilliseconds(remaining());
    if (paused || deadline === null) return undefined;
    const interval = window.setInterval(() => setMilliseconds(remaining()), 200);
    return () => window.clearInterval(interval);
  }, [deadline, paused, remainingMs, serverNow]);

  const seconds = Math.ceil(milliseconds / 1000);
  const display = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const progress = Math.max(0, Math.min(100, (milliseconds / (totalSeconds * 1000)) * 100));

  return (
    <div className={styles.countdown} aria-label={`남은 시간 ${display}`}>
      <ClockIcon />
      <strong>{display}</strong>
      <span style={{ width: `${progress}%` }} />
    </div>
  );
}

