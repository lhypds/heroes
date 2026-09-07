import { useState } from "react";
import { useTranslation } from "react-i18next";
import Hundred from "../Hundred";
import { pick, host } from "@utils/leads";
import styles from "./lead.module.css";

// One person on the list: who they are and how far along the hundred they
// are, always; and every application, one row each, with where it opens and
// where its source is, once their name is pressed. A link straight to a
// person — #handle — arrives with them already open.
export default function Lead({ lead }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { handle, name, github, website, bio, apps } = lead;
  const count = apps.length;
  const [open, setOpen] = useState(() => window.location.hash === `#${handle}`);
  const listId = `${handle}-apps`;

  return (
    <article className={styles.lead} id={handle}>
      <header className={styles.head}>
        <div className={styles.who}>
          <h3 className={styles.name}>
            <button
              type="button"
              className={styles.toggle}
              aria-expanded={open}
              aria-controls={listId}
              title={open ? t("leads.hide") : t("leads.show")}
              onClick={() => setOpen((value) => !value)}
            >
              {name}
              <span className={styles.mark} aria-hidden="true">{open ? "−" : "+"}</span>
            </button>
          </h3>
          <div className={styles.links}>
            <a href={github} target="_blank" rel="noopener">@{handle}</a>
            {website && (
              <a href={website} target="_blank" rel="noopener">{host(website)}</a>
            )}
          </div>
          {bio && <p className={styles.bio}>{pick(bio, language)}</p>}
        </div>
        <div className={styles.count}>
          <div className={styles.number} aria-hidden="true">
            <span className={styles.n}>{count}</span>
            <span className={styles.of}>/ 100</span>
          </div>
          <Hundred
            count={count}
            titles={apps.map((app) => app.name)}
            label={t("leads.grid", { n: count })}
          />
        </div>
      </header>

      {open && (
        <ol className={styles.apps} id={listId}>
          {apps.map((app, i) => (
            <li className={styles.app} key={app.repo}>
              <span className={styles.index}>{String(i + 1).padStart(2, "0")}</span>
              <div className={styles.text}>
                <span className={styles.appName}>{app.name}</span>
                <span className={styles.appBody}>{pick(app.description, language)}</span>
              </div>
              <span className={styles.meta}>
                {[app.language, app.platform].filter(Boolean).join(" · ")}
              </span>
              <span className={styles.appLinks}>
                {app.url && (
                  <a href={app.url} target="_blank" rel="noopener">{t("leads.open")}</a>
                )}
                <a href={app.repo} target="_blank" rel="noopener">{t("leads.source")}</a>
              </span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
