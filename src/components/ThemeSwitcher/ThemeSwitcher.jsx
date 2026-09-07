import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  THEMES,
  initialTheme,
  savedTheme,
  onSystemTheme,
  applyTheme,
  rememberTheme,
} from "../../theme.js";
import Switcher from "../Switcher";

// Light, dark, or black and white. The word shown as chosen is always the
// one the page is drawn in: the reader's choice, or, before there is one,
// the system's.
export default function ThemeSwitcher() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Until the reader chooses, the page follows the system as it changes.
  useEffect(
    () =>
      onSystemTheme((system) => {
        if (!savedTheme()) setTheme(system);
      }),
    [],
  );

  function switchTheme(code) {
    setTheme(code);
    rememberTheme(code);
  }

  return (
    <Switcher
      label={t("theme.title")}
      options={THEMES.map((code) => ({ code, label: t(`theme.${code}`) }))}
      value={theme}
      onChange={switchTheme}
    />
  );
}
