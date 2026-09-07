import { useTranslation } from "react-i18next";
import { LANGS, STORAGE_KEY } from "../../i18n/index.js";
import styles from "./lang.module.css";

const LABELS = { en: "EN", zh: "ZH", ja: "JA", fr: "FR", es: "ES", de: "DE" };

export default function LanguageSwitcher() {
  const { i18n } = useTranslation();

  function switchLang(code) {
    i18n.changeLanguage(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // not being able to remember it is not a reason to refuse the change
    }
  }

  return (
    <div className={styles.switcher}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={i18n.language === code ? styles.optionOn : styles.option}
          aria-pressed={i18n.language === code}
          onClick={() => switchLang(code)}
        >
          {LABELS[code]}
        </button>
      ))}
    </div>
  );
}
