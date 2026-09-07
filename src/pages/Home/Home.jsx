import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher, ThemeSwitcher, Lead, Json } from "@components";
import { LEADS } from "@utils/leads";
import { REPO, GUIDE, HOME, HUNDRED } from "../../constants";
import { EXAMPLE, PROMPT } from "../../prompt";
import styles from "./home.module.css";

// How long the button says the prompt was copied.
const COPIED_MS = 2000;

export default function Home() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rules = t("rules.items", { returnObjects: true });
  const steps = t("join.steps", { returnObjects: true });

  // Two lists: whoever has reached the hundred, and everyone still on the
  // way. Nobody has reached it, and the first list says so in the largest
  // type the page has; the day someone does, they are listed there.
  const heroes = LEADS.filter((lead) => lead.apps.length >= HUNDRED);
  const others = LEADS.filter((lead) => lead.apps.length < HUNDRED);

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
        <a className={styles.home} href="/">Heros</a>
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
            <a className={styles.primary} href="#join">{t("hero.join")}</a>
            <a className={styles.secondary} href={REPO} target="_blank" rel="noopener">{t("hero.source")}</a>
          </div>
        </div>
      </header>

      <section className={styles.section} id="heroes">
        <h2 className={styles.label}>{t("heroes.title")}</h2>
        {heroes.length > 0 ? (
          <div className={styles.leads}>
            {heroes.map((lead) => (
              <Lead lead={lead} avatar key={lead.handle} />
            ))}
          </div>
        ) : (
          <p className={styles.statusLine}>{t("heroes.none")}</p>
        )}
      </section>

      {others.length > 0 && (
        <section className={styles.section} id="leads">
          <h2 className={styles.label}>{t("leads.title")}</h2>
          <div className={styles.leads}>
            {others.map((lead) => (
              <Lead lead={lead} key={lead.handle} />
            ))}
          </div>
        </section>
      )}

      <section className={styles.section} id="rules">
        <h2 className={styles.label}>{t("rules.title")}</h2>
        <div className={styles.rules}>
          {rules.map((rule, i) => (
            <div className={styles.rule} key={rule.name}>
              <h3 className={styles.ruleName}>
                <span className={styles.ruleIndex}>{String(i + 1).padStart(2, "0")}</span>
                {rule.name}
              </h3>
              <p className={styles.ruleBody}>{rule.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.section} id="join">
        <h2 className={styles.label}>{t("join.title")}</h2>
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
            <div className={styles.actions}>
              <a className={styles.secondary} href={GUIDE} target="_blank" rel="noopener">{t("join.guide")}</a>
            </div>
          </div>
          <div className={styles.example}>
            <pre className={styles.code}><Json text={EXAMPLE} /></pre>
            <div className={styles.prompt}>
              <p className={styles.promptNote}>{t("join.prompt")}</p>
              <button
                type="button"
                className={`${styles.secondary} ${styles.copy}`}
                onClick={copyPrompt}
                aria-live="polite"
              >
                {copied ? t("join.copied") : t("join.copy")}
              </button>
            </div>
          </div>
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
