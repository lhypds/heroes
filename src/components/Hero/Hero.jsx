import { useState } from "react";
import { useTranslation } from "react-i18next";
import Hundred from "../Hundred";
import { HUNDRED } from "../../constants";
import { pick, host, accounts, account } from "@utils/leads";
import styles from "./hero.module.css";

// One person on the list: who they are and how far along the hundred they
// are, always; and their repositories, one row each, with where it opens and
// where its source is, once their name is pressed. A link straight to a
// person — #handle — arrives with them already open.
//
// The figure beside the name is what their own public repositories come to —
// own_repos, which `npx hero scan` reads off the accounts themselves, forks
// out — and with it the commits in those repositories, which is the second
// rule, read as a floor. Both are counted off the account rather than off
// this list; an entry with no commits yet names the repositories alone, and
// one the scan has not reached names the repositories it lists instead.
//
// The grid under it counts the same repositories, a square each against the
// hundred the first rule asks for, so the figure and the squares are the one
// thing said twice: how far along the hundred they are, and how far past it
// they have gone, since it goes round again for every hundred after.
//
// The rows that unfold are the repositories the entry carries — repos, the
// hundred the scan read off the same accounts, the ones pushed to most
// recently first. A description is the one thing they do not carry, since a
// scan cannot write one; where a repository names a home page of its own,
// the row opens there as well as at the source.
//
// Beside the name, every account the entry lists: one person may keep more
// than one, and the rules read them as one.
//
// Their GitHub picture beside the name, read from the address GitHub gives
// every profile picture, hero or not — the pictures host itself, not the
// github.com/<handle>.png page that redirects to it, which answers as a
// document and which Chrome will not take when a picture was asked for. If it
// does not load, nothing is shown in its place. It is the account the file is
// named for.
export default function Hero({ hero }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { handle, name, github, website, bio, repos, commits, own_repos: own } = hero;
  // The repositories the entry carries, and an entry the scan has not reached
  // carries none yet: the name is still the switch, and it opens on nothing.
  const listed = Array.isArray(repos) ? repos : [];
  // Their own repositories, as the scan last counted them; the ones listed
  // until they have been counted, which is what the figure and the squares
  // said before there was anything better to say.
  const count = Number.isInteger(own) ? own : listed.length;
  const [open, setOpen] = useState(() => window.location.hash === `#${handle}`);
  const [noAvatar, setNoAvatar] = useState(false);
  const listId = `${handle}-repos`;

  return (
    <article className={styles.hero} id={handle}>
      <header className={styles.head}>
        <div className={styles.who}>
          {!noAvatar && (
            <img
              className={styles.avatar}
              src={`https://avatars.githubusercontent.com/${handle}?size=96`}
              alt=""
              width="36"
              height="36"
              loading="lazy"
              onError={() => setNoAvatar(true)}
            />
          )}
          <div className={styles.person}>
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
              {accounts(github).map((url) => (
                <a key={url} href={url} target="_blank" rel="noopener">@{account(url)}</a>
              ))}
              {website && (
                <a href={website} target="_blank" rel="noopener">{host(website)}</a>
              )}
            </div>
            {bio && <p className={styles.bio}>{pick(bio, language)}</p>}
          </div>
        </div>
        <div className={styles.count}>
          <div className={styles.figures}>
            {commits > 0
              ? t("leads.figures", {
                  n: count.toLocaleString(language),
                  c: Number(commits).toLocaleString(language),
                })
              : t("leads.repositories", { n: count.toLocaleString(language) })}
          </div>
          {/* No square carries a name: they are counted off the account, all
              of them, and the rows below name only the hundred of them the
              scan read — the ones pushed to most recently. */}
          <Hundred count={count} label={t("leads.grid", { n: count })} />
        </div>
      </header>

      {open && (
        <ol className={styles.repos} id={listId}>
          {listed.slice(0, HUNDRED).map((repo, i) => (
            <li className={styles.repo} key={repo.repo}>
              <span className={styles.index}>{String(i + 1).padStart(2, "0")}</span>
              <div className={styles.text}>
                <span className={styles.repoName}>{repo.name}</span>
                {/* A scan writes none; one written by hand is shown. */}
                {repo.description && (
                  <span className={styles.repoBody}>{pick(repo.description, language)}</span>
                )}
              </div>
              <span className={styles.meta}>
                {[repo.language, repo.platform].filter(Boolean).join(" · ")}
              </span>
              <span className={styles.repoLinks}>
                {repo.url && (
                  <a href={repo.url} target="_blank" rel="noopener">{t("leads.open")}</a>
                )}
                <a href={repo.repo} target="_blank" rel="noopener">{t("leads.source")}</a>
              </span>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
