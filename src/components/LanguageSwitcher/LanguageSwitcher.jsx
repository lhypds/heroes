import { useTranslation } from "react-i18next";
import { LANGS, STORAGE_KEY } from "../../i18n/index.js";
import Switcher from "../Switcher";

const LABELS = { en: "EN", zh: "ZH", ja: "JA", fr: "FR", es: "ES", de: "DE" };
const OPTIONS = LANGS.map((code) => ({ code, label: LABELS[code] }));

export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();

  function switchLang(code) {
    i18n.changeLanguage(code);
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // not being able to remember it is not a reason to refuse the change
    }
  }

  return (
    <Switcher
      label={t("language.title")}
      options={OPTIONS}
      value={i18n.language}
      onChange={switchLang}
    />
  );
}
