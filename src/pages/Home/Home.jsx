import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher, ThemeSwitcher, Wall, Json, Check, Boundary } from "@components";
import { LEADS } from "@utils/leads";
import { REPO, GUIDE, HOME } from "../../constants";
import { EXAMPLE, PROMPT } from "../../prompt";
import buttons from "../../button.module.css";
import styles from "./home.module.css";

// How long the button says the prompt was copied.
const COPIED_MS = 2000;

export default function Home() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rules = t("rules.items", { returnObjects: true });
  const steps = t("join.steps", { returnObjects: true });

  useEffect(() => {
    document.title = t("meta.title");
    document.documentElement.lang = language;
  }, [t, language]);

  // The prompt, onto the clipboard; the button says so for a moment.
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
    } catch {
      // no clipboard here; the button stays as it was
    }
  }

  return (
    <div className={styles.page}>
      <nav className={styles.topbar}>
        <a className={styles.home} href="/">Heroes</a>
        <div className={styles.switches}>
          <LanguageSwitcher />
          <ThemeSwitcher />
        </div>
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.wordmark}>{t("hero.name")}</h1>
          <h2 className={styles.tagline}>{t("hero.tagline")}</h2>
          <p className={styles.lede}>{t("hero.lede")}</p>
          <div className={styles.actions}>
            {/* Down the page to the steps, not out to the guide: the guide is
                the last of those steps. */}
            <a className={buttons.primary} href="#join">{t("hero.join")}</a>
            <a className={buttons.secondary} href={REPO} target="_blank" rel="noopener">{t("hero.source")}</a>
          </div>
        </div>
      </header>

      {/* Everyone at once, under no heading of its own: a wall of faces. A
          list would be thousands of rows long and read as none of them. Press
          one and their entry unfolds in the wall, under the row it was pressed
          in, so it is read beside the faces it was picked from. */}
      <section className={styles.section} id="leads">
        <Wall people={LEADS} />
      </section>

      {/* What it takes, whether a name has it, and how to say so: three parts
          of one section, each under its own heading and no line between
          them. */}
      <section className={styles.section} id="join">
        <h2 className={styles.label}>{t("join.title")}</h2>

        <div className={styles.joinRules}>
          <h3 className={styles.subLabel}>{t("rules.title")}</h3>
          <div className={styles.rules}>
            {rules.map((rule, i) => (
              <div className={styles.rule} key={rule.name}>
                <h4 className={styles.ruleName}>
                  <span className={styles.ruleIndex}>{String(i + 1).padStart(2, "0")}</span>
                  {rule.name}
                </h4>
                <p className={styles.ruleBody}>{rule.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* The rules read against a name: whoever is reading them can put
            their own in and see where they stand before the steps below. It
            is the one part of the page drawn from what a server said, so it is
            held up on its own: if it cannot be drawn, the rest of the page is
            still there. */}
        <Boundary say={t("check.broke")} className={styles.broke}>
          <Check />
        </Boundary>

        <h3 className={styles.subLabel}>{t("join.pull")}</h3>
        <div className={styles.join}>
          <div className={styles.joinText}>
            <p className={styles.sectionLede}>{t("join.lede")}</p>
            <ol className={styles.steps}>
              {steps.map((step) => (
                <li className={styles.step} key={step.name}>
                  <span className={styles.stepName}>{step.name}</span>
                  <span className={styles.stepBody}>{step.body}</span>
                </li>
              ))}
            </ol>
            <p className={styles.note}>{t("join.language")}</p>
            <p className={styles.note}>{t("join.collected")}</p>
            <p className={styles.note}>{t("join.prompt")}</p>
            {/* The two ways of starting the file, side by side and the same
                size: read it yourself, or hand the prompt to an assistant. */}
            <div className={styles.actions}>
              <a className={buttons.secondary} href={GUIDE} target="_blank" rel="noopener">{t("join.guide")}</a>
              <button
                type="button"
                className={buttons.secondary}
                onClick={copyPrompt}
                aria-live="polite"
              >
                {copied ? t("join.copied") : t("join.copy")}
              </button>
            </div>
          </div>
          <pre className={styles.code}><Json text={EXAMPLE} /></pre>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerLinks}>
          <a href={REPO} target="_blank" rel="noopener">GitHub</a>
          <a href={HOME}>gcc³</a>
        </div>
        <div className={styles.copyright}>{t("footer.copyright")}</div>
      </footer>
    </div>
  );
}
