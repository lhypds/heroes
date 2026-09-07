import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import zh from "./zh.json";
import ja from "./ja.json";
import fr from "./fr.json";
import es from "./es.json";
import de from "./de.json";

// The six languages the gcc³ apps speak, in the order the switcher offers them.
export const LANGS = ["en", "zh", "ja", "fr", "es", "de"];
export const STORAGE_KEY = "lang";

// A language named in the address — ?lang=ja — wins for this visit, so a link
// can be handed to someone in their language without touching the choice
// their browser remembers. Then the remembered choice, then what the browser
// asks for, then English.
const initialLanguage = () => {
  const asked = new URLSearchParams(window.location.search).get("lang");
  if (LANGS.includes(asked)) return asked;
  let saved = null;
  try {
    saved = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage can be unavailable; fall through to the browser's language
  }
  if (LANGS.includes(saved)) return saved;
  const browser = (navigator.language || "").split("-")[0];
  return LANGS.includes(browser) ? browser : "en";
};

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
    fr: { translation: fr },
    es: { translation: es },
    de: { translation: de },
  },
  lng: initialLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
