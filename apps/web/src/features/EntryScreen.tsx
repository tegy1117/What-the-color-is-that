import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ParticipantRole } from "@wtcit/shared";
import { BrandHeader } from "../components/BrandHeader";
import styles from "../styles.module.css";

interface EntryScreenProps {
  onCreate: (nickname: string, role: ParticipantRole) => Promise<unknown>;
  onJoin: (roomCode: string, nickname: string, role: ParticipantRole) => Promise<unknown>;
}

function RolePicker({ value, onChange }: { value: ParticipantRole; onChange: (role: ParticipantRole) => void }) {
  const { t } = useTranslation();
  return (
    <div className={styles.segmented} aria-label={t("entry.role")}>
      {(["player", "spectator"] as const).map((role) => (
        <button key={role} type="button" className={value === role ? styles.selected : ""} onClick={() => onChange(role)}>
          {t(`common.${role}`)}
        </button>
      ))}
    </div>
  );
}

export function EntryScreen({ onCreate, onJoin }: EntryScreenProps) {
  const { t } = useTranslation();
  const [createName, setCreateName] = useState("");
  const [createRole, setCreateRole] = useState<ParticipantRole>("player");
  const [joinName, setJoinName] = useState("");
  const [joinRole, setJoinRole] = useState<ParticipantRole>("player");
  const initialCode = new URLSearchParams(window.location.search).get("room") ?? "";
  const [roomCode, setRoomCode] = useState(initialCode.toUpperCase());

  return (
    <div className={styles.appShell}>
      <BrandHeader />
      <main className={`${styles.page} ${styles.entryPage}`}>
        <p className={styles.intro}>{t("entry.intro")}</p>
        <div className={styles.entryGrid}>
          <form className={styles.entryPanel} onSubmit={(event) => { event.preventDefault(); void onCreate(createName, createRole); }}>
            <h2>{t("entry.createTitle")}</h2>
            <label>{t("entry.nickname")}<input value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={12} placeholder={t("entry.nicknamePlaceholder")} autoComplete="nickname" required /></label>
            <label>{t("entry.role")}<RolePicker value={createRole} onChange={setCreateRole} /></label>
            <button className={styles.primaryButton} type="submit">{t("entry.create")}</button>
          </form>
          <form className={styles.entryPanel} onSubmit={(event) => { event.preventDefault(); void onJoin(roomCode, joinName, joinRole); }}>
            <h2>{t("entry.joinTitle")}</h2>
            <label>{t("entry.roomCode")}<input className={styles.codeInput} value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 6))} maxLength={6} placeholder={t("entry.roomCodePlaceholder")} autoCapitalize="characters" required /></label>
            <label>{t("entry.nickname")}<input value={joinName} onChange={(event) => setJoinName(event.target.value)} maxLength={12} placeholder={t("entry.nicknamePlaceholder")} autoComplete="nickname" required /></label>
            <label>{t("entry.role")}<RolePicker value={joinRole} onChange={setJoinRole} /></label>
            <button className={styles.darkButton} type="submit">{t("entry.join")}</button>
          </form>
        </div>
      </main>
    </div>
  );
}

