import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher, Hundred, Lead } from "@components";
import { LEADS } from "@utils/leads";
import { REPO, GUIDE, HOME } from "../../constants";
import styles from "./home.module.css";

const JOIN_BAR = 10;

// The smallest entry that passes the check, shown as it would be typed.
const EXAMPLE = `{
  "handle": "you",
  "name": "Your Name",
  "github": "https://github.com/you",
  "apps": [
    {
      "name": "An app",
      "description": "What it does, in one line.",
      "repo": "https://github.com/you/an-app",
      "url": "https://an-app.example.com"
    }
  ]
}`;

const HUNDRED = 100;

export default function Home() {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rules = t("rules.items", { returnObjects: true });
  const steps = t("join.steps", { returnObjects: true });

  // Whoever has reached the hundred. Nobody has, and the page says so in the
  // largest type it has; the day someone does, the same line names them.
  const heroes = LEADS.filter((lead) => lead.apps.length >= HUNDRED);
  const heroNames = new Intl.ListFormat(language, { type: "conjunction" }).format(
    heroes.map((lead) => lead.name),
  );

  useEffect(() => {
    document.title = t("meta.title");
    document.documentElement.lang = language;
  }, [t, language]);

  return (
    <div className={styles.page}>
      <nav className={styles.topbar}>
        <a className={styles.home} href="/">Tech Leads</a>
        <LanguageSwitcher />
      </nav>

      <header className={styles.hero}>
        <div className={styles.heroText}>
          <h1 className={styles.wordmark}>Tech Leads</h1>
          <h2 className={styles.tagline}>{t("hero.tagline")}</h2>
          <p className={styles.lede}>{t("hero.lede")}</p>
          <div className={styles.actions}>
            <a className={styles.primary} href={GUIDE} target="_blank" rel="noopener">{t("hero.join")}</a>
            <a className={styles.secondary} href={REPO} target="_blank" rel="noopener">{t("hero.source")}</a>
          </div>
        </div>
        {/* The hundred, with the ten that join filled in: the first rule,
            drawn rather than said. */}
        <figure className={styles.figure}>
          <Hundred count={JOIN_BAR} label={t("leads.grid", { n: JOIN_BAR })} big />
          <figcaption className={styles.caption}>{rules[0].name}</figcaption>
        </figure>
      </header>

      <section className={styles.status} id="heroes">
        <p className={styles.statusLine}>
          {heroes.length > 0 ? t("heroes.some", { names: heroNames }) : t("heroes.none")}
        </p>
      </section>

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

      <section className={styles.section} id="leads">
        <h2 className={styles.label}>{t("leads.title")}</h2>
        <div className={styles.leads}>
          {LEADS.map((lead) => (
            <Lead lead={lead} key={lead.handle} />
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
            <div className={styles.actions}>
              <a className={styles.secondary} href={GUIDE} target="_blank" rel="noopener">{t("join.guide")}</a>
            </div>
          </div>
          <pre className={styles.code}>{EXAMPLE}</pre>
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
