import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MenuIcon } from "./Icons";
import styles from "../styles.module.css";

export const PRODUCT_TITLE = "What the color is that?";

export function DotMark() {
  return <span className={styles.dotMark} aria-hidden="true"><i /><i /><i /><i /></span>;
}

interface BrandHeaderProps {
  inRoom?: boolean;
  canEndGame?: boolean;
  onLeave?: () => void;
  onEndGame?: () => void;
}

export function BrandHeader({ inRoom = false, canEndGame = false, onLeave, onEndGame }: BrandHeaderProps) {
  const { i18n, t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleLanguage = () => {
    const language = i18n.resolvedLanguage === "en" ? "ko" : "en";
    localStorage.setItem("wtcit.locale", language);
    document.documentElement.lang = language;
    void i18n.changeLanguage(language);
  };

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <DotMark />
        <span className={styles.brandTitle}>{PRODUCT_TITLE}</span>
      </div>
      <div className={styles.headerActions}>
        <button className={styles.languageButton} type="button" onClick={toggleLanguage} aria-label="한국어와 영어 전환">
          KO / EN
        </button>
        {inRoom ? (
          <div className={styles.menuWrap}>
            <button className={styles.iconButton} type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label="메뉴">
              <MenuIcon />
            </button>
            {menuOpen ? (
              <div className={styles.menu}>
                {canEndGame ? <button type="button" onClick={onEndGame}>{t("common.endGame")}</button> : null}
                <button type="button" onClick={onLeave}>{t("common.leave")}</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}

